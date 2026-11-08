import { Router } from "express";
import {
  AssignToAgentRequestSchema,
  CompleteRepairRequestSchema,
  ReportFrictionRequestSchema,
  SetRegressionRequestSchema,
  StartRegressionJobRequestSchema,
  UpdateFrictionRequestSchema,
  pageNameForRoute,
  type FrictionItem,
} from "../../shared/friction-types";
import { recordActivity } from "../activity/ui-events";
import { startJob } from "../workers/job-manager";
import { readJob } from "../workers/job-store";
import { routeJob } from "../workers/router";
import { reconcileRegressions } from "./corrections";
import { rankFriction } from "./ranking";
import {
  assignRepairJob,
  readFriction,
  RegressionRequiredError,
  reportFriction,
  saveReconciledRegressions,
  setRegression,
  startRegressionTracking,
  updateFriction,
  verifyFriction,
} from "./store";

/** `/api/friction` — report it, list it ranked, mark it fixed or ignored. */
export const frictionRouter = Router();

frictionRouter.get("/", async (_request, response) => {
  const items = await readFriction();
  // Corrections waiting on a test-writing job are checked against what the job did.
  const reconciled = await reconcileRegressions(items, readJob);
  const changed = reconciled.filter((item, index) => item.regression !== items[index].regression);
  await saveReconciledRegressions(changed).catch((error) => console.error("[friction] could not save regression changes:", error));
  response.json(rankFriction(reconciled));
});

frictionRouter.post("/", async (request, response) => {
  const parsed = ReportFrictionRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const expected = parsed.error.issues.find((issue) => issue.path[0] === "expected");
    response.status(400).json({ error: expected ? expected.message : "Say what annoyed you (at least a few words), how often, and how much." });
    return;
  }
  try {
    const item = await reportFriction(parsed.data);
    await recordActivity({
      type: "friction.reported",
      description: `${item.description.slice(0, 120)}${pageNameForRoute(item.route) ? ` · ${pageNameForRoute(item.route)}` : ""}`,
      metadata: { frictionId: item.id, frequency: item.frequency, severity: item.severity },
    });
    response.status(201).json(item);
  } catch (error) {
    console.error("[friction] could not save a report:", error);
    response.status(500).json({ error: "The report could not be saved." });
  }
});

frictionRouter.patch("/:id", async (request, response) => {
  const parsed = UpdateFrictionRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid update request." });
    return;
  }
  try {
    const item = await updateFriction(request.params.id, parsed.data);
    if (!item) {
      response.status(404).json({ error: "There is no friction item with that id." });
      return;
    }
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 120)} → ${item.status}`,
      metadata: { frictionId: item.id, status: item.status },
    });
    response.json(item);
  } catch (error) {
    if (error instanceof RegressionRequiredError) {
      response.status(409).json({ error: error.message, code: "regression_required" });
      return;
    }
    console.error("[friction] could not update an item:", error);
    response.status(500).json({ error: "The item could not be updated." });
  }
});

/** The owner says a test covers a correction, or that it can't be tested, and why. */
frictionRouter.post("/:id/regression", async (request, response) => {
  const parsed = SetRegressionRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That isn't a valid regression update." });
    return;
  }
  try {
    const item = await setRegression(request.params.id, parsed.data);
    if (!item) {
      response.status(404).json({ error: "There is no correction with that id." });
      return;
    }
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 100)} → ${parsed.data.status === "covered" ? "covered by a test" : "can't be tested"}`,
      metadata: { frictionId: item.id, regression: parsed.data.status },
    });
    response.json(item);
  } catch (error) {
    console.error("[friction] could not update a regression:", error);
    response.status(500).json({ error: "The regression could not be updated." });
  }
});

/** The brief for the job that writes the test. Pure text: what went wrong, what should have happened. */
function regressionObjective(item: FrictionItem): string {
  return [
    "Write a regression test for this correction, then make sure the behaviour is right.",
    "",
    `What went wrong: ${item.description}`,
    item.expected ? `What should have happened: ${item.expected}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * Starts a worker job to write the regression test. Only ever on the owner's
 * explicit request: nothing calls this automatically.
 */
frictionRouter.post("/:id/regression-job", async (request, response) => {
  const parsed = StartRegressionJobRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "That isn't a worker AgentOS knows." });
    return;
  }
  try {
    const item = (await readFriction()).find((entry) => entry.id === request.params.id && entry.kind === "correction");
    if (!item) {
      response.status(404).json({ error: "There is no correction with that id." });
      return;
    }
    if (item.regression?.status !== "needed") {
      response.status(409).json({ error: "This correction already has a test, a job writing one, or a reason it can't be tested." });
      return;
    }

    const project = item.source?.project ?? "agentos";
    const objective = regressionObjective(item);
    const { decision } = await routeJob({ objective, project });
    const started = await startJob({
      worker: parsed.data.worker,
      requestedWorker: parsed.data.worker,
      routing: decision,
      project,
      objective,
      modelRouteType: "execute",
      constraints: ["Put the test in a __tests__ folder beside the code it checks."],
      acceptanceCriteria: [
        "A test exists that fails on the wrong behaviour described above, and you have run it to see it fail.",
        "The test passes once the behaviour is right.",
        "The existing tests still pass.",
      ],
    });
    if (!started.job) {
      response.status(409).json({ error: started.error ?? "The job could not be started." });
      return;
    }
    const tracked = await startRegressionTracking(item.id, started.job.id);
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 100)} → test job started`,
      metadata: { frictionId: item.id, jobId: started.job.id },
    });
    response.status(201).json({ item: tracked, jobId: started.job.id });
  } catch (error) {
    console.error("[friction] could not start a regression job:", error);
    response.status(500).json({ error: "The test-writing job could not be started." });
  }
});

/** Assigns a friction item to an agent for repair. */
frictionRouter.post("/:id/assign", async (request, response) => {
  const parsed = AssignToAgentRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid assignment request." });
    return;
  }
  try {
    const items = await readFriction();
    const item = items.find((entry) => entry.id === request.params.id);
    if (!item) {
      response.status(404).json({ error: "There is no friction item with that id." });
      return;
    }

    const activeJob = item.repairJobs?.find((job) => job.status === "running");
    if (activeJob) {
      response.status(409).json({ error: "This item already has an active repair job.", jobId: activeJob.jobId });
      return;
    }

    const objective = [
      `Fix: ${item.description}`,
      item.expected ? `Expected: ${item.expected}` : undefined,
      item.reproduction ? `Reproduction: ${item.reproduction}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");

    const project = item.project || "agentos";
    const { decision } = await routeJob({ objective, project });
    const started = await startJob({
      worker: parsed.data.worker,
      requestedWorker: parsed.data.worker,
      routing: decision,
      project,
      objective,
      modelRouteType: "execute",
    });

    if (!started.job) {
      response.status(409).json({ error: started.error ?? "The job could not be started." });
      return;
    }

    const updated = await assignRepairJob(item.id, started.job.id, decision?.selectedWorker);
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 100)} → assigned to agent`,
      metadata: { frictionId: item.id, jobId: started.job.id, worker: decision?.selectedWorker },
    });
    response.status(201).json({ item: updated, jobId: started.job.id });
  } catch (error) {
    console.error("[friction] could not assign to agent:", error);
    response.status(500).json({ error: "The repair job could not be started." });
  }
});

/** Marks a friction item as verified with evidence. */
frictionRouter.post("/:id/verify", async (request, response) => {
  const parsed = CompleteRepairRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid verification request." });
    return;
  }
  try {
    const items = await readFriction();
    const item = items.find((entry) => entry.id === request.params.id);
    if (!item) {
      response.status(404).json({ error: "There is no friction item with that id." });
      return;
    }

    const verification = parsed.data.verification || {
      verifiedAt: new Date().toISOString(),
      ownerConfirmed: parsed.data.ownerConfirmed,
    };

    const updated = await verifyFriction(item.id, verification);
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 100)} → verified`,
      metadata: { frictionId: item.id, ownerConfirmed: verification.ownerConfirmed },
    });
    response.json(updated);
  } catch (error) {
    console.error("[friction] could not verify item:", error);
    response.status(500).json({ error: "The item could not be verified." });
  }
});

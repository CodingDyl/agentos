import express, { type Response } from "express";
import {
  CreateOperatorRunSchema,
  CreateProposedTasksSchema,
  MemoryProposalDecisionSchema,
  type OperatorRun,
} from "../../shared/operator-types";
import { writeDecision } from "../agentos/mutations/decisions";
import { InvalidRequestError, NotFoundError } from "../agentos/mutations/tasks";
import { requireJson } from "../connectors/routes";
import { approveRun, createRun, liveRun, RunStateError, stopRun } from "./engine";
import { createProposedTasks } from "./operations";
import { operatorDeps, runbookSummaries } from "./service";
import { isRunId, listRuns, readRun, saveRun, summarise } from "./store";

/**
 * `/api/operator`: start a run, read it while it goes, approve it, stop it.
 *
 * Creating a run returns at once in `planning`; the page polls the run until
 * it settles. Every write is JSON-only, for the same cross-site reason as
 * Connectors: a web page open in another tab must not be able to press Run.
 */
export const operatorRouter = express.Router();

operatorRouter.use(requireJson);

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof RunStateError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidRequestError) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof NotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  console.error(`[agentos] operator: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

/** The live copy while this process works on it, else the file. */
async function findRun(id: string): Promise<OperatorRun | undefined> {
  if (!isRunId(id)) return undefined;
  return liveRun(id) ?? (await readRun(id));
}

operatorRouter.get("/runbooks", (_request, response) => {
  response.json({ runbooks: runbookSummaries() });
});

operatorRouter.get("/runs", async (_request, response) => {
  try {
    const runs = await listRuns();
    response.json({ runs: runs.map((run) => summarise(liveRun(run.id) ?? run)) });
  } catch (error) {
    fail(response, error, "read runs");
  }
});

operatorRouter.post("/runs", async (request, response) => {
  const parsed = CreateOperatorRunSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Send { input, mode }." });
    return;
  }
  try {
    const { run } = await createRun(parsed.data.input, parsed.data.mode, operatorDeps());
    response.status(202).json(run);
  } catch (error) {
    fail(response, error, "start the run");
  }
});

operatorRouter.get("/runs/:id", async (request, response) => {
  const run = await findRun(request.params.id);
  if (!run) {
    response.status(404).json({ error: "There is no such run." });
    return;
  }
  response.json(run);
});

operatorRouter.post("/runs/:id/approve", async (request, response) => {
  const run = await findRun(request.params.id);
  if (!run) {
    response.status(404).json({ error: "There is no such run." });
    return;
  }
  try {
    const started = await approveRun(run, operatorDeps());
    response.status(202).json(started.run);
  } catch (error) {
    fail(response, error, "approve the run");
  }
});

operatorRouter.post("/runs/:id/stop", async (request, response) => {
  const run = await findRun(request.params.id);
  if (!run) {
    response.status(404).json({ error: "There is no such run." });
    return;
  }
  try {
    response.json(await stopRun(run, operatorDeps()));
  } catch (error) {
    fail(response, error, "stop the run");
  }
});

/** Adds the proposed tasks a person picked. Each is created once. */
operatorRouter.post("/runs/:id/tasks", async (request, response) => {
  const parsed = CreateProposedTasksSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { ids: [...] } with the proposals to add." });
    return;
  }
  const run = await findRun(request.params.id);
  if (!run) {
    response.status(404).json({ error: "There is no such run." });
    return;
  }
  if (liveRun(run.id)) {
    response.status(409).json({ error: "Wait for the run to finish first." });
    return;
  }
  try {
    await createProposedTasks(run, parsed.data.ids);
    response.json(await saveRun(run));
  } catch (error) {
    fail(response, error, "add the tasks");
  }
});

/** Accepting a memory proposal writes it as a decision in its workspace. Dismissing keeps the record. */
operatorRouter.post("/runs/:id/memory/:proposalId", async (request, response) => {
  const parsed = MemoryProposalDecisionSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { decision: \"accept\" | \"dismiss\" }." });
    return;
  }
  const run = await findRun(request.params.id);
  const proposal = run?.memoryProposals.find((entry) => entry.id === request.params.proposalId);
  if (!run || !proposal) {
    response.status(404).json({ error: "There is no such proposal." });
    return;
  }
  if (liveRun(run.id)) {
    response.status(409).json({ error: "Wait for the run to finish first." });
    return;
  }
  if (proposal.status !== "proposed") {
    response.status(409).json({ error: `That proposal was already ${proposal.status}.` });
    return;
  }
  try {
    if (parsed.data.decision === "accept") {
      await writeDecision({ slug: proposal.workspaceSlug, title: proposal.title, body: proposal.body });
      run.changes.push({
        at: new Date().toISOString(),
        stepId: "memory",
        kind: "local",
        description: `Decision “${proposal.title}” recorded`,
        href: `/workspaces/${encodeURIComponent(proposal.workspaceSlug)}?tab=decisions`,
      });
    }
    proposal.status = parsed.data.decision === "accept" ? "accepted" : "dismissed";
    response.json(await saveRun(run));
  } catch (error) {
    fail(response, error, "record the decision");
  }
});

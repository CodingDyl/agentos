import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { agentOSRoot } from "../agentos/filesystem";
import {
  BrandKitEditSchema,
  BrandUploadKindSchema,
  REBUILD_SKILL_ID,
  RebuildDecisionInputSchema,
  RebuildRetryInputSchema,
  RebuildStageIdSchema,
  RebuildStartSchema,
  WORKER_STAGES,
  type RebuildRun,
  type RebuildStageId,
  type StageWorkerOption,
} from "../../shared/website-rebuild-types";
import { cancelJob } from "../workers/job-manager";
import { listWorkers } from "../workers/registry";
import { readDimensions } from "../designs/media";
import { BRAND_EXTENSION } from "./brand";
import { MAX_BRAND_UPLOAD_BYTES, toSafeRaster } from "./capture";
import { REPORT_DIR } from "./reports";
import { advanceInBackground, currentSkillVersion } from "./runner";
import { isSkillEnabled } from "../skills/registry";
import { addBrandAsset, createOrReuseRun, decide, editBrandKit, listRuns, readRun, RebuildError, recordArtifact, recoverAbandonedStages, resetForRetry, runForProspect, runForWorkspace, setRunField } from "./store";

/**
 * Website rebuilds. Every route answers with the run's full state, so the page
 * never has to merge partial updates. Work happens in the background; the page
 * polls `GET /:id` while a stage is in progress.
 */
export const rebuildRouter = express.Router();

rebuildRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Client research and approvals are local: no DNS rebinding, no cross-site forms.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Website rebuilds are only available on this machine." });
    return;
  }
  // JSON, or an image for the one upload route: neither can be sent by a plain cross-site form.
  const upload = request.method === "POST" && /^\/[^/]+\/brand\/assets$/.test(request.path);
  if (request.method !== "GET" && !(upload ? request.is("image/*") : request.is("application/json"))) {
    response.status(415).json({ error: upload ? "Send the image file itself, with its image type." : "Send JSON." });
    return;
  }
  next();
});

/** Workers able to do a stage: research workers for research, coding workers for the rest. Never the mock or Ollama. */
async function stageWorkerOptions(run: RebuildRun, stage: RebuildStageId): Promise<StageWorkerOption[]> {
  const needs = WORKER_STAGES[stage];
  if (!needs) throw new RebuildError("This stage doesn't use a worker.", 422);
  const plan = run.workerPlan[stage as keyof RebuildRun["workerPlan"]] ?? [];
  const capable = listWorkers().filter((worker) => !worker.simulated && worker.id !== "mock" && worker.capabilities.includes(needs));
  const options = await Promise.all(
    capable.map(async (worker) => {
      const health = await worker.healthCheck().catch(() => ({ available: false, reason: "could not report its health" }));
      return { id: worker.id, name: worker.name, available: health.available, reason: health.available ? undefined : health.reason, inPlan: plan.includes(worker.id) };
    }),
  );
  // The plan's order first, then the rest; available before unavailable within each.
  const rank = (option: StageWorkerOption) => (option.inPlan ? plan.indexOf(option.id) : 100) + (option.available ? 0 : 1000);
  return options.sort((left, right) => rank(left) - rank(right));
}

function fail(response: express.Response, error: unknown): void {
  if (error instanceof RebuildError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] website rebuild request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "The website rebuild request failed." });
}

function stageParam(value: string): ReturnType<typeof RebuildStageIdSchema.parse> {
  const parsed = RebuildStageIdSchema.safeParse(value);
  if (!parsed.success) throw new RebuildError("No such stage.", 404);
  return parsed.data;
}

rebuildRouter.get("/", (_request, response) => {
  try {
    response.json({ runs: listRuns() });
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.get("/by-workspace/:slug", (request, response) => {
  try {
    const run = runForWorkspace(request.params.slug);
    if (!run) throw new RebuildError("This workspace has no website rebuild.", 404);
    response.json(run);
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.get("/by-prospect/:prospectId", (request, response) => {
  try {
    const run = runForProspect(request.params.prospectId);
    if (!run) throw new RebuildError("No rebuild for that prospect yet.", 404);
    response.json(run);
  } catch (error) {
    fail(response, error);
  }
});

/**
 * A screenshot the run recorded. Only files listed as this run's image
 * artifacts are served, from inside the vault, so the route cannot be used to
 * read anything else on the machine.
 */
rebuildRouter.get("/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = readRun(request.params.id).artifacts.find((entry) => entry.id === request.params.artifactId && entry.media === "image");
    if (!artifact) throw new RebuildError("No such screenshot.", 404);
    const root = path.resolve(agentOSRoot());
    const file = path.resolve(root, artifact.path);
    // Raster formats only: an SVG could carry script, and capture never stores one.
    if (!file.startsWith(`${root}${path.sep}`) || !/\.(png|jpg|webp|gif|avif)$/.test(file)) throw new RebuildError("No such screenshot.", 404);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.sendFile(file, (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: "That screenshot is no longer on disk." });
    });
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.get("/:id", (request, response) => {
  try {
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

/** Starts a rebuild, or returns the one this prospect already has. */
rebuildRouter.post("/", async (request, response) => {
  const parsed = RebuildStartSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(422).json({ error: parsed.error.issues[0]?.message ?? "Fill in every field." });
    return;
  }
  try {
    if (!(await isSkillEnabled(REBUILD_SKILL_ID))) throw new RebuildError(`The ${REBUILD_SKILL_ID} skill is disabled in Connectors → Skills. Enable it to start a rebuild.`);
    const { run, created } = createOrReuseRun({ ...parsed.data, skillVersion: await currentSkillVersion() });
    advanceInBackground(run.id);
    response.status(created ? 201 : 200).json(run);
  } catch (error) {
    fail(response, error);
  }
});

/** Every worker that could do this stage, healthy or not, for the "retry with another worker" choice. */
rebuildRouter.get("/:id/stages/:stage/workers", async (request, response) => {
  try {
    const run = readRun(request.params.id);
    response.json({ workers: await stageWorkerOptions(run, stageParam(request.params.stage)) });
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/retry", async (request, response) => {
  const input = RebuildRetryInputSchema.safeParse(request.body ?? {});
  if (!input.success) {
    response.status(422).json({ error: "That is not a worker AgentOS knows." });
    return;
  }
  try {
    const run = readRun(request.params.id);
    const stage = stageParam(request.params.stage);
    if (!(await isSkillEnabled(run.skillId))) throw new RebuildError(`The ${run.skillId} skill is disabled in Connectors → Skills. Enable it before retrying.`);
    const worker = input.data.worker;
    if (worker && worker !== "plan") {
      const option = (await stageWorkerOptions(run, stage)).find((entry) => entry.id === worker);
      if (!option) throw new RebuildError(`${worker} can't do the ${stage} stage.`, 422);
      if (!option.available) throw new RebuildError(`${option.name} is not available: ${option.reason ?? "no reason given"}.`);
      // The abandoned job is stopped, so two workers never edit the same stage at once.
      const previous = run.stages.find((entry) => entry.id === stage)?.jobId;
      if (previous) await cancelJob(previous).catch(() => undefined);
    }
    resetForRetry(run.id, stage, worker);
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

/**
 * Skips a blocked website capture: for a site that cannot be read (down,
 * behind a login, an address that no longer works). The rebuild carries on
 * from the research and the details given at the start.
 */
rebuildRouter.post("/:id/stages/capture/skip", (request, response) => {
  try {
    const run = readRun(request.params.id);
    const capture = run.stages.find((stage) => stage.id === "capture");
    if (capture?.status !== "blocked") throw new RebuildError("Only a blocked website capture can be skipped.");
    const why = (capture.blocker ?? "").replace(/^The site could not be captured: /, "").replace(/ Check the address.*$/, "").trim();
    setRunField(run.id, "site_note", `You chose to skip reading the site${why ? ` after it could not be read (${why.slice(0, 300)})` : ""}.`);
    resetForRetry(run.id, "capture");
    advanceInBackground(run.id);
    response.json(readRun(run.id));
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/approve", (request, response) => {
  const input = RebuildDecisionInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: "Say which revision you reviewed." });
    return;
  }
  try {
    decide(readRun(request.params.id).id, stageParam(request.params.stage), input.data.revision, "approved", input.data.note, input.data.choice);
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/request-changes", (request, response) => {
  const input = RebuildDecisionInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: "Say which revision you reviewed and what should change." });
    return;
  }
  try {
    decide(readRun(request.params.id).id, stageParam(request.params.stage), input.data.revision, "changes_requested", input.data.note);
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

/** The person's changes to the brand kit: which images, in what order, and the colours and fonts. */
rebuildRouter.post("/:id/brand", (request, response) => {
  const input = BrandKitEditSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: input.error.issues[0]?.message ?? "That brand kit is not valid." });
    return;
  }
  try {
    response.json(editBrandKit(readRun(request.params.id).id, input.data));
  } catch (error) {
    fail(response, error);
  }
});

/**
 * Adds a logo or photo to the brand kit. The body is the file; its type is
 * read from its bytes, SVG and ICO are rasterised to PNG, and the server
 * names the file, so nothing the browser sends becomes a path.
 */
rebuildRouter.post("/:id/brand/assets", express.raw({ type: "image/*", limit: MAX_BRAND_UPLOAD_BYTES }), async (request, response) => {
  const kind = BrandUploadKindSchema.safeParse(request.query.kind);
  if (!kind.success) {
    response.status(422).json({ error: "Say whether this is a logo or a photo." });
    return;
  }
  try {
    const run = readRun(request.params.id);
    if (!run.workspaceSlug) throw new RebuildError("This rebuild has no workspace yet. Wait for the first stage to finish.");
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new RebuildError("The upload was empty.", 400);
    const safe = await toSafeRaster(request.body);
    if (!safe) throw new RebuildError("That file is not an image AgentOS can use. Send a PNG, JPEG, WebP, GIF, AVIF, SVG or ICO under 20 MB.", 415);
    const extension = BRAND_EXTENSION[safe.contentType];
    const id = `${kind.data}-upload-${randomUUID().slice(0, 8)}`;
    const relativePath = `projects/${run.workspaceSlug}/${REPORT_DIR}/brand/${id}.${extension}`;
    const root = path.resolve(agentOSRoot());
    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) throw new RebuildError("That workspace is not inside the vault.");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, safe.data);
    const capture = run.stages.find((stage) => stage.id === "capture");
    const artifactId = recordArtifact(run.id, "capture", { title: kind.data === "logo" ? "Uploaded logo" : "Uploaded photo", path: relativePath, href: "", revision: Math.max(1, capture?.revision ?? 1), media: "image" });
    const alt = typeof request.query.alt === "string" ? request.query.alt.trim().slice(0, 300) : "";
    const measured = readDimensions(safe.data);
    response.status(201).json(addBrandAsset(run.id, { id, kind: kind.data, artifactId, path: relativePath, sourceUrl: "uploaded", alt: alt || undefined, width: measured?.width, height: measured?.height, include: true }));
  } catch (error) {
    fail(response, error);
  }
});

/** Called once at server start: stages a previous process was running have no worker any more. */
export function recoverRebuildsAtStartup(): void {
  try {
    const recovered = recoverAbandonedStages({ atStartup: true });
    if (recovered > 0) console.log(`[agentos] website rebuild: ${recovered} interrupted stage${recovered === 1 ? "" : "s"} marked for retry.`);
  } catch (error) {
    console.error("[agentos] website rebuild recovery failed:", error);
  }
}

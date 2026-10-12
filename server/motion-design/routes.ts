import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  CREDIT_COST_TABLE,
  MotionApprovalInputSchema,
  MotionDraftSchema,
  MotionLaunchInputSchema,
  MotionNotesSchema,
  MotionRunViewSchema,
  REFERENCE_LIBRARY_LINKS,
  suggestedReferences,
  type MotionRun,
  type MotionRunView,
} from "../../shared/motion-design-types";
import { readJob } from "../workers/job-manager";
import { approveMotionConcept, launchMotionDesign, sendMotionNotes } from "./launch";
import { refreshRun, resolveMediaFile, scanMotionProgress } from "./progress";
import { detectMotionDesignSetup, higgsfieldHint } from "./setup";
import { importSkillZip, installBundledSkill } from "./skill-install";
import { MotionDesignError, clearDraft, listRuns, readDraft, readRun, runForWorkspace, saveDraft, saveDraftFile } from "./store";

export const motionDesignRouter = express.Router();

motionDesignRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Motion Design is only available on this machine." });
    return;
  }
  const upload =
    request.method === "POST" &&
    (/\/draft\/files$/.test(request.path) || /\/skill\/zip$/.test(request.path));
  if (request.method !== "GET" && !upload && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown): void {
  if (error instanceof MotionDesignError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] motion design request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "Motion Design could not do that." });
}

async function viewOf(run: MotionRun): Promise<MotionRunView> {
  const fresh = await refreshRun(run);
  const progress = await scanMotionProgress(fresh);
  const jobId = fresh.buildJobId ?? fresh.proposalJobId;
  const job = jobId ? await readJob(jobId) : undefined;
  return MotionRunViewSchema.parse({
    ...fresh,
    progress: { ...progress, concepts: progress.concepts.length > 0 ? progress.concepts : fresh.concepts },
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          summary: job.result?.summary,
          href: `/workers/jobs/${job.id}`,
        }
      : undefined,
  });
}

motionDesignRouter.get("/setup", async (_request, response) => {
  try {
    const setup = await detectMotionDesignSetup();
    const hint = await higgsfieldHint().catch(() => undefined);
    response.json({ setup, higgsfield: hint, libraries: REFERENCE_LIBRARY_LINKS, costTable: CREDIT_COST_TABLE, suggestions: suggestedReferences() });
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post("/skill/install", async (request, response) => {
  try {
    const confirm = Boolean((request.body as { confirmOverwrite?: boolean } | undefined)?.confirmOverwrite);
    response.json(await installBundledSkill({ confirmOverwrite: confirm }));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post("/skill/zip", express.raw({ type: ["application/zip", "application/octet-stream"], limit: "8mb" }), async (request, response) => {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-motion-zip-"));
  const zipPath = path.join(staging, "skill.zip");
  try {
    const body = request.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      response.status(400).json({ error: "Send a zip file." });
      return;
    }
    await fs.writeFile(zipPath, body);
    const confirm = request.query.confirm === "1";
    response.json(await importSkillZip(zipPath, { confirmOverwrite: confirm }));
  } catch (error) {
    fail(response, error);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
});

motionDesignRouter.get("/draft", async (_request, response) => {
  try {
    response.json({ draft: (await readDraft()) ?? null });
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.put("/draft", async (request, response) => {
  try {
    const parsed = MotionDraftSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That draft is incomplete." });
      return;
    }
    response.json({ draft: await saveDraft(parsed.data) });
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post(
  "/draft/files",
  express.raw({
    type: (request) => /^(image\/|application\/octet-stream)/i.test(String(request.headers["content-type"] ?? "")),
    limit: "8mb",
  }),
  async (request, response) => {
    try {
      const body = request.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        response.status(400).json({ error: "Send an image file." });
        return;
      }
      const filename = typeof request.query.filename === "string" ? request.query.filename : "reference.png";
      const saved = await saveDraftFile(filename, body);
      response.status(201).json({ reference: { id: saved.id, kind: "file", filename: saved.filename, path: saved.path, likes: [], note: "" } });
    } catch (error) {
      fail(response, error);
    }
  },
);

motionDesignRouter.delete("/draft", async (_request, response) => {
  try {
    await clearDraft();
    response.json({ draft: null });
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.get("/", async (_request, response) => {
  try {
    response.json({ runs: await listRuns() });
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.get("/by-workspace/:slug", async (request, response) => {
  try {
    const run = await runForWorkspace(request.params.slug);
    if (!run) throw new MotionDesignError("This workspace has no Motion Design run.", 404);
    response.json(await viewOf(run));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post("/launch", async (request, response) => {
  try {
    const parsed = MotionLaunchInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "The brief is incomplete." });
      return;
    }
    const run = await launchMotionDesign(parsed.data);
    response.status(201).json(await viewOf(run));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.get("/:id", async (request, response) => {
  try {
    response.json(await viewOf(await readRun(request.params.id)));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post("/:id/approve", async (request, response) => {
  try {
    const parsed = MotionApprovalInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Pick a concept and a credit ceiling." });
      return;
    }
    const run = await readRun(request.params.id);
    response.json(await viewOf(await approveMotionConcept(run, parsed.data)));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.post("/:id/notes", async (request, response) => {
  try {
    const parsed = MotionNotesSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Write a note." });
      return;
    }
    const run = await readRun(request.params.id);
    response.json(await viewOf(await sendMotionNotes(run, parsed.data.text)));
  } catch (error) {
    fail(response, error);
  }
});

motionDesignRouter.get("/:id/media", async (request, response) => {
  try {
    const run = await readRun(request.params.id);
    const relative = typeof request.query.path === "string" ? request.query.path : "";
    const file = await resolveMediaFile(run, relative);
    if (!file || !/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i.test(file)) {
      response.status(404).json({ error: "That media file is not part of this run." });
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.sendFile(file, { dotfiles: "allow" }, (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: "That media file is not part of this run." });
    });
  } catch (error) {
    fail(response, error);
  }
});

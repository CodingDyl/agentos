import express, { type Response } from "express";
import { z } from "zod";
import {
  defaultOllamaModelConfig,
  OllamaSettingsSchema,
  ProbeRequestSchema,
  RoutingModeSchema,
  TaskMetadataSchema,
} from "../../shared/route-policy-types";
import { ollamaSettings, setOllamaSettings } from "../ai-stack/settings";
import { discoverOllama } from "../workers/providers/ollama-client";
import { collectExecutionOptions, planRoute } from "./dispatch";
import { probeModel } from "./model-probe";
import { readProbes, saveProbe } from "./probe-store";
import { buildOllamaOptions, defaultOllamaSettings, DEFAULT_OLLAMA_BASE_URL } from "./ollama-config";

/**
 * `/api/route-policy`.
 *
 * Read and configure routing; nothing here starts a job. A preview is a
 * recommendation the operator can see before dispatch, as with worker routing.
 */
export const routePolicyRouter = express.Router();

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The Ollama address must be this machine unless the operator has said
 * otherwise in the environment. A remote address would send task text off the
 * machine while the UI still says "local", which defeats local-only routing.
 */
export function ollamaUrlProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "The Ollama address is not a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The Ollama address must be http or https.";
  if (!LOOPBACK.has(url.hostname) && process.env.AGENTOS_OLLAMA_ALLOW_REMOTE !== "1") {
    return "Ollama must run on this machine (127.0.0.1). A remote address would send local-only tasks off this machine.";
  }
  return undefined;
}

function invalid(response: Response, error: z.ZodError): void {
  const issue = error.issues[0];
  response.status(400).json({ error: `Invalid request: ${issue?.path.join(".") || "body"}: ${issue?.message ?? ""}` });
}

/** Connection status, discovered models with their configuration, and the effective options. */
routePolicyRouter.get("/ollama", async (_request, response) => {
  try {
    const settings = ollamaSettings() ?? defaultOllamaSettings();
    const state = await discoverOllama(settings.baseUrl || DEFAULT_OLLAMA_BASE_URL);
    response.json({
      settings,
      state,
      options: buildOllamaOptions(settings, state),
      probes: await readProbes(state.installed),
    });
  } catch (error) {
    console.error("[agentos] ollama status failed:", error);
    response.status(500).json({ error: "Unable to read Ollama status" });
  }
});

routePolicyRouter.put("/ollama", (request, response) => {
  const parsed = OllamaSettingsSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error);

  const problem = ollamaUrlProblem(parsed.data.baseUrl);
  if (problem) {
    response.status(400).json({ error: problem });
    return;
  }

  setOllamaSettings(parsed.data);
  response.json({ settings: parsed.data });
});

/**
 * Runs the suitability test for one model. Blocks until it finishes (bounded by
 * the model's own deadline), and stops if the browser goes away. It reads and
 * generates only: it never changes a setting, and a result that says nothing
 * about the model (Ollama down, not installed) is not stored.
 */
routePolicyRouter.post("/ollama/probe", async (request, response) => {
  const parsed = ProbeRequestSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error);

  const settings = ollamaSettings() ?? defaultOllamaSettings();
  const baseUrl = settings.baseUrl || DEFAULT_OLLAMA_BASE_URL;
  const problem = ollamaUrlProblem(baseUrl);
  if (problem) {
    response.status(400).json({ error: problem });
    return;
  }

  // Test what is on screen (unsaved edits included), else what is saved.
  const config = parsed.data.config ?? settings.models[parsed.data.model] ?? defaultOllamaModelConfig();

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const result = await probeModel({
      baseUrl,
      model: parsed.data.model,
      config,
      maxConcurrent: settings.maxConcurrent,
      signal: controller.signal,
    });
    await saveProbe(result);
    if (!response.writableEnded) response.json({ result });
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("[agentos] model probe failed:", error);
    response.status(500).json({ error: "The model test failed unexpectedly" });
  }
});

const PreviewSchema = z.object({
  project: z.string().default("agentos"),
  objective: z.string().min(1),
  inputText: z.string().optional(),
  repoPath: z.string().optional(),
  contextFiles: z.array(z.string()).optional(),
  validationCommands: z.array(z.string()).optional(),
  expectedOutput: z
    .object({ format: z.enum(["text", "json"]), schema: z.record(z.string(), z.unknown()).optional() })
    .optional(),
  routingMode: RoutingModeSchema.optional(),
  manualOptionId: z.string().optional(),
  routingHints: TaskMetadataSchema.optional(),
});

/** The routing decision for a task, before anything is dispatched. */
routePolicyRouter.post("/preview", async (request, response) => {
  const parsed = PreviewSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error);

  try {
    const planned = await planRoute({ ...parsed.data, worker: "auto" });

    // `legacy` means the policy had nothing to add (no local model enabled and
    // the task allows the cloud), so the existing router applies unchanged.
    response.json(planned ? { legacy: false, record: planned.record } : { legacy: true });
  } catch (error) {
    console.error("[agentos] route preview failed:", error);
    response.status(500).json({ error: "Unable to preview routing" });
  }
});

/** Every execution option and whether it is usable, for the task override picker. */
routePolicyRouter.get("/options", async (_request, response) => {
  try {
    response.json({ options: await collectExecutionOptions() });
  } catch (error) {
    console.error("[agentos] execution options failed:", error);
    response.status(500).json({ error: "Unable to list execution options" });
  }
});

import express from "express";
import { z } from "zod";
import { JarvisConverseRequestSchema } from "../../shared/jarvis-routing-types";
import { defaultJarvisWorkers } from "./default-jarvis-workers";
import { JarvisConversationStore } from "./jarvis-conversation-store";
import { ollamaJarvisModelClient } from "./jarvis-model-client";
import { jarvisRoutingConfig } from "./jarvis-routing-config";
import { JevRequestRouter } from "./jev-request-router";

/**
 * `/api/jarvis`: what Jarvis's panel sends every sentence to.
 *
 *   POST /converse          one request in, one routed outcome out
 *   GET  /jobs/:id          a delegated job's real outcome, for polling
 *   GET  /workers           the registry, for the docs and debugging
 */
export const jarvisRouter = express.Router();

let router: JevRequestRouter | undefined;

function jev(): JevRequestRouter {
  router ??= new JevRequestRouter({
    registry: defaultJarvisWorkers(),
    store: new JarvisConversationStore(),
    models: (config) => ollamaJarvisModelClient(config.ollamaBaseUrl),
    config: () => jarvisRoutingConfig(),
  });
  return router;
}

jarvisRouter.post("/converse", async (request, response) => {
  const parsed = JarvisConverseRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: `Invalid request: ${parsed.error.issues[0]?.message ?? "body"}` });
    return;
  }
  try {
    response.json(await jev().converse(parsed.data));
  } catch (error) {
    // Routing failures are answered as outcomes; this is only for a bug.
    console.error("[jarvis] converse failed:", error instanceof Error ? error.message : error);
    response.status(500).json({ error: "Jarvis routing failed unexpectedly. Nothing was executed." });
  }
});

const JobQuerySchema = z.object({ conversationId: JarvisConverseRequestSchema.shape.conversationId });

jarvisRouter.get("/jobs/:id", (request, response) => {
  const query = JobQuerySchema.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "conversationId is required." });
    return;
  }
  const job = jev().getJob(String(request.params.id), query.data.conversationId);
  if (!job) {
    response.status(404).json({ error: "No such job in this conversation. It may have been forgotten after a restart." });
    return;
  }
  response.json({ job });
});

jarvisRouter.get("/workers", (_request, response) => {
  const config = jarvisRoutingConfig();
  response.json({
    enabled: Boolean(config.quick),
    models: { quick: config.quick?.model ?? null, strong: config.strong.model, fallback: config.fallback?.model ?? null },
    workers: defaultJarvisWorkers()
      .list()
      .map((worker) => ({
        id: worker.id,
        name: worker.name,
        description: worker.description,
        capabilities: worker.capabilities,
        intents: worker.intents,
        requiredInputs: worker.requiredInputs,
        optionalInputs: worker.optionalInputs ?? [],
        safeRetry: worker.safeRetry,
        handoff: Boolean(worker.handoff),
        available: worker.available?.() ?? { ok: true },
      })),
  });
});

import { z } from "zod";

/**
 * Who the workers are, and what they are for.
 *
 * These live on their own because both the worker contract and the routing
 * contract need them, and each of those needs the other: a job record carries
 * a routing decision, and a routing decision names a worker. Without a shared
 * base the two modules would import each other, and a cycle between two files
 * of zod schemas does not merely look untidy — the second one to load reads
 * the first one's exports before they exist.
 *
 * Both modules re-export what they use, so nothing downstream needs to know
 * this file is here.
 */

/**
 * `claude` is Claude through the Agent SDK on an API key. `claude-code`,
 * `codex`, `gemini` and `hermes-worker` are the operator's own coding CLIs,
 * driven headlessly on whatever plan each is signed into; they are off until
 * switched on in Operations → AI Stack.
 */
export const WorkerIdSchema = z.enum(["grok", "claude", "mock", "claude-code", "codex", "gemini", "hermes-worker"]);

/** What a worker is *for*. Routing reads these to rule candidates out. */
export const WorkerCapabilitySchema = z.enum([
  "code",
  "research",
  "review",
  "web",
  "images",
]);

export type WorkerId = z.infer<typeof WorkerIdSchema>;
export type WorkerCapability = z.infer<typeof WorkerCapabilitySchema>;

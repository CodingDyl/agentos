import type { WorkerId, WorkerSummary } from "../../shared/worker-types";
import { isAiEnabled, switchedOffReason } from "../ai-stack/settings";
import { claudeWorker } from "./providers/claude-worker";
import { claudeCodeWorker, codexWorker, geminiWorker, hermesWorker } from "./providers/cli-workers";
import { grokWorker } from "./providers/grok-worker";
import { mockWorker } from "./providers/mock-worker";
import { ollamaWorker } from "./providers/ollama-worker";
import type { Worker } from "./worker";

/**
 * Which workers exist.
 *
 * Registration is the only place a concrete worker is named. Everything
 * downstream — the job manager, the API, the screen — works through the
 * `Worker` contract, so adding a real runner later is a registration, not a
 * change to how jobs are managed.
 */

const workers = new Map<WorkerId, Worker>();

/**
 * Registers a worker behind the operator's AI Stack switch.
 *
 * The switch is enforced here, in the health check, because every consumer
 * already asks health before using a worker — routing, starting a job,
 * resuming one, the workers screen. A switched-off worker therefore reads as
 * unavailable everywhere at once, with the reason saying where to turn it
 * back on, and no call site has to know the switch exists.
 */
export function registerWorker(worker: Worker): void {
  workers.set(worker.id, {
    ...worker,
    healthCheck: async () =>
      isAiEnabled(worker.id)
        ? worker.healthCheck()
        : { available: false, reason: switchedOffReason(worker.name) },
  });
}

export function getWorker(id: WorkerId): Worker | undefined {
  return workers.get(id);
}

export function listWorkers(): Worker[] {
  return [...workers.values()];
}

/**
 * The workers this build has.
 *
 * All three are real. Claude was declared here before it was implemented — it
 * appeared on the workers screen and refused to run — and turning that
 * declaration into a worker was a change to this file and nothing else.
 *
 * Note what integrating a second real runner did not require: no change to the
 * job manager, the event contract, the review path, or the screen. Adding a
 * runner is a registration. That is the property the `Worker` contract exists
 * to protect, and it is the reason Claude and Grok can be compared on their
 * work rather than on how each of them is wired in.
 */
registerWorker(mockWorker);

registerWorker(grokWorker);

registerWorker(claudeWorker);

/**
 * The operator's own coding CLIs. Off until switched on in AI Stack: each one
 * spends a plan the operator pays for, so using it is their call, not a default.
 */
registerWorker(claudeCodeWorker);

registerWorker(codexWorker);

registerWorker(geminiWorker);

registerWorker(hermesWorker);

/**
 * Local models. Unavailable until a model is enabled in the Ollama settings, so
 * registering it changes nothing for an install that has not opted in.
 */
registerWorker(ollamaWorker);

/** Every worker, with its health, for the workers screen. */
export async function describeWorkers(): Promise<WorkerSummary[]> {
  return Promise.all(
    listWorkers().map(async (worker) => {
      const health = await worker.healthCheck().catch(() => ({
        available: false,
        reason: "The worker could not report its health.",
      }));

      return {
        id: worker.id,
        name: worker.name,
        role: worker.role,
        capabilities: worker.capabilities,
        available: health.available,
        unavailableReason: health.available ? undefined : health.reason,
      };
    }),
  );
}

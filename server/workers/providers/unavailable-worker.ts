import type {
  WorkerCapability,
  WorkerId,
} from "../../../shared/worker-types";
import type { Worker } from "../worker";

/**
 * A worker the system is designed to reach but does not have yet.
 *
 * Declaring one is not integrating one: it appears on the workers screen, says
 * plainly why it cannot be used, and refuses to run. The alternative — hiding
 * it — would make the screen imply that Mock is all this is ever meant to be.
 */

export interface DeclaredWorkerOptions {
  id: WorkerId;
  name: string;
  role: string;
  capabilities: WorkerCapability[];
  /** Why it cannot be used. Shown verbatim on the screen. */
  reason: string;
}

export function declaredWorker(options: DeclaredWorkerOptions): Worker {
  return {
    id: options.id,
    name: options.name,
    role: options.role,
    capabilities: options.capabilities,

    healthCheck: async () => ({ available: false, reason: options.reason }),

    start: () => {
      // The job manager checks health before starting, so reaching here means
      // something bypassed that gate. Refusing loudly is the only safe answer.
      throw new Error(`${options.name} is not available. ${options.reason}`);
    },
  };
}

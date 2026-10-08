import { isAiEnabled, switchedOffReason } from "../ai-stack/settings";
import { JarvisWorkerRegistry, type JarvisWorker } from "./jarvis-worker-registry";
import { draftReviserWorker, draftWriterWorker } from "./workers/draft-writer-workers";
import { mailSendWorker } from "./workers/mail-send-worker";
import { overdueInvoicesWorker } from "./workers/overdue-invoices-worker";

/**
 * Hermes, the existing general agent, as a delegation target.
 *
 * Not run here: the request goes back to the browser, which starts the same
 * agent run the Agent page does, with Hermes' skills, project sessions and
 * approval prompts. Jev's job is only to decide that Hermes is the right
 * place; what Hermes may do is decided by Hermes' own approvals.
 */
export const hermesHandoffWorker: JarvisWorker = {
  id: "hermes.agent",
  name: "Hermes",
  description:
    "The general agent: project workspaces and code, research and current information from the web, calendar and inbox questions, and multi-step work. Use it when no more specific worker fits.",
  capabilities: ["projects", "code", "research", "web", "skills"],
  intents: ["retrieve", "task", "act"],
  requiredInputs: [],
  safeRetry: false,
  handoff: true,
  available: () => (isAiEnabled("hermes") ? { ok: true } : { ok: false, reason: switchedOffReason("Hermes") }),
};

/**
 * The registry Jarvis uses. Adding a worker is a `register` call here; the
 * routing prompt picks it up from its description.
 */
export function defaultJarvisWorkers(): JarvisWorkerRegistry {
  return new JarvisWorkerRegistry()
    .register(overdueInvoicesWorker())
    .register(draftWriterWorker)
    .register(draftReviserWorker)
    .register(mailSendWorker())
    .register(hermesHandoffWorker);
}

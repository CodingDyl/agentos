import {
  JarvisConverseResponseSchema,
  JarvisJobSchema,
  type JarvisConverseResponse,
  type JarvisJob,
} from "@shared/jarvis-routing-types";

/**
 * The browser's side of Jev routing. Every sentence Jarvis hears (outside a
 * page that has taken Jarvis over) goes to `/api/jarvis/converse` first.
 */

export class JarvisRoutingUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JarvisRoutingUnavailable";
  }
}

/** One id per Jarvis session, like the conversation on screen: a reload starts over. */
export function newJarvisConversationId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `jarvis_${random.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export async function converseWithJarvis(conversationId: string, message: string, signal?: AbortSignal): Promise<JarvisConverseResponse> {
  let response: Response;
  try {
    response = await fetch("/api/jarvis/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new JarvisRoutingUnavailable("The AgentOS data adapter is not responding.");
  }
  // An adapter from before this route existed answers 404: behave as before.
  if (response.status === 404) throw new JarvisRoutingUnavailable("This AgentOS server has no Jarvis routing.");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Jarvis routing failed (${response.status}).`;
    throw new Error(error);
  }
  const parsed = JarvisConverseResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Jarvis routing sent back an unreadable answer.");
  return parsed.data;
}

export async function getJarvisJob(conversationId: string, jobId: string, signal?: AbortSignal): Promise<JarvisJob> {
  const response = await fetch(`/api/jarvis/jobs/${encodeURIComponent(jobId)}?conversationId=${encodeURIComponent(conversationId)}`, { signal });
  const body = (await response.json().catch(() => null)) as { job?: unknown; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Couldn't read the job (${response.status}).`);
  return JarvisJobSchema.parse(body?.job);
}

const POLL_MS = 1_000;
/** Drafting with a big local model can take a while; past this, stop waiting and say so. */
const POLL_LIMIT_MS = 5 * 60 * 1000;

/** Waits for a delegated job to settle. Rejects if the signal aborts or it takes too long. */
export async function waitForJarvisJob(conversationId: string, jobId: string, signal: AbortSignal): Promise<JarvisJob> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  for (;;) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, POLL_MS);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    const job = await getJarvisJob(conversationId, jobId, signal);
    if (job.status !== "running") return job;
    if (Date.now() > deadline) throw new Error("That is taking longer than five minutes. It may still finish; ask me again in a moment.");
  }
}

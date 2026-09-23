import { useEffect, useState } from "react";
import { WorkerEventSchema, type WorkerEvent } from "@shared/worker-types";
import { workerJobEventsUrl } from "@/lib/agentos/client";
import { readSseStream } from "@/features/agent/sse";

/**
 * One job's activity, as it happens.
 *
 * The adapter replays what it recorded before streaming what is live, so a
 * screen opened halfway through a job sees the whole story rather than only the
 * rest of it — and a finished job simply replays and closes.
 *
 * Read as a raw stream rather than through `EventSource`, matching the agent
 * console: an event type added later still arrives, and there is no automatic
 * reconnect to re-open a stream for a job that has already ended.
 */
const NO_EVENTS: WorkerEvent[] = [];

export function useJobEvents(jobId: string): WorkerEvent[] {
  // The job is held with its events, so switching jobs empties the list by
  // derivation rather than by a reset — a stale job's events can never be
  // returned for a new one, even for a single render.
  const [stream, setStream] = useState<{ jobId: string; events: WorkerEvent[] }>(
    { jobId, events: [] },
  );

  useEffect(() => {
    if (!jobId) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(workerJobEventsUrl(jobId), {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        await readSseStream(response.body, (message) => {
          let parsed: unknown;

          try {
            parsed = JSON.parse(message.data);
          } catch {
            return;
          }

          const event = WorkerEventSchema.safeParse(parsed);
          if (!event.success) return;

          setStream((current) => {
            const events = current.jobId === jobId ? current.events : [];

            // The stream can replay on a reconnect; an event already shown is
            // the same event, not a second one.
            return events.some((entry) => entry.id === event.data.id)
              ? { jobId, events }
              : { jobId, events: [...events, event.data] };
          });
        });
      } catch {
        // An aborted stream is a screen closing, not a failure.
      }
    })();

    return () => controller.abort();
  }, [jobId]);

  return stream.jobId === jobId ? stream.events : NO_EVENTS;
}

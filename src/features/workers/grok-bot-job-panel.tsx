import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkerJob } from "@shared/worker-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { formatRelativeTime } from "@/lib/format";

/**
 * A Grok Bot job's side of the file bridge.
 *
 * While parked it is the whole call to action: the job cannot move until a
 * person runs Grok, so the instruction to paste is the first thing offered.
 * Afterwards it is provenance: what went out, and when the answer came back.
 */
export function GrokBotJobPanel({ job }: { job: WorkerJob }) {
  const bridge = job.bridge;
  const [copied, setCopied] = useState<"ok" | "failed">();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 2_500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!bridge) return null;

  const parked = job.status === "waiting" && !bridge.importedAt;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bridge.instruction);
      setCopied("ok");
      return;
    } catch {
      // Some embedded views refuse the async clipboard; the older copy command still works there.
    }
    const area = document.createElement("textarea");
    area.value = bridge.instruction;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    setCopied(ok ? "ok" : "failed");
  };

  const paths = (
    <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] leading-5 sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="text-os-subtle">Task</dt>
      <dd className="font-mono break-all text-os-muted">{bridge.taskPath}</dd>
      <dt className="text-os-subtle">Result</dt>
      <dd className="font-mono break-all text-os-muted">{bridge.resultPath}</dd>
      <dt className="text-os-subtle">Notes</dt>
      <dd className="text-os-muted">
        {bridge.notes.length === 0 ? (
          "None selected for this job"
        ) : (
          <details>
            <summary className="os-focus-ring cursor-pointer rounded-sm">
              {bridge.notes.length} {bridge.notes.length === 1 ? "note" : "notes"} in{" "}
              <span className="font-mono break-all">{bridge.memoryDir}</span>
            </summary>
            <ul className="mt-2 space-y-1">
              {bridge.notes.map((note) => (
                <li key={note.source} className="font-mono text-[12px] break-all">
                  {note.source}
                </li>
              ))}
            </ul>
          </details>
        )}
      </dd>
    </dl>
  );

  if (!parked) {
    return (
      <section aria-label="Grok Bot bridge" className="mt-10 max-w-[72ch]">
        <SectionLabel>Grok Bot bridge</SectionLabel>
        <p className="mt-3 text-[13px] leading-5 text-os-muted">
          {bridge.importedAt
            ? `Result imported ${formatRelativeTime(bridge.importedAt)}. It goes through review like any other result; nothing was written to the vault.`
            : `Exported ${formatRelativeTime(bridge.exportedAt)}. No result was imported.`}
        </p>
        {paths}
      </section>
    );
  }

  return (
    <section
      aria-label="Awaiting manual trigger"
      className="mt-10 max-w-[72ch] rounded-lg border border-os-amber/40 bg-os-amber/5 p-5 md:p-6"
    >
      <p className="os-meta text-os-amber">Awaiting manual trigger</p>
      <p className="mt-3 text-[15px] leading-6 text-foreground">
        The task is on the SSD. Paste the instruction into Grok; AgentOS imports the answer as soon as the result file
        appears.
      </p>

      {bridge.workspaceUnavailableSince ? (
        <p className="mt-3 text-[13px] leading-5 text-os-warning" role="status">
          The SSD workspace has been unavailable since {formatRelativeTime(bridge.workspaceUnavailableSince)}. The job keeps
          waiting and picks up again when it is reconnected.
        </p>
      ) : null}

      {bridge.rejection ? (
        <p className="mt-3 text-[13px] leading-5 text-os-danger" role="status">
          Result not imported ({formatRelativeTime(bridge.rejection.at)}): {bridge.rejection.reason.replace(/ \[[0-9a-f]+\]$/, "")}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <CommandButton variant="primary" icon={copied === "ok" ? Check : Copy} onClick={() => void copy()}>
          {copied === "ok" ? "Copied" : "Copy Grok instruction"}
        </CommandButton>
        <span className="os-meta text-os-subtle" aria-live="polite">
          {copied === "failed" ? "Could not reach the clipboard. Select the text below instead" : null}
        </span>
      </div>

      {paths}

      <details className="mt-4">
        <summary className="os-focus-ring os-meta cursor-pointer rounded-sm text-os-subtle">Show the instruction</summary>
        <pre className="mt-2 overflow-auto rounded-md border border-os-border p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words text-os-muted">
          {bridge.instruction}
        </pre>
      </details>
    </section>
  );
}

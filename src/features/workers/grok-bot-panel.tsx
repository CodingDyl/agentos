import { Check, X } from "lucide-react";
import { useState } from "react";
import type { GrokBotTestResult } from "@shared/grok-bot-types";
import { CommandButton, FilterBar, HairlineCard, SectionLabel, StatusPill } from "@/components/os";
import { formatRelativeTime } from "@/lib/format";
import { useGrokBotStatus, useSaveGrokBotSettings, useTestGrokBotConnection } from "@/lib/agentos/queries";

/**
 * Grok Bot: Grok working through a folder on an SSD, triggered by hand.
 *
 * Every disk check happens on the server. This panel only says what the server
 * found, and is careful to say what folder access cannot show: whether Grok
 * itself is running or signed in.
 */

const TEXT_INPUT =
  "os-focus-ring mt-2 min-h-9 w-full rounded-md border border-os-border bg-transparent px-3 font-mono text-[13px] text-foreground placeholder:text-os-subtle";

export function GrokBotPanel() {
  const status = useGrokBotStatus();
  const save = useSaveGrokBotSettings();
  const test = useTestGrokBotConnection();
  const [pathEdit, setPathEdit] = useState<string>();
  const [result, setResult] = useState<GrokBotTestResult>();

  if (status.isPending) {
    return <p className="os-meta text-os-subtle">Checking Grok Bot…</p>;
  }
  if (!status.data) {
    return (
      <p className="text-[13px] leading-5 text-os-danger">Could not read Grok Bot status. {status.error?.message}</p>
    );
  }

  const { enabled, workspacePath, workspace } = status.data;
  const path = pathEdit ?? workspacePath;
  const dirty = path.trim() !== workspacePath;

  const pill = !enabled
    ? { status: "paused" as const, label: "Disabled" }
    : workspace.state === "available"
      ? { status: "healthy" as const, label: "Workspace available" }
      : { status: "attention" as const, label: "Workspace unavailable" };

  return (
    <HairlineCard>
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Grok Bot</SectionLabel>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-muted">
              Manually triggered · local file bridge. Folder access shows the workspace is reachable, not that Grok is
              online or signed in.
            </p>
          </div>
          <StatusPill status={pill.status} label={pill.label} />
        </div>

        {enabled && workspace.state !== "available" && workspace.reason ? (
          <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-subtle">{workspace.reason}</p>
        ) : null}

        <div className="mt-6 grid gap-6 border-t border-os-border pt-5 sm:grid-cols-[auto_1fr]">
          <div>
            <SectionLabel>Worker</SectionLabel>
            <FilterBar<"off" | "on">
              label="Grok Bot switch"
              className="mt-3"
              value={enabled ? "on" : "off"}
              onChange={(next) => save.mutate({ enabled: next === "on" })}
              options={[
                { value: "off", label: "Disabled" },
                { value: "on", label: "Enabled" },
              ]}
            />
          </div>

          <label className="block min-w-0">
            <SectionLabel>SSD workspace path</SectionLabel>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={path}
              placeholder="/Volumes/<SSD>/grok-bot"
              onChange={(event) => setPathEdit(event.target.value)}
              className={TEXT_INPUT}
            />
            <span className="os-meta mt-2 block text-os-subtle">
              The folder holding memory/, tasks/ and results/. Nothing is created if it is missing
            </span>
          </label>
        </div>

        {save.isError ? <p className="mt-3 text-[13px] leading-5 text-os-danger">{save.error.message}</p> : null}
        {test.isError ? <p className="mt-3 text-[13px] leading-5 text-os-danger">{test.error.message}</p> : null}

        {result ? (
          <div className="mt-5 border-t border-os-border pt-5" aria-live="polite">
            <SectionLabel>
              Connection test · {result.state === "available" ? "passed" : "failed"} {formatRelativeTime(result.testedAt)}
            </SectionLabel>
            {result.checks.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {result.checks.map((check) => (
                  <li key={check.name} className="flex items-start gap-2 text-[13px] leading-5">
                    {check.ok ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-os-success" aria-label="Passed" />
                    ) : (
                      <X className="mt-0.5 size-3.5 shrink-0 text-os-danger" aria-label="Failed" />
                    )}
                    <span className={check.ok ? "text-os-muted" : "text-foreground"}>
                      {check.name}
                      {!check.ok && check.detail ? <span className="text-os-subtle"> · {check.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] leading-5 text-os-subtle">{result.reason}</p>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <CommandButton
            variant="primary"
            disabled={!dirty || save.isPending}
            loading={save.isPending && dirty}
            loadingLabel="Saving"
            onClick={() => save.mutate({ workspacePath: path.trim() }, { onSuccess: () => setPathEdit(undefined) })}
          >
            Save path
          </CommandButton>
          <CommandButton
            variant="secondary"
            disabled={dirty || !workspacePath || test.isPending}
            loading={test.isPending}
            loadingLabel="Testing"
            onClick={() => test.mutate(undefined, { onSuccess: setResult })}
          >
            Test connection
          </CommandButton>
        </div>
      </div>
    </HairlineCard>
  );
}

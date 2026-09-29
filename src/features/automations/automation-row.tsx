import { ArrowUpRight, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Automation, AutomationControl } from "@shared/agentos-types";
import { PAPER_FOCUS, PaperButton, Tag } from "@/components/paper";
import { reportActivity } from "@/lib/agentos/client";
import { useControlAutomation } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { formatRunTime, formatSchedule, stateTag } from "./automations-model";

/** Past-tense receipts for each control, in the words the operator used. */
const DONE: Record<AutomationControl, string> = {
  run: "Queued. Hermes starts it within a minute.",
  pause: "Paused. It won't run until you resume it.",
  resume: "Resumed. It's back on its schedule.",
};

/** One labelled fact in the row's footing. */
function Fact({ label, value, tone = "char" }: { label: string; value: string; tone?: "char" | "flame" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-paper-sage">{label}</dt>
      <dd className={cn("mt-0.5 text-[13.5px] leading-5", tone === "flame" ? "text-paper-flame-deep" : "text-paper-char")}>
        {value}
      </dd>
    </div>
  );
}

export interface AutomationRowProps {
  automation: Automation;
  /** Fixed so a test, or a late-night reading, is not relative to the render. */
  now?: Date;
}

/**
 * One scheduled job: what it does, when it runs, whether it worked — and the
 * three things AgentOS may do to it. A failure is not softened into a status
 * word; the reason Hermes gave is shown on the row itself.
 */
export function AutomationRow({ automation, now }: AutomationRowProps) {
  const control = useControlAutomation();
  const [receipt, setReceipt] = useState<string | undefined>();
  const tag = stateTag(automation);
  const lastRun = automation.lastRun;
  const nextRun = formatRunTime(automation.nextRun, now);
  const recipe = automation.recipe;
  const finished = automation.state === "completed";
  const paused = automation.state === "paused";
  const pending = control.isPending ? control.variables?.control : undefined;

  const act = (next: AutomationControl) => {
    setReceipt(undefined);
    if (next === "run") void reportActivity({ type: "automation.run", description: automation.name });
    control.mutate(
      { id: automation.id, control: next },
      {
        onSuccess: () => setReceipt(DONE[next]),
        onError: (error) => setReceipt(error instanceof Error ? error.message : "Hermes didn't accept that."),
      },
    );
  };

  return (
    <li className="flex flex-col gap-4 px-5 py-5 md:px-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Link
            to={`/automations/${automation.id}`}
            className={cn(
              "rounded-[2px] font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss underline-offset-4 hover:underline",
              PAPER_FOCUS,
            )}
          >
            {automation.name}
          </Link>
          <Tag tone={tag.tone}>{tag.label}</Tag>
        </div>
        <p className="mt-1 text-[14px] text-paper-char">{formatSchedule(automation.schedule)}</p>

        {recipe?.prompt ? (
          <p className="mt-3 line-clamp-2 max-w-[80ch] text-[13.5px] leading-[1.55] text-paper-sage">{recipe.prompt}</p>
        ) : recipe?.script ? (
          <p className="mt-3 truncate font-mono text-[12.5px] text-paper-sage">{recipe.script}</p>
        ) : null}

        {automation.skills.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills">
            {automation.skills.map((skill) => (
              <Tag key={skill}>{skill}</Tag>
            ))}
          </div>
        ) : null}

        {lastRun?.status === "failed" && lastRun.detail ? (
          <p className="mt-3 max-w-[80ch] font-mono text-[12.5px] leading-5 break-words text-paper-flame-deep">
            {lastRun.detail}
          </p>
        ) : null}

        <dl className="mt-4 grid max-w-[640px] grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <Fact
            label="Last run"
            tone={lastRun?.status === "failed" ? "flame" : "char"}
            value={
              lastRun
                ? `${lastRun.status === "failed" ? "Failed" : lastRun.status === "running" ? "Running" : "Worked"} · ${
                    formatRunTime(lastRun.timestamp, now) ?? lastRun.timestamp
                  }`
                : "Never run"
            }
          />
          <Fact label="Next run" value={nextRun ?? (paused ? "Paused" : "Not scheduled")} />
          <Fact label="Delivers to" value={recipe?.deliver ?? "-"} />
        </dl>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {!finished ? (
            <PaperButton variant="ghost" disabled={control.isPending} onClick={() => act("run")}>
              <Play className="size-3.5" aria-hidden="true" />
              {pending === "run" ? "Queuing…" : "Run now"}
            </PaperButton>
          ) : null}
          {paused ? (
            <PaperButton variant="quiet" disabled={control.isPending} onClick={() => act("resume")}>
              <Play className="size-3.5" aria-hidden="true" />
              {pending === "resume" ? "Resuming…" : "Resume"}
            </PaperButton>
          ) : automation.state === "active" ? (
            <PaperButton variant="quiet" disabled={control.isPending} onClick={() => act("pause")}>
              <Pause className="size-3.5" aria-hidden="true" />
              {pending === "pause" ? "Pausing…" : "Pause"}
            </PaperButton>
          ) : null}
          <Link
            to={`/automations/${automation.id}`}
            className={cn(
              "inline-flex min-h-8 items-center gap-1 rounded-none px-3 text-[13.5px] font-semibold text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
              PAPER_FOCUS,
            )}
          >
            Details
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <p
          className={cn(
            "min-h-5 max-w-[34ch] text-[12.5px] lg:text-right",
            control.isError ? "text-paper-flame-deep" : "text-paper-sage",
          )}
          role="status"
          aria-live="polite"
        >
          {receipt ?? ""}
        </p>
      </div>
    </li>
  );
}

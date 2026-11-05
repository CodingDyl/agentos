import { ArrowRight, FolderPlus, Inbox, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { FocusSummary } from "@shared/mission-control-types";
import { Meter, PAPER_FOCUS, PaperButton, PaperSection, Tag } from "@/components/paper";
import { describeDays, HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { useQuickCreate } from "@/features/workspace/quick-create-context";
import { cn } from "@/lib/utils";
import { TodayLabel } from "./today-kit";

const HEALTH_TAG = { on_track: "green", at_risk: "marigold", blocked: "flame", no_target: "muted" } as const;
const HEALTH_METER = { on_track: "green", at_risk: "amber", blocked: "flame", no_target: "ink" } as const;

/**
 * What the day is about.
 *
 * The one part of the Dashboard that is not derived from machine state. It
 * comes from `CURRENT_FOCUS.md`, the operator's own account of their
 * priorities: written by hand, changed deliberately, never regenerated on
 * refresh.
 *
 * It is also the launchpad: starting work, adding a task, creating a workspace
 * and capturing a note. All of them are neutral here. The Dashboard's one filled
 * action is Plan the day.
 */
export function FocusBlock({ focus, className }: { focus: FocusSummary; className?: string }) {
  const navigate = useNavigate();
  const quickCreate = useQuickCreate();

  // Hands off to the agent console with the workspace in context; the console
  // prepares `/work-on` and the operator still chooses to send it.
  const startFocus = () => {
    if (!focus.projectSlug) return;
    navigate(`/agent?project=${encodeURIComponent(focus.projectSlug)}`);
  };

  const milestone = focus.milestone;
  const days = milestone?.progress.daysToTarget;

  return (
    <PaperSection
      label="Primary focus"
      className={className}
      action={
        focus.projectSlug ? (
          <Link
            to={`/workspaces/${focus.projectSlug}`}
            className={cn("inline-flex min-h-8 items-center rounded-md px-1.5 text-[14px] leading-5 text-paper-char transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
          >
            Open workspace
          </Link>
        ) : (
          <span className="text-[13px] leading-5 text-paper-sage">No workspace resolved from the focus file</span>
        )
      }
    >
      <p className="text-[14px] leading-[22px] font-medium text-paper-moss">{focus.project ?? "No focus set"}</p>
      <p className="mt-0.5 max-w-[62ch] text-[14px] leading-[22px] text-paper-char">{focus.outcome}</p>

      {milestone ? (
        <div className="mt-4 max-w-[34rem]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Link
              to={focus.projectSlug ? `/workspaces/${focus.projectSlug}?tab=roadmap&milestone=${milestone.id}` : "/workspaces"}
              className={cn("rounded-sm text-[14px] leading-[22px] font-medium text-paper-moss hover:underline", PAPER_FOCUS)}
            >
              {milestone.title}
            </Link>
            <span className="text-[13px] leading-5 text-paper-sage tabular-nums">
              {milestone.progress.completed} / {milestone.progress.total} tasks · {milestone.progress.percent}%
            </span>
          </div>
          <div className="mt-2">
            <Meter
              value={milestone.progress.percent / 100}
              label={`${milestone.title} progress`}
              tone={HEALTH_METER[focus.health ?? "no_target"]}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {focus.health ? <Tag tone={HEALTH_TAG[focus.health]}>{HEALTH_LABELS[focus.health]}</Tag> : null}
            <span className={cn("text-[13px] leading-5", days !== undefined && days < 0 ? "text-paper-flame-deep" : "text-paper-sage")}>
              {days !== undefined ? `Target: ${describeDays(days)}` : "No target date"}
            </span>
          </div>
        </div>
      ) : null}

      {focus.nextReady || focus.nextAction || focus.watch ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-paper-mist pt-3 sm:grid-cols-2">
          {focus.nextReady ? (
            <div className="min-w-0">
              <dt>
                <TodayLabel>Next ready task</TodayLabel>
              </dt>
              <dd className="mt-0.5 text-[14px] leading-[22px] text-paper-moss">
                <span className="os-mono mr-2 text-paper-sage">{focus.nextReady.id}</span>
                {focus.nextReady.title}
              </dd>
            </div>
          ) : focus.nextAction ? (
            <div className="min-w-0">
              <dt>
                <TodayLabel>Next action</TodayLabel>
              </dt>
              <dd className="mt-0.5 text-[14px] leading-[22px] text-paper-moss">{focus.nextAction}</dd>
            </div>
          ) : null}
          {focus.watch ? (
            <div className="min-w-0">
              <dt>
                <TodayLabel>Watch</TodayLabel>
              </dt>
              <dd className="mt-0.5 text-[14px] leading-[22px] text-paper-marigold">{focus.watch}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PaperButton variant="ghost" disabled={!focus.projectSlug} onClick={startFocus}>
          Start focus
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </PaperButton>
        <PaperButton variant="quiet" onClick={() => quickCreate.open("task", { project: focus.projectSlug ?? undefined })}>
          <Plus className="size-3.5" aria-hidden="true" />
          Task
        </PaperButton>
        <PaperButton variant="quiet" onClick={() => quickCreate.open("project")}>
          <FolderPlus className="size-3.5" aria-hidden="true" />
          Workspace
        </PaperButton>
        <PaperButton variant="quiet" onClick={() => quickCreate.open("capture", { project: focus.projectSlug ?? undefined })}>
          <Inbox className="size-3.5" aria-hidden="true" />
          Capture
        </PaperButton>
        {focus.inboxCount > 0 ? (
          <span className="text-[13px] leading-5 text-paper-sage sm:ml-auto">{focus.inboxCount} in the workspace inbox</span>
        ) : null}
      </div>
    </PaperSection>
  );
}

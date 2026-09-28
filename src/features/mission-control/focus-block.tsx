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
 * The one part of Today that is not derived from machine state. It comes from
 * `CURRENT_FOCUS.md`, the operator's own account of their priorities: written
 * by hand, changed deliberately, never regenerated on refresh.
 *
 * It is also the launchpad. Starting work, adding a task, creating a workspace
 * and capturing a note are the four things a day begins with, so they sit
 * here. Start focus is the page's one amber action.
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
    <PaperSection label="Primary focus" className={className}>
      <div className="rounded-[4px] border border-paper-mist px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-paper-display text-[24px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss">
            {focus.project ?? "No focus set"}
          </h2>
          {focus.projectSlug ? (
            <Link
              to={`/workspaces/${focus.projectSlug}`}
              className={cn("rounded-[2px] text-[13px] font-medium text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}
            >
              Open workspace
            </Link>
          ) : (
            <span className="text-[12.5px] text-paper-sage">No workspace resolved from the focus file</span>
          )}
        </div>

        <p className="mt-2 max-w-[62ch] text-[15px] leading-6 text-paper-char">{focus.outcome}</p>

        {milestone ? (
          <div className="mt-5 max-w-[34rem]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link
                to={focus.projectSlug ? `/workspaces/${focus.projectSlug}?tab=roadmap&milestone=${milestone.id}` : "/workspaces"}
                className={cn("rounded-[2px] text-[14.5px] font-semibold text-paper-moss hover:underline", PAPER_FOCUS)}
              >
                {milestone.title}
              </Link>
              <span className="text-[12.5px] text-paper-sage tabular-nums">
                {milestone.progress.completed} / {milestone.progress.total} tasks · {milestone.progress.percent}%
              </span>
            </div>
            <div className="mt-2">
              <Meter
                value={milestone.progress.percent / 100}
                label={`${milestone.title} progress`}
                tone={HEALTH_METER[focus.health ?? "no_target"]}
                size="md"
              />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {focus.health ? <Tag tone={HEALTH_TAG[focus.health]}>{HEALTH_LABELS[focus.health]}</Tag> : null}
              <span className={cn("text-[12.5px]", days !== undefined && days < 0 ? "text-paper-flame-deep" : "text-paper-sage")}>
                {days !== undefined ? `Target: ${describeDays(days)}` : "No target date"}
              </span>
            </div>
          </div>
        ) : null}

        {focus.nextReady || focus.nextAction || focus.watch ? (
          <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-paper-stone pt-4 sm:grid-cols-2">
            {focus.nextReady ? (
              <div className="min-w-0">
                <dt>
                  <TodayLabel>Next ready task</TodayLabel>
                </dt>
                <dd className="mt-1 text-[14px] leading-6 text-paper-moss">
                  <span className="mr-2 text-[12.5px] text-paper-sage">{focus.nextReady.id}</span>
                  {focus.nextReady.title}
                </dd>
              </div>
            ) : focus.nextAction ? (
              <div className="min-w-0">
                <dt>
                  <TodayLabel>Next action</TodayLabel>
                </dt>
                <dd className="mt-1 text-[14px] leading-6 text-paper-moss">{focus.nextAction}</dd>
              </div>
            ) : null}
            {focus.watch ? (
              <div className="min-w-0">
                <dt>
                  <TodayLabel>Watch</TodayLabel>
                </dt>
                <dd className="mt-1 text-[13.5px] leading-5 text-paper-flame-deep">{focus.watch}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={!focus.projectSlug} onClick={startFocus}>
            Start focus
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </PaperButton>
          <PaperButton variant="ghost" onClick={() => quickCreate.open("task", { project: focus.projectSlug ?? undefined })}>
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
            <span className="ml-auto text-[12.5px] text-paper-sage">{focus.inboxCount} in the workspace inbox</span>
          ) : null}
        </div>
      </div>
    </PaperSection>
  );
}

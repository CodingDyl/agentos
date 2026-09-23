import { ArrowRight, FolderPlus, Inbox, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { FocusSummary } from "@shared/mission-control-types";
import { CommandButton, ProgressBar, SectionLabel, StatusPill } from "@/components/os";
import { describeDays, HEALTH_LABELS, healthPill, healthTone } from "@/features/projects/roadmap-model";
import { useQuickCreate } from "@/features/workspace/quick-create-context";
import { cn } from "@/lib/utils";

/**
 * What the day is about.
 *
 * The one part of Mission Control that is not derived from machine state. It
 * comes from `CURRENT_FOCUS.md`, which is the operator's own account of their
 * priorities — written by hand, changed deliberately, and emphatically not
 * regenerated on every refresh. A focus that a model rewrote each morning
 * would not be a focus.
 *
 * It sits at the top because the ranking below it only means anything against
 * it: "what needs me" is a different question when you already know what today
 * is for.
 *
 * It is also the launchpad. Starting work, adding a task, creating a project
 * and capturing a note are the four things a day actually begins with, so they
 * sit here rather than a click away — Mission Control is where you act, not
 * only where you look.
 */

export interface FocusBlockProps {
  focus: FocusSummary;
  className?: string;
}

export function FocusBlock({ focus, className }: FocusBlockProps) {
  const navigate = useNavigate();
  const quickCreate = useQuickCreate();

  // Hands off to the agent console with the project in context. The console
  // prepares `/work-on`; the operator still chooses to send it. Mission Control
  // starts no session of its own — there is already a flow that does this.
  const startFocus = () => {
    if (!focus.projectSlug) return;
    navigate(`/agent?project=${encodeURIComponent(focus.projectSlug)}`);
  };

  return (
    <section aria-label="Primary focus" className={cn("min-w-0", className)}>
      <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <SectionLabel>Primary focus</SectionLabel>

          <h2 className="mt-4 max-w-[20ch] text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
            {focus.project ?? "No focus set"}
          </h2>

          <p className="mt-4 max-w-[58ch] text-[15px] leading-6 text-os-muted">
            {focus.outcome}
          </p>

          {/* The milestone is what makes "start work" mean something: not a
              project name but what is being shipped, how far along, and how
              long is left. All of it derived from the roadmap; none of it a
              model's opinion. */}
          {focus.milestone ? (
            <div className="mt-6 max-w-[32rem]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <Link
                  to={focus.projectSlug ? `/projects/${focus.projectSlug}?tab=roadmap&milestone=${focus.milestone.id}` : "/projects"}
                  className="os-focus-ring -mx-1 cursor-pointer rounded-md px-1 text-[16px] leading-6 text-foreground transition-colors duration-150 hover:text-os-amber"
                >
                  {focus.milestone.title}
                </Link>
                <span className="os-meta text-os-subtle tabular-nums">
                  {focus.milestone.progress.completed} / {focus.milestone.progress.total} tasks ·{" "}
                  {focus.milestone.progress.percent}%
                </span>
              </div>
              <ProgressBar
                percent={focus.milestone.progress.percent}
                label={`${focus.milestone.title} progress`}
                tone={healthTone(focus.health ?? "no_target")}
                className="mt-2.5"
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {focus.health ? <StatusPill status={healthPill(focus.health)} label={HEALTH_LABELS[focus.health]} /> : null}
                {focus.milestone.progress.daysToTarget !== undefined ? (
                  <span className={`os-meta ${focus.milestone.progress.daysToTarget < 0 ? "text-os-warning" : "text-os-subtle"}`}>
                    Target / {describeDays(focus.milestone.progress.daysToTarget)}
                  </span>
                ) : (
                  <span className="os-meta text-os-subtle">No target date</span>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
            <CommandButton
              variant="primary"
              icon={ArrowRight}
              disabled={!focus.projectSlug}
              onClick={startFocus}
            >
              Start focus
            </CommandButton>

            {/* Quick Create, scoped to the focus project when there is one so a
                task added from here lands where the day is pointed. */}
            <CommandButton
              variant="secondary"
              icon={Plus}
              iconPosition="start"
              onClick={() => quickCreate.open("task", { project: focus.projectSlug ?? undefined })}
            >
              Task
            </CommandButton>
            <CommandButton
              variant="secondary"
              icon={FolderPlus}
              iconPosition="start"
              onClick={() => quickCreate.open("project")}
            >
              Project
            </CommandButton>
            <CommandButton
              variant="secondary"
              icon={Inbox}
              iconPosition="start"
              onClick={() => quickCreate.open("capture", { project: focus.projectSlug ?? undefined })}
            >
              Capture
            </CommandButton>

            {focus.projectSlug ? (
              <Link
                to={`/projects/${focus.projectSlug}`}
                className="os-focus-ring os-meta -mx-2 inline-flex min-h-10 cursor-pointer items-center rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
              >
                Open project
              </Link>
            ) : (
              <span className="os-meta text-os-subtle">
                No project resolved from the focus file
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 lg:pt-1">
          {focus.nextReady ? (
            <div>
              <SectionLabel>Next ready task</SectionLabel>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-foreground">
                <span className="os-meta mr-2 text-os-subtle">{focus.nextReady.id}</span>
                {focus.nextReady.title}
              </p>
            </div>
          ) : focus.nextAction ? (
            <div>
              <SectionLabel>Next action</SectionLabel>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-foreground">
                {focus.nextAction}
              </p>
            </div>
          ) : null}

          {/* The risk the focus file says to carry into the day. Amber,
              because the vault flagged it deliberately and it is the one piece
              of standing advice on the screen. */}
          {focus.watch ? (
            <div className={focus.nextAction || focus.nextReady ? "mt-8" : undefined}>
              <SectionLabel>Watch</SectionLabel>
              <p className="mt-4 max-w-[46ch] text-[13px] leading-5 text-os-warning">
                {focus.watch}
              </p>
            </div>
          ) : null}

          {focus.inboxCount > 0 ? (
            <p className="os-meta mt-8 text-os-subtle">
              Inbox / {focus.inboxCount}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

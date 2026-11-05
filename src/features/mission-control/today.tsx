import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { CapturedItem, ProjectSummary } from "@shared/agentos-types";
import { WORKSPACE_TYPE_LABELS } from "@shared/workspace";
import { Meter, PAPER_FOCUS, PaperSection, Tag } from "@/components/paper";
import { HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { cn } from "@/lib/utils";
import { TodayLink } from "./today-kit";

/**
 * The top of the Dashboard: the shape of the day in four short phrases, each a
 * link to where the thing actually is. Phrases, not metrics: "3 tasks" is
 * something a person reads and nods at; a big number with a small label is
 * something they learn to skip.
 */
export function TodayStrip({
  projects,
  attention,
  cleared,
  running,
  captures,
  className,
}: {
  projects: readonly ProjectSummary[];
  attention: number;
  /** Approvals cleared from the Dashboard but still current. */
  cleared: number;
  running: number;
  captures: readonly CapturedItem[];
  className?: string;
}) {
  const live = projects.filter((project) => project.state === "active" || project.state === "blocked");
  const planned = live.reduce((sum, project) => sum + (project.nowCount ?? 0), 0);
  const withPlans = live.filter((project) => (project.nowCount ?? 0) > 0).length;

  const taskWord = planned === 1 ? "task" : "tasks";
  const cells: { key: string; text: string; href: string; warn?: boolean }[] = [
    {
      key: "planned",
      text: planned === 0 ? "Nothing in Now" : `${planned} ${taskWord}${withPlans > 1 ? ` / ${withPlans} workspaces` : ""}`,
      href: "/workspaces",
    },
    {
      key: "attention",
      text: attention === 0 ? "No approvals waiting" : `${attention} ${attention === 1 ? "approval" : "approvals"} waiting`,
      // With nothing waiting or cleared there is no queue to jump to, so this
      // goes where a finished decision can be checked instead.
      href: attention > 0 || cleared > 0 ? "#needs-you" : "/activity",
      warn: attention > 0,
    },
    {
      key: "running",
      text: running === 0 ? "Agents idle" : `${running} ${running === 1 ? "agent" : "agents"} working`,
      href: "#active-work",
    },
    {
      key: "captured",
      text: captures.length === 0 ? "Nothing to file" : `${captures.length} ${captures.length === 1 ? "note" : "notes"} to file`,
      href: "#captured",
    },
  ];

  return (
    <ul aria-label="Today at a glance" className={cn("qt-summary", className)}>
      {cells.map((cell) => {
        const body = (
          <>
            <span className={cn("flex items-center gap-1.5 text-[14px] leading-[22px] font-medium tabular-nums", cell.warn ? "text-paper-marigold" : "text-paper-moss")}>
              {cell.warn ? <TriangleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" /> : null}
              {cell.text}
            </span>
          </>
        );
        return (
          <li key={cell.key} className="min-w-0">
            {cell.href.startsWith("#") ? (
              <a href={cell.href} className={PAPER_FOCUS}>
                {body}
              </a>
            ) : (
              <Link to={cell.href} className={PAPER_FOCUS}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * The areas of work in play, one card each: where it is heading and what is
 * next. The focus workspace is left out; it has its own block above.
 */
export function TodayWorkspaces({
  projects,
  focus,
  className,
}: {
  projects: readonly ProjectSummary[];
  focus?: string;
  className?: string;
}) {
  const live = projects
    .filter((project) => (project.state === "active" || project.state === "blocked") && project.slug !== focus)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name))
    .slice(0, 6);

  return (
    <PaperSection label="Workspaces" className={className} action={<TodayLink to="/workspaces">All workspaces</TodayLink>}>
      {live.length === 0 ? (
        <p className="text-[14px] text-paper-char">No other workspace is in play.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {live.map((project) => {
            const trouble = project.state === "blocked" || project.health === "blocked" || project.health === "at_risk";
            return (
              <li key={project.slug} className="min-w-0">
                <Link
                  to={`/workspaces/${project.slug}`}
                  className={cn(
                    "block h-full rounded-md bg-paper-linen px-4 py-3 transition-colors duration-150 hover:bg-paper-stone",
                    PAPER_FOCUS,
                  )}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-[14px] font-semibold text-paper-moss">{project.name}</span>
                    {trouble ? (
                      <Tag tone="flame">
                        {project.state === "blocked" ? "Blocked" : HEALTH_LABELS[project.health ?? "at_risk"]}
                      </Tag>
                    ) : (
                      <span className="shrink-0 text-[13px] text-paper-sage">
                        {WORKSPACE_TYPE_LABELS[project.workspaceType ?? "general"]}
                      </span>
                    )}
                  </span>

                  {project.milestone ? (
                    <span className="mt-3 block">
                      <span className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate text-paper-char">{project.milestone.title}</span>
                        <span className="shrink-0 text-paper-sage tabular-nums">{project.milestone.progress.percent}%</span>
                      </span>
                      <span className="mt-1.5 block">
                        <Meter
                          value={project.milestone.progress.percent / 100}
                          label={`${project.milestone.title} progress`}
                          tone={trouble ? "flame" : "amber"}
                        />
                      </span>
                    </span>
                  ) : null}

                  <span className="mt-2.5 block truncate text-[13px] text-paper-sage">
                    {project.nextAction ? `Next: ${project.nextAction}` : (project.status ?? "No next action queued.")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PaperSection>
  );
}

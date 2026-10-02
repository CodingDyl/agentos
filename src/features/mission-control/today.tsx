import { Link } from "react-router-dom";
import type { CapturedItem, ProjectSummary } from "@shared/agentos-types";
import { WORKSPACE_TYPE_LABELS } from "@shared/workspace";
import { Meter, PAPER_FOCUS, PaperSection, Tag } from "@/components/paper";
import { HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { cn } from "@/lib/utils";
import { TodayLink } from "./today-kit";

/**
 * The top of Today: the shape of the day in four plain sentences, each a link
 * to where the thing actually is. Sentences, not metrics: "3 tasks planned"
 * is something a person reads and nods at; a big number with a small label is
 * something they learn to skip.
 */
export function TodayStrip({
  projects,
  attention,
  running,
  captures,
  className,
}: {
  projects: readonly ProjectSummary[];
  attention: number;
  running: number;
  captures: readonly CapturedItem[];
  className?: string;
}) {
  const live = projects.filter((project) => project.state === "active" || project.state === "blocked");
  const planned = live.reduce((sum, project) => sum + (project.nowCount ?? 0), 0);
  const withPlans = live.filter((project) => (project.nowCount ?? 0) > 0).length;

  const cells: { key: string; label: string; text: string; href: string; loud?: boolean }[] = [
    {
      key: "planned",
      label: "Planned",
      text:
        planned === 0
          ? "Nothing in Now"
          : `${planned} ${planned === 1 ? "task" : "tasks"}${withPlans > 1 ? ` across ${withPlans} workspaces` : ""}`,
      href: "/workspaces",
    },
    {
      key: "attention",
      label: "Needs you",
      text: attention === 0 ? "Nothing waiting" : `${attention} ${attention === 1 ? "thing" : "things"} waiting`,
      href: "#needs-you",
      loud: attention > 0,
    },
    {
      key: "running",
      label: "Agents",
      text: running === 0 ? "None working" : `${running} working now`,
      href: "#active-work",
    },
    {
      key: "captured",
      label: "Captured",
      text: captures.length === 0 ? "Nothing to file" : `${captures.length} ${captures.length === 1 ? "note" : "notes"} to file`,
      href: "#captured",
    },
  ];

  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-none border border-paper-mist bg-paper-mist lg:grid-cols-4",
        className,
      )}
    >
      {cells.map((cell) => {
        const body = (
          <>
            <span className="block text-[12.5px] font-medium text-paper-sage">{cell.label}</span>
            <span
              className={cn(
                "mt-1 block text-[15.5px] leading-6 font-semibold",
                cell.loud ? "text-paper-flame-deep" : "text-paper-moss",
              )}
            >
              {cell.text}
            </span>
          </>
        );
        const classes = cn(
          "block h-full bg-paper-white px-4 py-3.5 transition-colors duration-150 hover:bg-paper-cream focus-visible:relative",
          PAPER_FOCUS,
        );
        return (
          <li key={cell.key} className="min-w-0">
            {cell.href.startsWith("#") ? (
              <a href={cell.href} className={classes}>
                {body}
              </a>
            ) : (
              <Link to={cell.href} className={classes}>
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
                    "block h-full rounded-none border border-paper-mist px-4 py-3.5 transition-colors duration-150 hover:bg-paper-cream",
                    PAPER_FOCUS,
                  )}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-paper-display text-[15.5px] font-bold text-paper-moss">{project.name}</span>
                    {trouble ? (
                      <Tag tone="flame">
                        {project.state === "blocked" ? "Blocked" : HEALTH_LABELS[project.health ?? "at_risk"]}
                      </Tag>
                    ) : (
                      <span className="shrink-0 text-[12px] text-paper-sage">
                        {WORKSPACE_TYPE_LABELS[project.workspaceType ?? "general"]}
                      </span>
                    )}
                  </span>

                  {project.milestone ? (
                    <span className="mt-3 block">
                      <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
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

import { Link } from "react-router-dom";
import type { CapturedItem, ProjectSummary } from "@shared/agentos-types";
import { WORKSPACE_TYPE_LABELS } from "@shared/workspace";
import { ProgressBar, Section } from "@/components/os";
import { HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { cn } from "@/lib/utils";

/**
 * The top of Today: the shape of the day in four plain lines, and whatever was
 * captured and not yet filed.
 *
 * Sentences, not metrics. "3 tasks planned" is something a person reads and
 * nods at; a big number with a small label is something they learn to skip.
 * Each line is a link to where the thing actually is. No calendar yet —
 * that is its own piece of work — so nothing here pretends to know about
 * meetings.
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

  const lines: { key: string; text: string; href: string; loud?: boolean }[] = [
    {
      key: "planned",
      text:
        planned === 0
          ? "Nothing planned in Now"
          : `${planned} ${planned === 1 ? "task" : "tasks"} planned${withPlans > 1 ? ` across ${withPlans} workspaces` : ""}`,
      href: "/workspaces",
    },
    {
      key: "attention",
      text: attention === 0 ? "Nothing waiting on you" : `${attention} ${attention === 1 ? "thing needs" : "things need"} you`,
      href: "#needs-you",
      loud: attention > 0,
    },
    {
      key: "running",
      text: running === 0 ? "No agents working" : `${running} ${running === 1 ? "agent" : "agents"} working`,
      href: "#active-work",
    },
    {
      key: "captured",
      text: captures.length === 0 ? "Inbox of notes is empty" : `${captures.length} ${captures.length === 1 ? "note" : "notes"} captured, not filed`,
      href: "#captured",
    },
  ];

  const recent = [...captures].slice(-3).reverse();

  return (
    <div className={cn("grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)}>
      <Section label="Today">
        <ul className="space-y-2.5">
          {lines.map((line) => (
            <li key={line.key}>
              {line.href.startsWith("#") ? (
                <a
                  href={line.href}
                  className={cn(
                    "os-focus-ring -mx-1 inline-flex min-h-8 cursor-pointer items-center gap-3 rounded-md px-1 text-[17px] leading-7 transition-colors duration-150 hover:text-foreground",
                    line.loud ? "text-os-warning" : "text-os-muted",
                  )}
                >
                  {line.text}
                </a>
              ) : (
                <Link
                  to={line.href}
                  className="os-focus-ring -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-[17px] leading-7 text-os-muted transition-colors duration-150 hover:text-foreground"
                >
                  {line.text}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="captured"
        label="Captured"
        action={
          captures.length > 0 ? (
            <Link
              to={`/agent?run=${encodeURIComponent("/start-day")}`}
              className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              File with Hermes →
            </Link>
          ) : null
        }
      >
        {recent.length === 0 ? (
          <p className="text-[15px] leading-6 text-os-muted">
            Nothing waiting to be filed. Capture from anywhere with the pen in the top bar, or ⌘⇧C.
          </p>
        ) : (
          <ul className="space-y-3">
            {recent.map((item, index) => (
              <li key={`${index}-${item.text}`} className="flex min-w-0 items-baseline gap-3">
                <span className="size-1 shrink-0 translate-y-[-0.2em] rounded-full bg-os-subtle" aria-hidden="true" />
                <span className="min-w-0 text-[15px] leading-6 text-os-muted">
                  {item.text}
                  {item.workspace || item.kind ? (
                    <span className="os-meta ml-2 text-os-subtle">{item.workspace ?? item.kind}</span>
                  ) : null}
                </span>
              </li>
            ))}
            {captures.length > recent.length ? (
              <li className="os-meta pl-4 text-os-subtle">+{captures.length - recent.length} earlier</li>
            ) : null}
          </ul>
        )}
      </Section>
    </div>
  );
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * The areas of work in play, one line each: where it is heading and what is
 * next. The focus workspace is left out — it has its own block above.
 */
export function TodayWorkspaces({ projects, focus }: { projects: readonly ProjectSummary[]; focus?: string }) {
  const live = projects
    .filter((project) => (project.state === "active" || project.state === "blocked") && project.slug !== focus)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name))
    .slice(0, 6);

  return (
    <Section
      label="Workspaces"
      action={
        <Link
          to="/workspaces"
          className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          All workspaces →
        </Link>
      }
    >
      {live.length === 0 ? (
        <p className="text-[15px] leading-6 text-os-muted">No other workspace is in play.</p>
      ) : (
        <ul className="grid gap-x-12 gap-y-7 md:grid-cols-2">
          {live.map((project) => {
            const trouble = project.state === "blocked" || project.health === "blocked" || project.health === "at_risk";
            return (
              <li key={project.slug} className="min-w-0">
                <Link to={`/workspaces/${project.slug}`} className="os-focus-ring group block min-w-0 rounded-md">
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="truncate text-[17px] leading-6 text-foreground transition-colors duration-150 group-hover:text-os-amber">
                      {project.name}
                    </span>
                    <span className="os-meta shrink-0 text-os-subtle">{WORKSPACE_TYPE_LABELS[project.workspaceType ?? "general"]}</span>
                  </span>

                  {project.milestone ? (
                    <span className="mt-3 block">
                      <span className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
                        <span className="truncate text-os-muted">{project.milestone.title}</span>
                        <span className="shrink-0 text-os-subtle tabular-nums">{project.milestone.progress.percent}%</span>
                      </span>
                      <ProgressBar
                        percent={project.milestone.progress.percent}
                        label={`${project.milestone.title} progress`}
                        size="row"
                        tone={trouble ? "warning" : "amber"}
                        className="mt-2"
                      />
                    </span>
                  ) : null}

                  <span className="mt-2.5 block truncate text-[13px] leading-5 text-os-subtle">
                    {trouble
                      ? project.state === "blocked"
                        ? "Blocked"
                        : HEALTH_LABELS[project.health ?? "at_risk"]
                      : project.nextAction
                        ? `Next: ${project.nextAction}`
                        : (project.status ?? "No next action queued.")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

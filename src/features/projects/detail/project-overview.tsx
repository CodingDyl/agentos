import { ArrowRight, GitBranch } from "lucide-react";
import type { ProjectDetail } from "@shared/agentos-types";
import { EmptyState, HairlineCard, Section, StatusPill } from "@/components/os";
import { InlineEdit } from "@/features/workspace";
import { useProjectProse, useWriteProse } from "@/lib/agentos/queries";
import { ProjectDesignsStrip } from "./project-designs";

export interface ProjectOverviewProps {
  project: ProjectDetail;
  onOpenSettings: () => void;
  /** Opens the Repository tab, where the branch can actually be changed. */
  onOpenRepository: () => void;
}

/**
 * Answers one question: where is this project right now?
 *
 * Three prose fields edited in place — status, next milestone, purpose — the
 * repository's state, the last session, and the way into designs. No dialogs:
 * each `[ EDIT ]` swaps the paragraph for a textarea and writes the one
 * section it belongs to.
 */
export function ProjectOverview({
  project,
  onOpenSettings,
  onOpenRepository,
}: ProjectOverviewProps) {
  const latestSession = project.sessions.at(0);
  const { git } = project;

  // The prose is read separately from the project detail, because editing needs
  // the exact body under the heading and the revision to write against — the
  // detail carries a condensed one-liner meant for a row.
  const prose = useProjectProse(project.slug);
  const write = useWriteProse(project.slug);

  const isClean = git.workingTree === "clean";

  return (
    <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-x-16">
      <div className="space-y-10 lg:col-start-1">
        <InlineEdit
          label="Current status"
          value={prose.data?.status.body}
          placeholder="No status recorded in STATUS.md."
          busy={prose.isPending}
          onReload={() => void prose.refetch()}
          onSave={(body) =>
            write.mutateAsync({ field: "status", body, expectedRevision: prose.data?.status.revision })
          }
        />

        <InlineEdit
          label="Next milestone"
          value={prose.data?.milestone.body}
          placeholder="No milestone set. What does the next meaningful step look like?"
          busy={prose.isPending}
          rows={2}
          onReload={() => void prose.refetch()}
          onSave={(body) =>
            write.mutateAsync({ field: "milestone", body, expectedRevision: prose.data?.milestone.revision })
          }
        />

        <InlineEdit
          label="Purpose"
          value={prose.data?.purpose.body}
          placeholder="No purpose recorded in PROJECT.md."
          busy={prose.isPending}
          rows={6}
          onReload={() => void prose.refetch()}
          onSave={(body) =>
            write.mutateAsync({ field: "purpose", body, expectedRevision: prose.data?.purpose.revision })
          }
        />
      </div>

      <div className="space-y-10 lg:col-start-2 lg:row-start-1">
        <Section label="Next action">
          {project.nextAction ? (
            <p className="text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.4] text-foreground">{project.nextAction}</p>
          ) : (
            <EmptyState variant="inline" description="No task is queued in the Now list." />
          )}
        </Section>

        <Section
          label="Repository"
          action={
            <button
              type="button"
              onClick={onOpenSettings}
              className="os-focus-ring os-meta -mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              {git.repositoryPath ? "Change" : "Set repository"}
            </button>
          }
        >
          {!git.repositoryPath ? (
            <EmptyState
              variant="inline"
              description="No local repository is linked. Workers need one to run; set it in Settings."
            />
          ) : git.unavailable ? (
            <div>
              <p className="truncate font-mono text-[11px] tracking-[0.04em] text-os-subtle">{git.repositoryPath}</p>
              <p className="mt-3 text-[14px] leading-5 text-os-warning">{git.unavailable}</p>
            </div>
          ) : (
            <HairlineCard className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <GitBranch className="size-4 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                  <span className="truncate font-mono text-[14px] text-foreground">{git.branch ?? "Detached HEAD"}</span>
                </div>
                <StatusPill
                  status={isClean ? "healthy" : "attention"}
                  label={isClean ? "Clean" : `${git.changedFiles.length} changed`}
                  className="shrink-0"
                />
              </div>
              <p className="mt-3 truncate font-mono text-[11px] tracking-[0.04em] text-os-subtle">{git.repositoryPath}</p>
              {project.configuration.defaultBranch && project.configuration.defaultBranch !== git.branch ? (
                <p className="mt-3 text-[13px] leading-5 text-os-subtle">
                  Workers branch from <span className="font-mono">{project.configuration.defaultBranch}</span>.
                </p>
              ) : null}
              {git.changedFiles.length > 0 ? (
                <ul className="mt-4 space-y-1 border-t border-os-border pt-4">
                  {git.changedFiles.slice(0, 5).map((file) => (
                    <li key={`${file.status}-${file.path}`} className="flex items-center gap-3">
                      <span className="os-meta w-16 shrink-0 text-os-subtle">{file.status}</span>
                      <span className="min-w-0 truncate font-mono text-[12px] text-os-muted">{file.path}</span>
                    </li>
                  ))}
                  {git.changedFiles.length > 5 ? (
                    <li className="os-meta pt-1 text-os-subtle">+{git.changedFiles.length - 5} more</li>
                  ) : null}
                </ul>
              ) : null}

              {/* This card says what the repository is; the tab is where it can
                  be changed. One link rather than a second set of buttons. */}
              <button
                type="button"
                onClick={onOpenRepository}
                className="os-focus-ring os-meta mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-os-subtle transition-colors duration-150 hover:text-foreground"
              >
                Branches and actions
                <ArrowRight className="size-3" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </HairlineCard>
          )}
        </Section>

        <Section label="Recent session">
          {latestSession ? (
            <HairlineCard className="p-5">
              <p className="os-meta text-os-subtle">{latestSession.date}</p>
              <p className="mt-3 text-[15px] leading-6 text-os-muted">
                {latestSession.resumeHere ?? latestSession.completed?.[0] ?? "No detail recorded for this session."}
              </p>
            </HairlineCard>
          ) : (
            <EmptyState variant="inline" description="No work sessions recorded yet. Stopping a session writes one." />
          )}
        </Section>

        <ProjectDesignsStrip slug={project.slug} />
      </div>
    </div>
  );
}

import { Check, GitBranch, GitCommitHorizontal, Plus, TriangleAlert } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import type { BranchSummary, RepositoryStatus } from "@shared/repository-types";
import { CommandButton, EmptyState, SectionLabel } from "@/components/os";
import { useRepositoryAction, useRepositoryStatus } from "@/lib/agentos/queries";
import { GitGraph } from "./git-graph";
import { GitGuide } from "./git-guide";
import { cn } from "@/lib/utils";

/** Matches the vault forms elsewhere, minus their stacked top margin. */
const INPUT =
  "os-focus-ring w-full max-w-xs rounded-md border border-os-border bg-transparent px-3 py-2 font-mono text-[13px] leading-6 text-foreground placeholder:text-os-subtle disabled:opacity-45";

/**
 * The project's real repository.
 *
 * This exists because AgentOS could already tell an operator that a job would
 * not integrate — wrong branch, dirty tree, base moved — and could do nothing
 * about any of it. The fix was always in another window. So the page is built
 * around the four facts that block a job, in the order they block it: where
 * the repository is, what is uncommitted, what each branch is carrying, and
 * what has landed recently.
 *
 * Every action is reversible. There is no discard and no force: uncommitted
 * work is stashed, and the panel says where it went. The one thing this page
 * will not do is rebase a job onto a moved base — that is refused in the
 * server and explained here, because a button for it would quietly undo the
 * guarantee the review step exists to give.
 */

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="os-meta text-os-subtle">{label}</span>
      <span
        className={cn(
          "truncate font-mono text-[13px]",
          tone === "warning" ? "text-os-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** `↑2 ↓1`, or nothing when a branch is level with its upstream. */
function Divergence({ branch }: { branch: BranchSummary }) {
  if (!branch.upstream) {
    return <span className="os-meta text-os-subtle">no upstream</span>;
  }

  if (branch.ahead === 0 && branch.behind === 0) {
    return <span className="os-meta text-os-subtle">in sync</span>;
  }

  return (
    <span className="os-meta tabular-nums text-os-muted">
      {branch.ahead > 0 ? `↑${branch.ahead}` : ""}
      {branch.ahead > 0 && branch.behind > 0 ? " " : ""}
      {branch.behind > 0 ? `↓${branch.behind}` : ""}
    </span>
  );
}

type View = "tree" | "status" | "guide";
const VIEWS: readonly { id: View; label: string }[] = [
  { id: "tree", label: "Tree" },
  { id: "status", label: "Status and branches" },
  { id: "guide", label: "Git guide" },
];

export function ProjectRepository({ slug }: { slug: string }) {
  const [view, setView] = useState<View>("tree");
  const { data, isLoading, error } = useRepositoryStatus(slug);
  const action = useRepositoryAction(slug);

  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  if (isLoading) {
    return <p className="os-meta mt-6 text-os-subtle">Reading the repository…</p>;
  }

  if (error) {
    return (
      <EmptyState
        title="The repository could not be read"
        description={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  if (!data) return null;

  if (data.unavailable) {
    return (
      <EmptyState
        title="No repository to show"
        description={data.unavailable}
      />
    );
  }

  const status: RepositoryStatus = data;
  const dirty = status.workingTree === "modified";
  const frozen = Boolean(status.writeBlocker);
  const busy = action.isPending;
  // A refusal resolves rather than throws, so the last outcome — whichever it
  // was — is read from the same place.
  const outcome = action.data;

  const run = (input: Parameters<typeof action.mutate>[0]) => {
    if (frozen || busy) return;
    action.mutate(input);
  };

  const tabs = (
    <div role="tablist" aria-label="Repository views" className="mt-6 flex gap-1 border-b border-os-border">
      {VIEWS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={view === entry.id}
          onClick={() => setView(entry.id)}
          className={cn(
            "os-focus-ring os-meta -mb-px cursor-pointer border-b-2 px-3 py-2 transition-colors duration-150",
            view === entry.id ? "border-os-amber text-foreground" : "border-transparent text-os-subtle hover:text-foreground",
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  const junk = status.metadataFiles ?? 0;
  const junkNotice =
    junk > 0 ? (
      <div role="alert" className="mt-4 rounded-sm border border-os-amber/40 bg-os-amber/10 px-4 py-3">
        <p className="flex items-start gap-2 text-[13px] text-os-amber">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>
            {junk} macOS <span className="font-mono">._</span> {junk === 1 ? "file is" : "files are"} in this repository. On an exFAT drive macOS makes one beside every file, and lint and tests read them as source and fail.
          </span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CommandButton onClick={() => run({ kind: "clean_metadata" })} disabled={frozen || busy} loading={busy && action.variables?.kind === "clean_metadata"}>
            Remove {junk} ._ {junk === 1 ? "file" : "files"}
          </CommandButton>
          <span className="os-meta normal-case text-os-subtle">Only untracked ._ files go. Git is told to ignore them afterwards. Nothing you wrote is touched.</span>
        </div>
      </div>
    ) : null;

  const outcomeNotice = outcome ? (
    <p
      role="status"
      className={cn(
        "os-meta mt-4 rounded-sm border px-3 py-2 normal-case",
        outcome.ok ? "border-os-success/40 bg-os-success/10 text-os-success" : "border-os-warning/40 bg-os-warning/10 text-os-warning",
      )}
    >
      {outcome.detail}
    </p>
  ) : null;

  if (view === "tree") {
    return (
      <div>
        {tabs}
        {junkNotice}
        {outcomeNotice}
        <GitGraph slug={slug} status={status} />
      </div>
    );
  }

  if (view === "guide") {
    return (
      <div>
        {tabs}
        <GitGuide status={status} />
      </div>
    );
  }

  return (
    <div>
      {tabs}
      {junkNotice}
    <div className="mt-6 space-y-8">
      {/* Where the repository is, and whether anything may be done to it. */}
      <section>
        <SectionLabel>Working tree</SectionLabel>

        <div className="mt-2 border-t border-os-border pt-2">
          <Row label="Branch" value={status.branch ?? "Detached HEAD"} tone={status.branch ? undefined : "warning"} />
          <Row
            label="State"
            value={dirty ? `${status.uncommitted.length} uncommitted` : "Clean"}
            tone={dirty ? "warning" : undefined}
          />
          <Row label="Path" value={status.repositoryPath ?? "-"} />
        </div>

        {frozen ? (
          <p className="os-meta mt-3 flex items-start gap-2 rounded-sm border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-os-amber">
            <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span className="normal-case">{status.writeBlocker}</span>
          </p>
        ) : null}

        {outcome ? (
          <p
            role="status"
            className={cn(
              "os-meta mt-3 rounded-sm border px-3 py-2 normal-case",
              outcome.ok
                ? "border-os-success/40 bg-os-success/10 text-os-success"
                : "border-os-warning/40 bg-os-warning/10 text-os-warning",
            )}
          >
            {outcome.detail}
          </p>
        ) : null}

        {dirty ? (
          <div className="mt-4">
            <ul className="space-y-0.5">
              {status.uncommitted.map((file) => (
                <li key={file.path} className="flex items-baseline gap-3">
                  <span
                    className="os-meta w-14 shrink-0 text-os-subtle"
                    title={`git status code: ${file.code}`}
                  >
                    {file.untracked ? "new" : file.staged ? "staged" : "changed"}
                  </span>
                  <span className="truncate font-mono text-[12px] text-os-muted">{file.path}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                value={commitMessage}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                disabled={frozen || busy}
                className={INPUT}
                aria-label="Commit message"
              />
              <CommandButton
                onClick={() => {
                  run({ kind: "commit", message: commitMessage });
                  setCommitMessage("");
                }}
                disabled={frozen || commitMessage.trim().length === 0}
                loading={busy && action.variables?.kind === "commit"}
              >
                Commit
              </CommandButton>
              <CommandButton
                variant="quiet"
                onClick={() => run({ kind: "stash" })}
                disabled={frozen}
                loading={busy && action.variables?.kind === "stash"}
              >
                Stash {status.uncommitted.length}
              </CommandButton>
            </div>
            {/* Said plainly, because "stash" is only reassuring if you know
                where it went. */}
            <p className="os-meta mt-2 normal-case text-os-subtle">
              Stashing keeps your work. Restore it with <span className="font-mono">git stash pop</span>.
            </p>
          </div>
        ) : null}
      </section>

      {/* Branches, with whatever job is waiting on each one. */}
      <section>
        <SectionLabel
          action={
            creating ? null : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={frozen}
                className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-os-subtle hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Plus className="size-3" strokeWidth={1.5} aria-hidden="true" />
                New branch
              </button>
            )
          }
        >
          Branches
        </SectionLabel>

        {creating ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={branchName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setBranchName(event.target.value)}
              placeholder="feature/PP-002-something"
              disabled={frozen || busy}
              autoFocus
              className={INPUT}
              aria-label="New branch name"
            />
            <CommandButton
              onClick={() => {
                run({ kind: "branch", name: branchName });
                setBranchName("");
                setCreating(false);
              }}
              disabled={frozen || branchName.trim().length === 0}
            >
              Create
            </CommandButton>
            <CommandButton
              variant="quiet"
              onClick={() => {
                setCreating(false);
                setBranchName("");
              }}
            >
              Cancel
            </CommandButton>
          </div>
        ) : null}

        <ul className="mt-2 border-t border-os-border">
          {status.branches.map((branch) => {
            const pins = status.pins.filter((pin) => pin.branch === branch.name);

            return (
              <li key={branch.name} className="border-b border-os-border py-2.5">
                <div className="flex items-center gap-3">
                  {branch.current ? (
                    <Check className="size-3.5 shrink-0 text-os-amber" strokeWidth={2} aria-label="Current branch" />
                  ) : (
                    <GitBranch className="size-3.5 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                  )}

                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[13px]",
                      branch.current ? "text-foreground" : "text-os-muted",
                    )}
                  >
                    {branch.name}
                  </span>

                  <Divergence branch={branch} />

                  {branch.current ? (
                    <span className="os-meta w-20 shrink-0 text-right text-os-amber">on this</span>
                  ) : (
                    <span className="w-20 shrink-0 text-right">
                      <button
                        type="button"
                        onClick={() => run({ kind: "switch", branch: branch.name })}
                        disabled={frozen || busy}
                        className="os-focus-ring os-meta cursor-pointer rounded-sm text-os-subtle hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Switch
                      </button>
                    </span>
                  )}
                </div>

                {pins.map((pin) => (
                  <div key={pin.jobId} className="mt-1.5 ml-6.5 flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        pin.live ? "bg-os-amber motion-safe:animate-pulse" : pin.baseMoved ? "bg-os-warning" : "bg-os-success",
                      )}
                      aria-hidden="true"
                    />
                    <p className="os-meta min-w-0 normal-case text-os-subtle">
                      <a
                        href={`/workers/jobs/${pin.jobId}`}
                        className="os-focus-ring rounded-sm font-mono text-os-muted hover:text-foreground"
                      >
                        {pin.jobId.replace(/^job_/, "").slice(0, 8)}
                      </a>{" "}
                      {pin.status.replace(/_/g, " ")}
                      {pin.baseMoved ? (
                        // The advanced-base condition, surfaced on the branch
                        // rather than only inside the job, because by the time
                        // you open the job it is too late to have not committed.
                        <span className="text-os-warning">
                          {" "}· this branch moved past what it was reviewed on
                        </span>
                      ) : null}
                    </p>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      {/* What has actually landed. */}
      <section>
        <SectionLabel>Recent commits</SectionLabel>

        <ul className="mt-2 border-t border-os-border">
          {status.recentCommits.map((commit) => (
            <li key={commit.hash} className="flex items-baseline gap-3 border-b border-os-border py-2">
              <GitCommitHorizontal className="size-3.5 shrink-0 translate-y-0.5 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
              <span className="os-meta w-16 shrink-0 font-mono text-os-subtle">{commit.hash.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-os-muted">{commit.subject}</span>
              <span className="os-meta hidden shrink-0 text-os-subtle sm:inline">{commit.author}</span>
              <span className="os-meta w-20 shrink-0 text-right tabular-nums text-os-subtle">
                {commit.date.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
    </div>
  );
}

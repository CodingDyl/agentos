import { PenLine, Plus, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ArtifactType, DocumentProposal, ProjectDetail } from "@shared/agentos-types";
import { CommandButton, EmptyState, FilterBar, Markdown, Section, SectionLabel } from "@/components/os";
import { useWorkspaceFeedback } from "@/features/workspace";
import { useCreateDocument, useProjectDocuments, useProposeDocument } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { availableFilters, filterDocuments, TYPE_LABELS, type DocumentFilter } from "../documents-model";
import { DocumentList } from "./document-list";
import { DocumentViewer } from "./document-viewer";

/**
 * The project's documents.
 *
 * Two groups, one screen: what lives in the vault (`docs/` and every task's
 * `artifacts/`), and what lives in the repository. The first is AgentOS's;
 * the second is listed and read in place with a `Repo` badge, never copied.
 *
 * `?doc=<path>` opens the viewer in place so a document is linkable from
 * search, from a task and from Mission Control. Creation offers a blank
 * document or Hermes' draft — and Hermes' draft is a proposal until saved.
 */
export function ProjectDocuments({ project }: { project: ProjectDetail }) {
  const slug = project.slug;
  const { data, isPending, error, refetch } = useProjectDocuments(slug);

  const [searchParams, setSearchParams] = useSearchParams();
  const openPath = searchParams.get("doc") ?? undefined;
  const openOrigin = searchParams.get("origin") === "repo" ? "repo" : "agentos";

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [creating, setCreating] = useState<"blank" | "hermes" | undefined>();

  const close = () =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("doc");
        next.delete("origin");
        return next;
      },
      { replace: true },
    );

  const agentos = useMemo(() => filterDocuments(data?.agentos ?? [], query, filter), [data, query, filter]);
  const repo = useMemo(() => filterDocuments(data?.repo ?? [], query, filter), [data, query, filter]);
  const filters = useMemo(() => availableFilters([...(data?.agentos ?? []), ...(data?.repo ?? [])]), [data]);

  if (openPath) {
    return <DocumentViewer slug={slug} path={openPath} origin={openOrigin} onBack={close} />;
  }

  if (isPending) return <p className="text-[15px] leading-6 text-os-muted">Reading documents…</p>;
  if (error || !data) return <EmptyState label="Documents unavailable" description={error?.message ?? "Could not read documents."} />;

  const total = data.agentos.length + data.repo.length;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="relative min-w-[16rem] flex-1 max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="os-focus-ring w-full rounded-md border border-os-border bg-transparent py-2 pr-3 pl-9 text-[14px] leading-6 text-foreground placeholder:text-os-subtle"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {filters.length > 2 ? <FilterBar<DocumentFilter> label="Filter by type" value={filter} onChange={setFilter} options={filters} /> : null}
          <CommandButton variant="secondary" icon={Plus} iconPosition="start" onClick={() => setCreating(creating ? undefined : "blank")}>
            New document
          </CommandButton>
        </div>
      </div>

      {creating ? (
        <NewDocument
          project={project}
          mode={creating}
          onMode={setCreating}
          onClose={() => setCreating(undefined)}
          onReload={() => void refetch()}
        />
      ) : null}

      {total === 0 && !creating ? (
        <EmptyState
          label="No documents"
          description="Nothing under docs/ or artifacts/ yet, and no repository documentation was found. Agents' plans, research and reports will appear here as they are produced."
        />
      ) : null}

      {data.agentos.length > 0 ? (
        <Section label="AgentOS" action={<span className="os-meta text-os-subtle tabular-nums">{agentos.length}</span>}>
          {agentos.length === 0 ? (
            <p className="text-[14px] leading-5 text-os-subtle">Nothing matches.</p>
          ) : (
            <DocumentList documents={agentos} showTokens />
          )}
        </Section>
      ) : null}

      <Section
        label="Repository"
        action={data.repoUnavailable ? undefined : <span className="os-meta text-os-subtle tabular-nums">{repo.length}</span>}
      >
        {data.repoUnavailable ? (
          <p className="text-[14px] leading-5 text-os-subtle">{data.repoUnavailable}</p>
        ) : data.repo.length === 0 ? (
          <p className="text-[14px] leading-5 text-os-subtle">The repository has no README or docs/ Markdown.</p>
        ) : repo.length === 0 ? (
          <p className="text-[14px] leading-5 text-os-subtle">Nothing matches.</p>
        ) : (
          <>
            <p className="mb-3 text-[13px] leading-5 text-os-subtle">Read in place from the repository. Never copied, so never stale.</p>
            <DocumentList documents={repo} showTokens />
          </>
        )}
      </Section>
    </div>
  );
}

const TYPES: readonly ArtifactType[] = ["notes", "spec", "research", "plan", "design", "review", "report"];

function NewDocument({
  project,
  mode,
  onMode,
  onClose,
  onReload,
}: {
  project: ProjectDetail;
  mode: "blank" | "hermes";
  onMode: (mode: "blank" | "hermes") => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ArtifactType>("notes");
  const [taskId, setTaskId] = useState("");
  const [content, setContent] = useState("");
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<DocumentProposal>();
  const [showSource, setShowSource] = useState(false);

  const create = useCreateDocument(project.slug);
  const propose = useProposeDocument(project.slug);
  const feedback = useWorkspaceFeedback();

  const openTasks = [...project.tasks.now, ...project.tasks.next, ...project.tasks.later].filter(
    (task) => task.id && !task.completed,
  );

  const save = (input: { title: string; type: ArtifactType; content: string; source?: "hermes" }) => {
    if (!input.title.trim() || !input.content.trim()) return;

    create.mutate(
      { title: input.title, type: input.type, taskId: taskId || undefined, content: input.content, source: input.source },
      {
        onSuccess: (result) => {
          feedback.recordEdit(`${result.artifact.title} saved.`, result.undoId);
          onClose();
          onReload();
        },
        onError: (error) => feedback.reportFailure(error),
      },
    );
  };

  return (
    <div className="rounded-lg border border-os-border-strong bg-os-surface-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>New document</SectionLabel>
          <p className="mt-2 text-[13px] leading-5 text-os-muted">
            Written to <span className="font-mono text-os-subtle">{taskId ? `artifacts/${taskId}/` : "docs/"}</span> with front matter. Nothing is generated unless you ask Hermes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FilterBar<"blank" | "hermes">
            label="How to create"
            value={mode}
            onChange={onMode}
            options={[
              { value: "blank", label: "Blank" },
              { value: "hermes", label: "Ask Hermes" },
            ]}
          />
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring cursor-pointer rounded-md p-1.5 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem_14rem]">
        {mode === "blank" ? (
          <Field label="Title">
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Product spec" className={INPUT} />
          </Field>
        ) : (
          <Field label="Brief" hint="What should Hermes write? It reads the project's goal, status and decisions too.">
            <textarea
              autoFocus
              rows={3}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Research the options for improving Chef recipe generation and write up a recommendation."
              className={`${INPUT} resize-y`}
            />
          </Field>
        )}

        {mode === "blank" ? (
          <Field label="Type">
            <select value={type} onChange={(event) => setType(event.target.value as ArtifactType)} className={SELECT}>
              {TYPES.map((entry) => (
                <option key={entry} value={entry}>{TYPE_LABELS[entry]}</option>
              ))}
            </select>
          </Field>
        ) : (
          <div />
        )}

        <Field label="Task" hint="Optional. Files it under the task as an artifact.">
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)} className={SELECT}>
            <option value="">None (project document)</option>
            {openTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.id} · {task.title.slice(0, 48)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {mode === "blank" ? (
        <>
          <Field label="Content" hint="Markdown." className="mt-5">
            <textarea rows={10} value={content} onChange={(event) => setContent(event.target.value)} placeholder={"# Heading\n\nWrite here."} className={`${INPUT} resize-y font-mono text-[13px]`} />
          </Field>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <CommandButton variant="primary" disabled={!title.trim() || !content.trim()} loading={create.isPending} loadingLabel="Saving" onClick={() => save({ title, type, content })}>
              Save document
            </CommandButton>
            <CommandButton variant="quiet" onClick={onClose}>Cancel</CommandButton>
          </div>
        </>
      ) : !proposal ? (
        <div className="mt-5">
          {propose.error ? <p className="mb-3 text-[13px] leading-5 text-os-warning">{propose.error.message}</p> : null}
          <CommandButton
            variant="primary"
            icon={PenLine}
            iconPosition="start"
            disabled={!brief.trim()}
            loading={propose.isPending}
            loadingLabel="Writing"
            onClick={() => propose.mutate({ brief, taskId: taskId || undefined }, { onSuccess: setProposal })}
          >
            Ask Hermes to write it
          </CommandButton>
        </div>
      ) : (
        <div className="mt-6 border-t border-os-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>Proposed document</SectionLabel>
              <p className="mt-2 text-[13px] leading-5 text-os-muted">Nothing is saved yet. Edit the title or type, read it, then save.</p>
            </div>
            <FilterBar<"preview" | "source">
              label="Proposal view"
              value={showSource ? "source" : "preview"}
              onChange={(value) => setShowSource(value === "source")}
              options={[
                { value: "preview", label: "Preview" },
                { value: "source", label: "Source" },
              ]}
            />
          </div>

          <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Title">
              <input value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} className={INPUT} />
            </Field>
            <Field label="Type">
              <select value={proposal.type} onChange={(event) => setProposal({ ...proposal, type: event.target.value as ArtifactType })} className={SELECT}>
                {TYPES.map((entry) => (
                  <option key={entry} value={entry}>{TYPE_LABELS[entry]}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-5 max-h-[32rem] overflow-y-auto rounded-md border border-os-border bg-os-surface p-5">
            {showSource ? (
              <textarea
                value={proposal.content}
                onChange={(event) => setProposal({ ...proposal, content: event.target.value })}
                rows={16}
                className="w-full resize-y bg-transparent font-mono text-[13px] leading-6 text-foreground outline-none"
              />
            ) : (
              <Markdown content={proposal.content} />
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <CommandButton variant="primary" loading={create.isPending} loadingLabel="Saving" onClick={() => save({ title: proposal.title, type: proposal.type, content: proposal.content, source: "hermes" })}>
              Save document
            </CommandButton>
            <CommandButton variant="quiet" loading={propose.isPending} loadingLabel="Writing" onClick={() => propose.mutate({ brief, taskId: taskId || undefined }, { onSuccess: setProposal })}>
              Ask again
            </CommandButton>
            <CommandButton variant="quiet" onClick={() => setProposal(undefined)}>Discard</CommandButton>
            <span className="os-meta ml-auto text-os-subtle">Written by Hermes · saved as {proposal.filename}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const INPUT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle";

const SELECT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-os-surface px-3 py-2.5 text-[15px] leading-6 text-foreground";

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? <span className="mt-2 block text-[13px] leading-5 text-os-subtle">{hint}</span> : null}
    </label>
  );
}

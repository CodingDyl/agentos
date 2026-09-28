import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ArtifactType, ProjectTaskSection } from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { TYPE_LABELS } from "@/features/projects/documents-model";
import {
  useCaptureNote,
  useCreateDocument,
  useCreateTask,
  useProjects,
  useWriteDecision,
} from "@/lib/agentos/queries";
import { CreateProject } from "./create-project";
import {
  QuickCreateContext,
  type QuickCreateControls,
  type QuickCreateKind,
} from "./quick-create-context";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * Quick Create: the forms that can be opened from anywhere.
 *
 * A task, a workspace, a decision, a document or a captured note, from any
 * screen, without first navigating to where it belongs. The forms are the same ones the
 * project page uses — this only hosts them at the app root so the palette,
 * the shell's `+` and Mission Control can all open them.
 *
 * The one thing a global form needs that a local one does not is *which
 * project*. When the caller knows (the operator is on a project page), it is
 * passed in and the picker is skipped; otherwise the form asks first.
 */

interface OpenState {
  kind: QuickCreateKind;
  project?: string;
}

export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState>();

  const open = useCallback((kind: QuickCreateKind, options?: { project?: string }) => {
    setState({ kind, project: options?.project });
  }, []);

  const close = useCallback(() => setState(undefined), []);

  const controls = useMemo<QuickCreateControls>(() => ({ open, close }), [open, close]);

  return (
    <QuickCreateContext.Provider value={controls}>
      {children}
      {state?.kind === "project" ? <CreateProject onClose={close} /> : null}
      {state?.kind === "task" ? <QuickTask project={state.project} onClose={close} /> : null}
      {state?.kind === "decision" ? <QuickDecision project={state.project} onClose={close} /> : null}
      {state?.kind === "capture" ? <QuickCapture project={state.project} onClose={close} /> : null}
      {state?.kind === "document" ? <QuickDocument project={state.project} onClose={close} /> : null}
    </QuickCreateContext.Provider>
  );
}

const SECTIONS: readonly { value: ProjectTaskSection; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "next", label: "Next" },
  { value: "later", label: "Later" },
];

function QuickTask({ project, onClose }: { project?: string; onClose: () => void }) {
  const { data } = useProjects();
  const projects = (data?.projects ?? []).filter((entry) => entry.state !== "archived");
  const [slug, setSlug] = useState(project ?? "");
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<ProjectTaskSection>("now");

  const chosen = slug || projects[0]?.slug || "";
  const create = useCreateTask(chosen);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();

  const name = projects.find((entry) => entry.slug === chosen)?.name ?? chosen;

  return (
    <QuickDialog label="New task" hint="Appends one line to the project's TASKS.md." onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosen || title.trim().length === 0) return;

          create.mutate(
            { title, section },
            {
              onSuccess: (result) => {
                feedback.recordEdit(`${result.taskId} created in ${name}.`, result.undoId);
                onClose();
                void navigate(`/workspaces/${chosen}?tab=tasks&task=${encodeURIComponent(result.taskId)}`);
              },
              onError: (error) => feedback.reportFailure(error),
            },
          );
        }}
      >
        {!project ? (
          <Field label="Workspace">
            <select value={chosen} onChange={(event) => setSlug(event.target.value)} className={SELECT}>
              {projects.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="os-meta text-os-subtle">
            Workspace / <span className="text-os-muted">{name}</span>
          </p>
        )}

        <Field label="Title">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Improve Chef loading state"
            className={INPUT}
          />
        </Field>

        <Field label="Section">
          <div role="radiogroup" className="mt-3 inline-flex overflow-hidden rounded-md border border-os-border">
            {SECTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={section === option.value}
                onClick={() => setSection(option.value)}
                className={`os-focus-ring os-meta min-h-9 cursor-pointer border-l border-os-border px-4 transition-colors duration-150 first:border-l-0 ${
                  section === option.value ? "bg-os-surface-raised text-foreground" : "text-os-muted hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        {create.error ? <p className="mt-5 text-[13px] leading-5 text-os-danger">{create.error.message}</p> : null}

        <Actions
          submitLabel="Create task"
          disabled={!chosen || title.trim().length === 0}
          loading={create.isPending}
          loadingLabel="Creating"
          onCancel={onClose}
        />
      </form>
    </QuickDialog>
  );
}

function QuickDecision({ project, onClose }: { project?: string; onClose: () => void }) {
  const { data } = useProjects();
  const projects = (data?.projects ?? []).filter((entry) => entry.state !== "archived");
  const [slug, setSlug] = useState(project ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const chosen = slug || projects[0]?.slug || "";
  const write = useWriteDecision(chosen);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();
  const name = projects.find((entry) => entry.slug === chosen)?.name ?? chosen;

  return (
    <QuickDialog label="New decision" hint="A topic and the position taken on it, written to DECISIONS.md." onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosen || title.trim().length === 0 || body.trim().length === 0) return;

          write.mutate(
            { title, body, decidedOn: new Date().toISOString().slice(0, 10) },
            {
              onSuccess: (result) => {
                feedback.recordEdit(`Decision "${title.trim()}" recorded in ${name}.`, result.undoId);
                onClose();
                void navigate(`/workspaces/${chosen}?tab=decisions`);
              },
              onError: (error) => feedback.reportFailure(error),
            },
          );
        }}
      >
        {!project ? (
          <Field label="Workspace">
            <select value={chosen} onChange={(event) => setSlug(event.target.value)} className={SELECT}>
              {projects.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="os-meta text-os-subtle">
            Workspace / <span className="text-os-muted">{name}</span>
          </p>
        )}

        <Field label="Topic">
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Implementation worker" className={INPUT} />
        </Field>

        <Field label="Decision">
          <textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Use Grok as the implementation worker. Hermes remains the orchestrator."
            className={`${INPUT} resize-y`}
          />
        </Field>

        {write.error ? <p className="mt-5 text-[13px] leading-5 text-os-danger">{write.error.message}</p> : null}

        <Actions
          submitLabel="Record decision"
          disabled={!chosen || title.trim().length === 0 || body.trim().length === 0}
          loading={write.isPending}
          loadingLabel="Writing"
          onCancel={onClose}
        />
      </form>
    </QuickDialog>
  );
}

/**
 * Capture: the fastest write in AgentOS.
 *
 * The note is appended to `inbox/CAPTURE.md` as it is typed — no model in the
 * path, so it cannot be slow and cannot fail because Hermes is down. Filing it
 * properly is a later job. It can instead go straight in as a task, or be
 * tagged with the workspace it is about; Hermes can still be asked to file it,
 * as the secondary route rather than the only one.
 */
function QuickCapture({ project, onClose }: { project?: string; onClose: () => void }) {
  const { data } = useProjects();
  const projects = (data?.projects ?? []).filter((entry) => entry.state !== "archived");
  const [note, setNote] = useState("");
  const [slug, setSlug] = useState(project ?? "");
  const [asTask, setAsTask] = useState(false);
  const navigate = useNavigate();
  const feedback = useWorkspaceFeedback();
  const capture = useCaptureNote();
  // A task needs somewhere to live; the first workspace stands in until chosen.
  const taskSlug = slug || projects[0]?.slug || "";
  const createTask = useCreateTask(taskSlug);

  const workspace = projects.find((entry) => entry.slug === slug);
  const text = note.trim();
  const pending = capture.isPending || createTask.isPending;

  const submit = () => {
    if (!text || pending) return;

    if (asTask) {
      if (!taskSlug) return;
      createTask.mutate(
        { title: text, section: "now" },
        {
          onSuccess: (result) => {
            const name = projects.find((entry) => entry.slug === taskSlug)?.name ?? taskSlug;
            feedback.recordEdit(`${result.taskId} added to ${name}.`, result.undoId);
            onClose();
          },
          onError: (error) => feedback.reportFailure(error),
        },
      );
      return;
    }

    capture.mutate(
      { note: text, workspace: workspace?.name },
      {
        onSuccess: (result) => {
          feedback.recordEdit("Captured to the inbox.", result.undoId);
          onClose();
        },
        onError: (error) => feedback.reportFailure(error),
      },
    );
  };

  const fileWithHermes = () => {
    if (!text) return;
    const params = new URLSearchParams();
    if (slug) params.set("project", slug);
    params.set("run", `/capture ${text}`);
    onClose();
    void navigate(`/agent?${params.toString()}`);
  };

  return (
    <QuickDialog label="Capture" hint="Saved the moment you press ⌘↵. Nothing is classified until you choose to file it." onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Note">
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Need to update Story Keeper checkout copy"
            className={`${INPUT} resize-y`}
          />
        </Field>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 [&>label]:mt-0">
          <Field label="Workspace">
            <select value={slug} onChange={(event) => setSlug(event.target.value)} className={SELECT}>
              <option value="">{asTask ? "Choose a workspace" : "None — just the inbox"}</option>
              {projects.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Save as">
            <div role="radiogroup" aria-label="Save as" className="mt-3 inline-flex overflow-hidden rounded-md border border-os-border">
              {[
                { value: false, label: "Inbox note" },
                { value: true, label: "Task" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={asTask === option.value}
                  onClick={() => setAsTask(option.value)}
                  className={`os-focus-ring os-meta min-h-9 cursor-pointer border-l border-os-border px-4 transition-colors duration-150 first:border-l-0 ${
                    asTask === option.value ? "bg-os-surface-raised text-foreground" : "text-os-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <p className="mt-4 text-[13px] leading-5 text-os-subtle">
          {asTask
            ? `Added to Now in ${projects.find((entry) => entry.slug === taskSlug)?.name ?? "the workspace"}'s TASKS.md.`
            : workspace
              ? `One line in inbox/CAPTURE.md, tagged for ${workspace.name}.`
              : "One line in inbox/CAPTURE.md."}
        </p>

        {capture.error || createTask.error ? (
          <p className="mt-4 text-[13px] leading-5 text-os-danger">{(capture.error ?? createTask.error)?.message}</p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <CommandButton type="submit" variant="primary" disabled={!text || (asTask && !taskSlug)} loading={pending} loadingLabel="Saving">
            {asTask ? "Create task" : "Capture"}
          </CommandButton>
          <CommandButton variant="quiet" onClick={fileWithHermes} disabled={!text}>
            File with Hermes
          </CommandButton>
          <span className="os-meta ml-auto text-os-subtle">⌘↵</span>
        </div>
      </form>
    </QuickDialog>
  );
}

const DOCUMENT_TYPES: readonly ArtifactType[] = ["notes", "plan", "research", "spec", "report", "review", "design", "other"];

/** A blank document in a workspace's `docs/`, opened in its viewer once written. */
function QuickDocument({ project, onClose }: { project?: string; onClose: () => void }) {
  const { data } = useProjects();
  const projects = (data?.projects ?? []).filter((entry) => entry.state !== "archived");
  const [slug, setSlug] = useState(project ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ArtifactType>("notes");
  const [content, setContent] = useState("");

  const chosen = slug || projects[0]?.slug || "";
  const create = useCreateDocument(chosen);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();
  const name = projects.find((entry) => entry.slug === chosen)?.name ?? chosen;

  return (
    <QuickDialog label="New document" hint="Written to the workspace's docs/ as Markdown with front matter." onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosen || title.trim().length === 0) return;

          create.mutate(
            { title: title.trim(), type, content, source: "human" },
            {
              onSuccess: (result) => {
                feedback.recordEdit(`"${result.artifact.title}" created in ${name}.`, result.undoId);
                onClose();
                const params = new URLSearchParams({ tab: "documents", doc: result.artifact.relativePath });
                void navigate(`/workspaces/${chosen}?${params.toString()}`);
              },
              onError: (error) => feedback.reportFailure(error),
            },
          );
        }}
      >
        {!project ? (
          <Field label="Workspace">
            <select value={chosen} onChange={(event) => setSlug(event.target.value)} className={SELECT}>
              {projects.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="os-meta text-os-subtle">
            Workspace / <span className="text-os-muted">{name}</span>
          </p>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem] [&>label]:mt-0">
          <Field label="Title">
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Vaja pricing notes" className={INPUT} />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(event) => setType(event.target.value as ArtifactType)} className={SELECT}>
              {DOCUMENT_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {TYPE_LABELS[entry]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Body">
          <textarea rows={5} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Markdown. Can be left empty and written later." className={`${INPUT} resize-y font-mono text-[13px]`} />
        </Field>

        {create.error ? <p className="mt-5 text-[13px] leading-5 text-os-danger">{create.error.message}</p> : null}

        <Actions
          submitLabel="Create document"
          disabled={!chosen || title.trim().length === 0}
          loading={create.isPending}
          loadingLabel="Writing"
          onCancel={onClose}
        />
      </form>
    </QuickDialog>
  );
}

function QuickDialog({
  label,
  hint,
  onClose,
  children,
}: {
  label: string;
  hint: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] pb-8">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-os-background/85" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex max-h-full w-[min(92vw,34rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-os-border px-5 py-4">
          <div>
            <SectionLabel>{label}</SectionLabel>
            <p className="mt-2 text-[13px] leading-5 text-os-muted">{hint}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

const INPUT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle";

const SELECT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-os-surface px-3 py-2.5 text-[15px] leading-6 text-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-5 block first:mt-0">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </label>
  );
}

function Actions({
  submitLabel,
  disabled,
  loading,
  loadingLabel,
  hint,
  onCancel,
}: {
  submitLabel: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  hint?: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-2">
      <CommandButton type="submit" variant="primary" disabled={disabled} loading={loading} loadingLabel={loadingLabel}>
        {submitLabel}
      </CommandButton>
      <CommandButton variant="quiet" onClick={onCancel}>
        Cancel
      </CommandButton>
      {hint ? <span className="os-meta ml-auto text-os-subtle">{hint}</span> : null}
    </div>
  );
}

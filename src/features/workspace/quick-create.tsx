import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectTaskSection } from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { useCreateTask, useProjects, useWriteDecision } from "@/lib/agentos/queries";
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
 * A task, a project, a decision or a captured note, from any screen, without
 * first navigating to where it belongs. The forms are the same ones the
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
                void navigate(`/projects/${chosen}?tab=tasks&task=${encodeURIComponent(result.taskId)}`);
              },
              onError: (error) => feedback.reportFailure(error),
            },
          );
        }}
      >
        {!project ? (
          <Field label="Project">
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
            Project / <span className="text-os-muted">{name}</span>
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
                void navigate(`/projects/${chosen}?tab=decisions`);
              },
              onError: (error) => feedback.reportFailure(error),
            },
          );
        }}
      >
        {!project ? (
          <Field label="Project">
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
            Project / <span className="text-os-muted">{name}</span>
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
 * Capture is Hermes' job — `/capture` files a note into the inbox and decides
 * where it belongs — so this form only prepares the command and hands it to
 * the console, where the operator sends it.
 */
function QuickCapture({ project, onClose }: { project?: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const navigate = useNavigate();

  return (
    <QuickDialog label="Capture" hint="Prepares /capture in the console. Hermes files it; you send it." onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim().length === 0) return;

          const params = new URLSearchParams();
          if (project) params.set("project", project);
          params.set("run", `/capture ${note.trim()}`);

          onClose();
          void navigate(`/agent?${params.toString()}`);
        }}
      >
        <Field label="Note">
          <textarea
            autoFocus
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Idea, loose end, thing to remember…"
            className={`${INPUT} resize-y`}
          />
        </Field>

        <Actions submitLabel="Open in console" disabled={note.trim().length === 0} onCancel={onClose} hint="⌘↵" />
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

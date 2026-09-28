import { Archive, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  ProjectPatchRequest,
  ProjectPriority,
  ProjectState,
  VisualVerificationDefault,
  WorkerPreference,
} from "@shared/agentos-types";
import {
  DEFAULT_WORKSPACE_MODULES,
  deriveWorkspaceType,
  moduleLabel,
  WORKSPACE_MODULES,
  WORKSPACE_TYPE_DESCRIPTIONS,
  WORKSPACE_TYPE_LABELS,
  WORKSPACE_TYPES,
  type WorkspaceModule,
  type WorkspaceType,
} from "@shared/workspace";
import { CommandButton, SectionLabel } from "@/components/os";
import type { ProjectSettings as Settings } from "@/lib/agentos/client";
import {
  useArchiveProject,
  useDesignLibrary,
  usePatchProject,
  useProjectSettings,
  useVercelProjects,
} from "@/lib/agentos/queries";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * Everything about a project that is configuration rather than content.
 *
 * A sheet, not a page: it slides in over the project, is edited, and saved in
 * one `PATCH`. Identity fields land in `PORTFOLIO.md`; repository and
 * configuration land in `PROJECT.md` under `## Configuration`. Each file is
 * touched only if a field in it changed, and each is checked against the
 * revision the sheet was opened with — so saving validation commands while
 * Hermes rewrote the portfolio does not become a conflict.
 *
 * These are *defaults*. The worker preference, validation commands and visual
 * verification setting fill the delegation plan before Hermes has said
 * anything, so the operator sets them once here rather than on every job.
 */

const STATES: readonly ProjectState[] = ["active", "incubating", "paused", "blocked", "completed"];
const PRIORITIES: readonly ProjectPriority[] = ["high", "medium", "low"];
const WORKERS: readonly { value: WorkerPreference; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Hermes routes each job." },
  { value: "grok", label: "Grok", hint: "Always suggest Grok." },
  { value: "claude", label: "Claude", hint: "Always suggest Claude." },
];
const VISUAL: readonly { value: VisualVerificationDefault; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Never on by default." },
  { value: "ui-tasks", label: "UI tasks", hint: "On when Hermes scopes it as UI work." },
  { value: "always", label: "Always", hint: "On for every delegated job." },
];

interface Draft {
  name: string;
  type: string;
  state: ProjectState;
  priority: ProjectPriority;
  goal: string;
  repoPath: string;
  taskPrefix: string;
  defaultBranch: string;
  designBoard: string;
  vercelProjectId: string;
  vercelProjectName: string;
  workerPreference: WorkerPreference;
  visualVerification: VisualVerificationDefault;
  validation: string;
  /** `""` = derive from the portfolio type. */
  workspaceType: WorkspaceType | "";
  /** Empty = the type's defaults. */
  modules: WorkspaceModule[];
}

function toDraft(settings: Settings): Draft {
  return {
    name: settings.name,
    type: settings.type ?? "",
    state: settings.state as ProjectState,
    priority: settings.priority as ProjectPriority,
    goal: settings.goal ?? "",
    repoPath: settings.repoPath ?? "",
    taskPrefix: settings.configuration.taskPrefix ?? "",
    defaultBranch: settings.configuration.defaultBranch ?? "",
    designBoard: settings.configuration.designBoard ?? "",
    vercelProjectId: settings.configuration.vercelProjectId ?? "",
    vercelProjectName: settings.configuration.vercelProjectName ?? "",
    workerPreference: settings.configuration.workerPreference,
    visualVerification: settings.configuration.visualVerification,
    validation: settings.configuration.validationCommands.join("\n"),
    workspaceType: settings.configuration.workspaceType ?? "",
    modules: settings.configuration.modules ?? [],
  };
}

/** Only what changed, so an untouched file is never written. */
function toPatch(settings: Settings, draft: Draft): ProjectPatchRequest {
  const patch: ProjectPatchRequest = {
    expectedRevisions: settings.revisions,
  };

  if (draft.name.trim() !== settings.name) patch.name = draft.name.trim();
  if (draft.type.trim() !== (settings.type ?? "") && draft.type.trim()) patch.type = draft.type.trim();
  if (draft.state !== settings.state) patch.state = draft.state;
  if (draft.priority !== settings.priority) patch.priority = draft.priority;
  if (draft.goal.trim() !== (settings.goal ?? "")) patch.goal = draft.goal.trim();
  if (draft.repoPath.trim() !== (settings.repoPath ?? "")) patch.repoPath = draft.repoPath.trim();

  const configuration: NonNullable<ProjectPatchRequest["configuration"]> = {};
  const current = settings.configuration;
  const prefix = draft.taskPrefix.trim().toUpperCase();
  const commands = draft.validation
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (prefix !== (current.taskPrefix ?? "")) configuration.taskPrefix = prefix;
  if (draft.defaultBranch.trim() !== (current.defaultBranch ?? "")) {
    configuration.defaultBranch = draft.defaultBranch.trim();
  }
  if (draft.designBoard.trim() !== (current.designBoard ?? "")) {
    configuration.designBoard = draft.designBoard.trim();
  }
  if (draft.vercelProjectId.trim() !== (current.vercelProjectId ?? "")) {
    configuration.vercelProjectId = draft.vercelProjectId.trim();
    configuration.vercelProjectName = draft.vercelProjectName.trim();
  }
  if (draft.workerPreference !== current.workerPreference) {
    configuration.workerPreference = draft.workerPreference;
  }
  if (draft.visualVerification !== current.visualVerification) {
    configuration.visualVerification = draft.visualVerification;
  }
  if (commands.join("\n") !== current.validationCommands.join("\n")) {
    configuration.validationCommands = commands;
  }

  if (draft.workspaceType !== (current.workspaceType ?? "")) configuration.workspaceType = draft.workspaceType;
  if (draft.modules.join(",") !== (current.modules ?? []).join(",")) configuration.modules = draft.modules;

  if (Object.keys(configuration).length > 0) patch.configuration = configuration;

  return patch;
}

const PREFIX = /^[A-Z][A-Z0-9]{0,7}$/;

export function ProjectSettings({ slug, onClose }: { slug: string; onClose: () => void }) {
  const settings = useProjectSettings(slug);
  const library = useDesignLibrary();
  const vercel = useVercelProjects();
  const patch = usePatchProject(slug);
  const archive = useArchiveProject(slug);
  const feedback = useWorkspaceFeedback();

  const [draft, setDraft] = useState<Draft>();

  // The draft is seeded once from the read, not kept in sync with it: a
  // refetch mid-edit must not overwrite what is being typed.
  const loaded = settings.data;
  const form = draft ?? (loaded ? toDraft(loaded) : undefined);

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

  const boards = (library.data?.boards ?? []).filter((board) => board.project === slug);
  const prefixInvalid = form !== undefined && form.taskPrefix.trim() !== "" && !PREFIX.test(form.taskPrefix.trim().toUpperCase());
  const archived = loaded?.state === "archived";

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...(current ?? (loaded ? toDraft(loaded) : ({} as Draft))), [key]: value }));

  const save = () => {
    if (!loaded || !form || prefixInvalid) return;

    const body = toPatch(loaded, form);
    const changed = Object.keys(body).filter((key) => key !== "expectedRevisions").length > 0;

    if (!changed) {
      onClose();
      return;
    }

    patch.mutate(body, {
      onSuccess: (result) => {
        feedback.recordEdit(
          `${form.name.trim() || loaded.name} settings saved.`,
          result.project?.undoId ?? result.portfolio?.undoId,
        );
        onClose();
      },
      onError: (error) => feedback.reportFailure(error, () => void settings.refetch()),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-os-background/85"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        className="relative flex h-full w-[min(100vw,34rem)] flex-col border-l border-os-border-strong bg-os-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-os-border px-6 py-5">
          <div>
            <SectionLabel>Settings</SectionLabel>
            <p className="mt-2 text-[13px] leading-5 text-os-muted">
              Identity is written to{" "}
              <span className="font-mono text-os-subtle">PORTFOLIO.md</span>; the rest to{" "}
              <span className="font-mono text-os-subtle">PROJECT.md</span>.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        {!form ? (
          <p className="px-6 py-6 text-[15px] leading-6 text-os-muted">
            {settings.error ? settings.error.message : "Reading settings…"}
          </p>
        ) : (
          <form
            className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Group label="Identity">
              <Field label="Name">
                <input value={form.name} onChange={(event) => update("name", event.target.value)} className={INPUT} />
              </Field>
              <Field label="Description" hint="The goal line in the portfolio. One or two sentences.">
                <textarea rows={2} value={form.goal} onChange={(event) => update("goal", event.target.value)} className={`${INPUT} resize-y`} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Type">
                  <input value={form.type} onChange={(event) => update("type", event.target.value)} className={INPUT} />
                </Field>
                <Field label="Status">
                  <select value={form.state} onChange={(event) => update("state", event.target.value as ProjectState)} className={SELECT} disabled={archived}>
                    {(archived ? [...STATES, "archived" as ProjectState] : STATES).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={form.priority} onChange={(event) => update("priority", event.target.value as ProjectPriority)} className={SELECT}>
                    {PRIORITIES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </Group>

            <WorkspaceGroup
              portfolioType={form.type}
              workspaceType={form.workspaceType}
              modules={form.modules}
              onType={(value) => update("workspaceType", value)}
              onModules={(value) => update("modules", value)}
            />

            <Group label="Repository">
              <Field label="Local path" hint="Where workers check out and run. Absolute, or ~/.">
                <input value={form.repoPath} onChange={(event) => update("repoPath", event.target.value)} placeholder="~/Developer/pantry-pilot" className={`${INPUT} font-mono text-[13px]`} />
              </Field>
              <Field label="Default branch" hint="What worker jobs branch from. Blank uses the checkout.">
                <input value={form.defaultBranch} onChange={(event) => update("defaultBranch", event.target.value)} placeholder="main" className={`${INPUT} font-mono text-[13px]`} />
              </Field>
            </Group>

            <Group label="Tasks">
              <Field
                label="Task prefix"
                hint={
                  prefixInvalid
                    ? "Letters and digits only, starting with a letter, up to eight characters."
                    : "New ids use this. Existing ids keep theirs — nothing is renumbered."
                }
                invalid={prefixInvalid}
              >
                <input value={form.taskPrefix} onChange={(event) => update("taskPrefix", event.target.value.toUpperCase())} placeholder="PP" className={`${INPUT} font-mono text-[13px] uppercase`} />
              </Field>
            </Group>

            <Group label="Delegation defaults">
              <Field label="Worker preference">
                <Choice value={form.workerPreference} options={WORKERS} onChange={(value) => update("workerPreference", value)} />
              </Field>
              <Field label="Visual verification">
                <Choice value={form.visualVerification} options={VISUAL} onChange={(value) => update("visualVerification", value)} />
              </Field>
              <Field label="Design board" hint="What UI work is checked against. Boards assigned to this project.">
                {boards.length > 0 ? (
                  <select value={form.designBoard} onChange={(event) => update("designBoard", event.target.value)} className={SELECT}>
                    <option value="">None</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.name}>{board.name}</option>
                    ))}
                  </select>
                ) : (
                  <input value={form.designBoard} onChange={(event) => update("designBoard", event.target.value)} placeholder="No boards assigned yet" className={INPUT} />
                )}
              </Field>
              <Field label="Validation" hint="One command per line. AgentOS runs these after every worker job.">
                <textarea rows={3} value={form.validation} onChange={(event) => update("validation", event.target.value)} placeholder={"npm test\nnpm run lint"} className={`${INPUT} resize-y font-mono text-[13px]`} />
              </Field>
            </Group>

            <Group label="Deployment">
              <Field
                label="Vercel project"
                hint={
                  !vercel.data
                    ? "Set VERCEL_API_TOKEN in .env to pick from your Vercel projects."
                    : "Read-only: lets the SEO tab crawl the live site without a URL typed in by hand."
                }
              >
                {vercel.data && vercel.data.projects.length > 0 ? (
                  <select
                    value={form.vercelProjectId}
                    onChange={(event) => {
                      const project = vercel.data?.projects.find((entry) => entry.id === event.target.value);
                      setDraft((current) => ({
                        ...(current ?? (loaded ? toDraft(loaded) : ({} as Draft))),
                        vercelProjectId: project?.id ?? "",
                        vercelProjectName: project?.name ?? "",
                      }));
                    }}
                    className={SELECT}
                  >
                    <option value="">Not connected</option>
                    {vercel.data.projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.vercelProjectName}
                    disabled
                    placeholder="Not connected"
                    className={`${INPUT} disabled:opacity-60`}
                  />
                )}
              </Field>
            </Group>

            {patch.error ? (
              <p className="mt-6 text-[13px] leading-5 text-os-danger">{patch.error.message}</p>
            ) : null}

            <div className="mt-8 flex flex-wrap items-center gap-2">
              <CommandButton type="submit" variant="primary" disabled={prefixInvalid || form.name.trim().length === 0} loading={patch.isPending} loadingLabel="Saving">
                Save settings
              </CommandButton>
              <CommandButton variant="quiet" onClick={onClose}>Cancel</CommandButton>
            </div>

            {/* The destructive zone. Archiving is a state change, never a
                deletion: worker jobs, usage, designs and activity all
                reference this slug. */}
            <div className="mt-12 border-t border-os-border pt-6">
              <SectionLabel>{archived ? "Archived" : "Archive"}</SectionLabel>
              <p className="mt-2 max-w-[52ch] text-[13px] leading-5 text-os-muted">
                {archived
                  ? "This project is out of sight. Restoring puts it back as incubating."
                  : "Puts the project out of sight without deleting anything. Its history, designs and costs stay."}
              </p>
              <CommandButton
                variant={archived ? "secondary" : "danger"}
                icon={archived ? RotateCcw : Archive}
                iconPosition="start"
                className="mt-4"
                loading={archive.isPending}
                loadingLabel={archived ? "Restoring" : "Archiving"}
                onClick={() =>
                  archive.mutate(archived ? "incubating" : undefined, {
                    onSuccess: () => {
                      feedback.recordEdit(archived ? `${loaded?.name} restored.` : `${loaded?.name} archived.`);
                      onClose();
                    },
                    onError: (error) => feedback.reportFailure(error),
                  })
                }
              >
                {archived ? "Restore project" : "Archive project"}
              </CommandButton>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}

const INPUT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle";

const SELECT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-os-surface px-3 py-2.5 text-[15px] leading-6 text-foreground disabled:opacity-60";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="mt-10 first:mt-0">
      <legend className="os-meta text-os-amber">{label}</legend>
      <div className="mt-1 space-y-5">{children}</div>
    </fieldset>
  );
}

function Field({ label, hint, invalid, children }: { label: string; hint?: string; invalid?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? (
        <span className={`mt-2 block text-[13px] leading-5 ${invalid ? "text-os-danger" : "text-os-subtle"}`}>{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * What the workspace is, and which tabs it shows.
 *
 * Written as `Workspace type:` and `Modules:` under `## Configuration`. The
 * automatic type is shown by name, so "automatic" never hides a guess: it is
 * an exact match of the portfolio type or it is General.
 */
function WorkspaceGroup({
  portfolioType,
  workspaceType,
  modules,
  onType,
  onModules,
}: {
  portfolioType: string;
  workspaceType: WorkspaceType | "";
  modules: WorkspaceModule[];
  onType: (value: WorkspaceType | "") => void;
  onModules: (value: WorkspaceModule[]) => void;
}) {
  const derived = deriveWorkspaceType(portfolioType);
  const effective = workspaceType || derived;
  const defaults = DEFAULT_WORKSPACE_MODULES[effective];
  const custom = modules.length > 0;
  const shown = custom ? modules : [...defaults];
  // Chosen tabs first, in their order; then the rest, in canonical order.
  const ordered = [...shown, ...WORKSPACE_MODULES.filter((module) => !shown.includes(module))];

  const toggle = (module: WorkspaceModule) => {
    const next = shown.includes(module) ? shown.filter((entry) => entry !== module) : [...shown, module];
    // Unticking everything returns to the defaults rather than a tab-less page.
    onModules(next.length === 0 ? [] : next);
  };

  return (
    <Group label="Workspace">
      <Field label="Workspace type" hint={WORKSPACE_TYPE_DESCRIPTIONS[effective]}>
        <select value={workspaceType} onChange={(event) => onType(event.target.value as WorkspaceType | "")} className={SELECT}>
          <option value="">Automatic — {WORKSPACE_TYPE_LABELS[derived]}</option>
          {WORKSPACE_TYPES.map((type) => (
            <option key={type} value={type}>
              {WORKSPACE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <fieldset>
        <SectionLabel
          action={
            custom ? (
              <button
                type="button"
                onClick={() => onModules([])}
                className="os-focus-ring os-meta cursor-pointer rounded-sm text-os-subtle transition-colors duration-150 hover:text-foreground"
              >
                Use {WORKSPACE_TYPE_LABELS[effective].toLowerCase()} defaults
              </button>
            ) : undefined
          }
        >
          Tabs
        </SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          {ordered.map((module) => {
            const on = shown.includes(module);
            return (
              <button
                key={module}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(module)}
                className={`os-focus-ring os-meta min-h-9 cursor-pointer rounded-md border px-3 transition-colors duration-150 ${
                  on ? "border-os-border-strong bg-os-surface-raised text-foreground" : "border-os-border text-os-subtle hover:text-foreground"
                }`}
              >
                {moduleLabel(module, effective)}
              </button>
            );
          })}
        </div>
        <span className="mt-2 block text-[13px] leading-5 text-os-subtle">
          {custom
            ? "Your own set, in the order chosen. The rest stay under More."
            : `The ${WORKSPACE_TYPE_LABELS[effective].toLowerCase()} defaults. The rest stay under More.`}
        </span>
      </fieldset>
    </Group>
  );
}

/** A small segmented choice: quieter than a select for three options with hints. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
}) {
  const current = options.find((option) => option.value === value);

  return (
    <div className="mt-3">
      <div role="radiogroup" className="inline-flex overflow-hidden rounded-md border border-os-border">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`os-focus-ring os-meta min-h-9 cursor-pointer border-l border-os-border px-3 transition-colors duration-150 first:border-l-0 ${
                selected ? "bg-os-surface-raised text-foreground" : "text-os-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {current ? <span className="mt-2 block text-[13px] leading-5 text-os-subtle">{current.hint}</span> : null}
    </div>
  );
}

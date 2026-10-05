import { ArrowLeft, PenLine, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ProjectPlan,
  ProjectPriority,
  ProjectState,
  ProjectTaskSection,
} from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { useCreateProject, usePlanProject } from "@/lib/agentos/queries";
import { toSlug } from "./slug";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * Creating a project — by hand, or from a plan Hermes proposes.
 *
 * **Manual** is a form and four files from templates. No model is involved:
 * `PROJECT.md`, `STATUS.md`, `TASKS.md`, `DECISIONS.md` and a portfolio entry
 * are a mechanical expansion of what is typed here, and asking an LLM to
 * produce them would add latency, cost and non-determinism to an operation
 * with exactly one right answer.
 *
 * **Plan with Hermes** takes a paragraph and asks Hermes for a name, goal,
 * scope, milestones, first tasks and risks. The answer lands in the same form,
 * every field editable, and *nothing is written until the operator clicks
 * create*. Hermes proposes; the person decides. If Hermes cannot be reached
 * the modal says so and offers the manual form with the brief as the goal —
 * a thin plan presented as a plan would waste the review it is asking for.
 *
 * The slug is shown, not hidden. It is the directory name and the key that
 * worker jobs, usage records, designs and sessions all reference — it cannot
 * be changed afterwards without orphaning those, so the operator sees it
 * before committing rather than discovering it later.
 */

const STATES: readonly ProjectState[] = ["active", "incubating", "paused", "blocked"];
const PRIORITIES: readonly ProjectPriority[] = ["high", "medium", "low"];
const SECTIONS: readonly ProjectTaskSection[] = ["now", "next", "later"];

type Mode = "choose" | "manual" | "brief" | "review";

interface PlannedTask {
  title: string;
  section: ProjectTaskSection;
}

export function CreateProject({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [goal, setGoal] = useState("");
  const [type, setType] = useState("Product");
  const [state, setState] = useState<ProjectState>("incubating");
  const [priority, setPriority] = useState<ProjectPriority>("low");
  const [repoPath, setRepoPath] = useState("");

  // Only present after a plan: shown and edited on the review screen, and
  // seeded into the project when created from there.
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<ProjectPlan>();
  const [tasks, setTasks] = useState<PlannedTask[]>([]);
  const [scope, setScope] = useState("");
  const [milestones, setMilestones] = useState("");
  const [risks, setRisks] = useState("");

  const create = useCreateProject();
  const planProject = usePlanProject();
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();

  // The slug follows the name until the operator takes it over, which is the
  // behaviour that makes showing it cost nothing.
  const derived = slugTouched ? slug : toSlug(name);

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

  const applyPlan = (proposed: ProjectPlan) => {
    setPlan(proposed);
    setName(proposed.name);
    setSlug(proposed.slug);
    setSlugTouched(false);
    setGoal(proposed.goal);
    setTasks(proposed.initialTasks);
    setScope(proposed.scope.join("\n"));
    setMilestones(proposed.milestones.join("\n"));
    setRisks(proposed.risks.join("\n"));
    setMode("review");
  };

  const requestPlan = () => {
    if (brief.trim().length === 0) return;

    planProject.mutate(brief.trim(), { onSuccess: applyPlan });
  };

  // Hermes unavailable: the brief becomes the goal and the manual form opens.
  const fallBackToManual = () => {
    setGoal(brief.trim());
    setPlan(undefined);
    setMode("manual");
  };

  const submit = () => {
    if (name.trim().length === 0) return;

    const lines = (value: string) =>
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    // The plan's scope, milestones and risks are worth keeping, and the
    // natural home for "what we decided this is" is the decisions file.
    const decisions =
      mode === "review"
        ? [
            ...(lines(scope).length > 0 ? [{ title: "Scope", body: lines(scope).map((line) => `- ${line}`).join("\n") }] : []),
            ...(lines(milestones).length > 0
              ? [{ title: "Milestones", body: lines(milestones).map((line, index) => `${index + 1}. ${line}`).join("\n") }]
              : []),
            ...(lines(risks).length > 0 ? [{ title: "Risks", body: lines(risks).map((line) => `- ${line}`).join("\n") }] : []),
          ]
        : undefined;

    create.mutate(
      {
        name,
        slug: derived,
        goal: goal.trim() || undefined,
        type,
        state,
        priority,
        repoPath: repoPath.trim() || undefined,
        tasks: mode === "review" ? tasks.filter((task) => task.title.trim()) : undefined,
        decisions,
      },
      {
        onSuccess: (project) => {
          feedback.recordEdit(
            mode === "review" ? `${project.name} created from Hermes' plan.` : `${project.name} created.`,
          );
          onClose();
          void navigate(`/workspaces/${project.slug}`);
        },
        onError: (error) => feedback.reportFailure(error),
      },
    );
  };

  const title =
    mode === "choose"
      ? "Create workspace"
      : mode === "brief"
        ? "Plan with Hermes"
        : mode === "review"
          ? "Review the plan"
          : "Create workspace";

  const subtitle =
    mode === "choose"
      ? "By hand, or from a plan Hermes proposes. Either way, nothing is written until you create it."
      : mode === "brief"
        ? "Describe the idea. Hermes proposes a goal, scope, milestones and first tasks. You edit before anything exists."
        : mode === "review"
          ? plan?.plannedBy === "hermes"
            ? "Everything below is editable. Creating writes the files; nothing has been written yet."
            : "Hermes could not plan this, so the brief is all there is. Fill in the rest."
          : "Writes four files and one portfolio entry. Nothing is generated.";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh] pb-8">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-os-background/85" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-full w-[min(92vw,40rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-os-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {mode !== "choose" ? (
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setMode(mode === "review" ? "brief" : "choose")}
                  className="os-focus-ring -ml-1 cursor-pointer rounded-md p-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              ) : null}
              <SectionLabel>{title}</SectionLabel>
            </div>
            <p className="mt-2 text-[13px] leading-5 text-os-muted">{subtitle}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        {mode === "choose" ? (
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            <ChoiceCard
              title="Create manually"
              body="Name it, set a goal, point it at a repository. Four files from templates."
              onClick={() => setMode("manual")}
              autoFocus
            />
            <ChoiceCard
              title="Plan with Hermes"
              body="Describe the idea in a paragraph. Hermes proposes the shape; you approve it."
              icon={<PenLine className="size-4 text-os-amber" strokeWidth={1.5} aria-hidden="true" />}
              onClick={() => setMode("brief")}
            />
          </div>
        ) : null}

        {mode === "brief" ? (
          <form
            className="min-h-0 overflow-y-auto px-5 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              requestPlan();
            }}
          >
            <Field label="Brief" hint="⌘↵ to send. This is read by Hermes and stored nowhere else.">
              <textarea
                autoFocus
                rows={6}
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) requestPlan();
                }}
                placeholder="A small SaaS that generates property listing content for estate agents…"
                className={`${INPUT} resize-y`}
              />
            </Field>

            {planProject.error ? (
              <div className="mt-5 rounded-lg border border-os-warning/40 bg-os-warning/5 px-4 py-3">
                <p className="text-[13px] leading-5 text-os-warning">{planProject.error.message}</p>
                <button
                  type="button"
                  onClick={fallBackToManual}
                  className="os-focus-ring os-meta mt-2 cursor-pointer rounded-md text-os-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  Create manually with this brief as the goal →
                </button>
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-2">
              <CommandButton
                type="submit"
                variant="primary"
                icon={PenLine}
                iconPosition="start"
                disabled={brief.trim().length === 0}
                loading={planProject.isPending}
                loadingLabel="Planning"
              >
                Ask Hermes to plan
              </CommandButton>
              <CommandButton variant="quiet" onClick={onClose}>
                Cancel
              </CommandButton>
            </div>
          </form>
        ) : null}

        {mode === "manual" || mode === "review" ? (
          <form
            className="min-h-0 overflow-y-auto px-5 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Field label="Name">
              <input autoFocus={mode === "manual"} value={name} onChange={(event) => setName(event.target.value)} placeholder="Pantry Pilot Web" className={INPUT} />
            </Field>

            <Field label="Slug" hint="The directory name, and the id everything else references. Permanent.">
              <input
                value={derived}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(toSlug(event.target.value));
                }}
                placeholder="pantry-pilot-web"
                className={`${INPUT} font-mono text-[13px]`}
              />
            </Field>

            <Field label="Goal">
              <textarea rows={mode === "review" ? 3 : 2} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Build and launch the Pantry Pilot website." className={`${INPUT} resize-y`} />
            </Field>

            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <Field label="Type">
                <input value={type} onChange={(event) => setType(event.target.value)} className={INPUT} />
              </Field>
              <Field label="State">
                <select value={state} onChange={(event) => setState(event.target.value as ProjectState)} className={SELECT}>
                  {STATES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select value={priority} onChange={(event) => setPriority(event.target.value as ProjectPriority)} className={SELECT}>
                  {PRIORITIES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Repository" hint="Optional. Where workers will run.">
              <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="/Users/you/dev/projects/pantry-pilot-web" className={`${INPUT} font-mono text-[13px]`} />
            </Field>

            {mode === "review" ? (
              <>
                <div className="mt-8 border-t border-os-border pt-6">
                  <SectionLabel>Initial tasks</SectionLabel>
                  <p className="mt-2 text-[13px] leading-5 text-os-subtle">Written to TASKS.md with fresh ids. Remove any you do not want.</p>

                  <ul className="mt-4 space-y-2">
                    {tasks.map((task, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <input
                          value={task.title}
                          onChange={(event) =>
                            setTasks((current) => current.map((entry, at) => (at === index ? { ...entry, title: event.target.value } : entry)))
                          }
                          className="os-focus-ring min-w-0 flex-1 rounded-md border border-os-border bg-transparent px-3 py-2 text-[14px] leading-5 text-foreground"
                        />
                        <select
                          value={task.section}
                          onChange={(event) =>
                            setTasks((current) =>
                              current.map((entry, at) => (at === index ? { ...entry, section: event.target.value as ProjectTaskSection } : entry)),
                            )
                          }
                          className="os-focus-ring rounded-md border border-os-border bg-os-surface px-2 py-2 font-mono text-[12px] uppercase tracking-[0.08em] text-os-muted"
                        >
                          {SECTIONS.map((section) => (
                            <option key={section} value={section}>{section}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Remove task ${index + 1}`}
                          onClick={() => setTasks((current) => current.filter((_, at) => at !== index))}
                          className="os-focus-ring cursor-pointer rounded-md p-1.5 text-os-subtle transition-colors duration-150 hover:text-os-danger"
                        >
                          <X className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => setTasks((current) => [...current, { title: "", section: "later" }])}
                    className="os-focus-ring os-meta mt-3 cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
                  >
                    + Add task
                  </button>
                </div>

                <div className="mt-8 border-t border-os-border pt-6">
                  <p className="text-[13px] leading-5 text-os-subtle">
                    Scope, milestones and risks are recorded as the workspace's first decisions. One per line; leave blank to skip.
                  </p>
                  <Field label="Scope">
                    <textarea rows={3} value={scope} onChange={(event) => setScope(event.target.value)} className={`${INPUT} resize-y text-[14px]`} />
                  </Field>
                  <Field label="Milestones">
                    <textarea rows={3} value={milestones} onChange={(event) => setMilestones(event.target.value)} className={`${INPUT} resize-y text-[14px]`} />
                  </Field>
                  <Field label="Risks">
                    <textarea rows={3} value={risks} onChange={(event) => setRisks(event.target.value)} className={`${INPUT} resize-y text-[14px]`} />
                  </Field>
                </div>
              </>
            ) : null}

            {create.error ? <p className="mt-5 text-[13px] leading-5 text-os-danger">{create.error.message}</p> : null}

            <div className="mt-7 flex flex-wrap items-center gap-2">
              <CommandButton type="submit" variant="primary" disabled={name.trim().length === 0} loading={create.isPending} loadingLabel="Creating">
                {mode === "review" ? "Create workspace from plan" : "Create workspace"}
              </CommandButton>
              <CommandButton variant="quiet" onClick={onClose}>
                Cancel
              </CommandButton>
              {mode === "review" && plan ? (
                <span className="os-meta ml-auto text-os-subtle">
                  Planned by {plan.plannedBy === "hermes" ? "Hermes" : "AgentOS"}
                </span>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceCard({
  title,
  body,
  icon,
  onClick,
  autoFocus,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className="os-focus-ring group flex min-h-36 cursor-pointer flex-col items-start rounded-lg border border-os-border p-5 text-left transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised"
    >
      <span className="flex items-center gap-2 text-[16px] leading-6 text-foreground">
        {icon}
        {title}
      </span>
      <span className="mt-2 text-[13px] leading-5 text-os-muted">{body}</span>
      <span className="os-meta mt-auto pt-4 text-os-subtle transition-colors duration-150 group-hover:text-os-amber" aria-hidden="true">
        →
      </span>
    </button>
  );
}

const INPUT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle";

const SELECT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-os-surface px-3 py-2.5 text-[15px] leading-6 text-foreground";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mt-5 block first:mt-0">
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? <span className="mt-2 block text-[13px] leading-5 text-os-subtle">{hint}</span> : null}
    </label>
  );
}

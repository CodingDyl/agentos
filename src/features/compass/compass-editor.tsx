import { Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AreaStatus, Compass, CompassRead, ProjectStatus } from "@shared/compass-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useSaveCompass } from "@/lib/agentos/compass";
import { cn } from "@/lib/utils";

/**
 * The Compass, editable in place. Changes collect until you press Save, which
 * writes me/COMPASS.md. If the file changed meanwhile (an edit in Obsidian),
 * the save is refused rather than overwriting it.
 */

const AREA_STATUSES: readonly AreaStatus[] = ["on track", "slipping", "neglected", "unrated"];
const PROJECT_STATUSES: readonly ProjectStatus[] = ["active", "paused", "admin", "done"];
const STATUS_TONE: Record<AreaStatus, "green" | "marigold" | "flame" | "muted"> = {
  "on track": "green",
  slipping: "marigold",
  neglected: "flame",
  unrated: "muted",
};

export function CompassEditor({ read, notice, onDiscard }: { read: CompassRead; notice?: string; onDiscard?: () => void }) {
  const save = useSaveCompass();
  const [compass, setCompass] = useState<Compass>(read.compass);
  const dirty = !read.exists || JSON.stringify(compass) !== JSON.stringify(read.compass);
  const set = <K extends keyof Compass>(key: K, value: Compass[K]) => setCompass((current) => ({ ...current, [key]: value }));

  const nextGoalId = () => `G${compass.goals.reduce((max, goal) => Math.max(max, Number(goal.id.slice(1))), 0) + 1}`;
  const goalIds = new Set(compass.goals.map((goal) => goal.id));

  return (
    <div className="max-w-[980px] space-y-10 pb-24">
      {notice ? <p className="border-l-[3px] border-paper-blue bg-paper-white px-4 py-3 text-[14px] text-paper-char">{notice}</p> : null}

      {read.problems.length > 0 ? (
        <div role="status" className="border-l-[3px] border-paper-flame bg-paper-white px-4 py-3 text-[13.5px] leading-6 text-paper-char">
          <p className="font-semibold text-paper-moss">Some lines in me/COMPASS.md could not be read. They are kept in the file as they are; fix them there or add them again here.</p>
          <ul className="mt-1 space-y-0.5">
            {read.problems.map((problem) => (
              <li key={`${problem.line}-${problem.text}`}>
                {problem.line > 0 ? <span className="text-paper-sage tabular-nums">Line {problem.line}: </span> : null}
                <code className="text-paper-moss">{problem.text}</code>
                <span className="block text-[12.5px] text-paper-sage">{problem.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PaperSection label="Direction">
        <textarea
          rows={2}
          maxLength={600}
          value={compass.direction}
          onChange={(event) => set("direction", event.target.value)}
          placeholder="Where your life is heading, in a sentence or two."
          className={cn(PAPER_INPUT, "w-full text-[15px]")}
        />
      </PaperSection>

      <PaperSection label="What matters">
        <ListInput values={compass.values} onChange={(values) => set("values", values)} placeholder="e.g. Independence" max={20} />
      </PaperSection>

      <PaperSection label="Areas of life">
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {compass.areas.map((area, index) => (
            <li key={index} className="flex flex-wrap items-center gap-3 py-2">
              <input
                aria-label="Area"
                value={area.name}
                maxLength={40}
                onChange={(event) => set("areas", replace(compass.areas, index, { ...area, name: event.target.value }))}
                className={cn(PAPER_INPUT, "w-48")}
              />
              <div role="radiogroup" aria-label={`How ${area.name || "this area"} is going`} className="flex flex-wrap gap-1">
                {AREA_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={area.status === status}
                    onClick={() => set("areas", replace(compass.areas, index, { ...area, status }))}
                    className={cn("cursor-pointer rounded-none", PAPER_FOCUS)}
                  >
                    {area.status === status ? (
                      <Tag tone={STATUS_TONE[status]}>{status}</Tag>
                    ) : (
                      // Unchosen statuses are outlines, so the chosen one is the only colour in the row.
                      <span className="inline-flex items-center border border-paper-mist px-2 py-px font-paper-utility text-[12px] leading-[16px] font-medium tracking-[0.08em] text-paper-sage uppercase hover:border-paper-sage hover:text-paper-moss">
                        {status}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <RemoveButton label={`Remove ${area.name}`} onClick={() => set("areas", compass.areas.filter((_, at) => at !== index))} />
            </li>
          ))}
        </ul>
        <AddButton disabled={compass.areas.length >= 12} onClick={() => set("areas", [...compass.areas, { name: "", status: "unrated" }])}>
          Add an area
        </AddButton>
      </PaperSection>

      <PaperSection label="Goals" count={compass.goals.length}>
        <ul className="space-y-3">
          {compass.goals.map((goal, index) => {
            const update = (patch: Partial<typeof goal>) => set("goals", replace(compass.goals, index, { ...goal, ...patch }));
            return (
              <li key={goal.id} className="border border-paper-mist bg-paper-white px-4 py-3">
                <div className="flex items-start gap-3">
                  <Tag tone="blue" className="mt-2 shrink-0">
                    {goal.id}
                  </Tag>
                  <input
                    aria-label={`Goal ${goal.id}`}
                    value={goal.title}
                    maxLength={200}
                    onChange={(event) => update({ title: event.target.value })}
                    placeholder="What you want, e.g. R100,000 a month in income"
                    className={cn(PAPER_INPUT, "min-w-0 flex-1 font-semibold")}
                  />
                  <RemoveButton
                    label={`Remove goal ${goal.id}`}
                    onClick={() =>
                      setCompass((current) => ({
                        ...current,
                        goals: current.goals.filter((entry) => entry.id !== goal.id),
                        // Projects stop pointing at a goal that is gone.
                        projects: current.projects.map((project) => ({ ...project, serves: project.serves.filter((id) => id !== goal.id) })),
                      }))
                    }
                  />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-5 sm:pl-[46px]">
                  <Small label="Area">
                    <select value={goal.area} onChange={(event) => update({ area: event.target.value })} className={cn(PAPER_INPUT, "w-full")}>
                      <option value="">None</option>
                      {compass.areas.filter((area) => area.name.trim()).map((area) => (
                        <option key={area.name} value={area.name}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  </Small>
                  <Small label="By">
                    <input value={goal.by} maxLength={40} onChange={(event) => update({ by: event.target.value })} placeholder="2027-12" className={cn(PAPER_INPUT, "w-full")} />
                  </Small>
                  <Small label="Measure">
                    <input value={goal.measure} maxLength={80} onChange={(event) => update({ measure: event.target.value })} placeholder="monthly income" className={cn(PAPER_INPUT, "w-full")} />
                  </Small>
                  <Small label="Now">
                    <input value={goal.now} maxLength={60} onChange={(event) => update({ now: event.target.value })} placeholder="R38,000" className={cn(PAPER_INPUT, "w-full")} />
                  </Small>
                  <Small label="Target">
                    <input value={goal.target} maxLength={60} onChange={(event) => update({ target: event.target.value })} placeholder="R100,000" className={cn(PAPER_INPUT, "w-full")} />
                  </Small>
                </div>
              </li>
            );
          })}
        </ul>
        <AddButton
          disabled={compass.goals.length >= 30}
          onClick={() => set("goals", [...compass.goals, { id: nextGoalId(), title: "", area: "", by: "", measure: "", now: "", target: "" }])}
        >
          Add a goal
        </AddButton>
      </PaperSection>

      <PaperSection label="Projects" count={compass.projects.length}>
        <p className="mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">Link each project to the goals it serves. A project that serves no goal is questioned in the Sunday review.</p>
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {compass.projects.map((project, index) => {
            const update = (patch: Partial<typeof project>) => set("projects", replace(compass.projects, index, { ...project, ...patch }));
            return (
              <li key={index} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto_auto] sm:items-center">
                <input aria-label="Project" value={project.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} className={cn(PAPER_INPUT, "w-full")} />
                <div role="group" aria-label={`Goals ${project.name || "this project"} serves`} className="flex flex-wrap gap-1.5">
                  {compass.goals.length === 0 ? <span className="text-[13px] text-paper-sage">Add goals to link them</span> : null}
                  {compass.goals.map((goal) => {
                    const on = project.serves.includes(goal.id);
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        aria-pressed={on}
                        title={goal.title}
                        onClick={() => update({ serves: on ? project.serves.filter((id) => id !== goal.id) : [...project.serves, goal.id] })}
                        className={cn(
                          "cursor-pointer rounded-none border px-2 py-0.5 text-[12.5px] transition-colors duration-150",
                          on ? "border-paper-blue bg-paper-blue text-paper-white" : "border-paper-mist text-paper-char hover:border-paper-sage",
                          PAPER_FOCUS,
                        )}
                      >
                        {goal.id}
                      </button>
                    );
                  })}
                  {project.serves.length === 0 && compass.goals.length > 0 ? <span className="text-[12.5px] text-paper-flame-deep">Serves no goal</span> : null}
                </div>
                <select aria-label="Status" value={project.status} onChange={(event) => update({ status: event.target.value as ProjectStatus })} className={PAPER_INPUT}>
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <RemoveButton label={`Remove ${project.name}`} onClick={() => set("projects", compass.projects.filter((_, at) => at !== index))} />
              </li>
            );
          })}
        </ul>
        <AddButton disabled={compass.projects.length >= 40} onClick={() => set("projects", [...compass.projects, { name: "", serves: [], status: "active" }])}>
          Add a project
        </AddButton>
      </PaperSection>

      <PaperSection label="This week">
        <p className="mb-3 text-[13px] text-paper-sage">Up to three outcomes. The Sunday review sets these; Today weighs them first.</p>
        <ListInput values={compass.thisWeek} onChange={(values) => set("thisWeek", values)} placeholder="e.g. Send 10 outreach emails" max={3} numbered />
      </PaperSection>

      {/* Visible whenever there is something to save, so a change is never lost by scrolling away. */}
      {dirty ? (
        <div className="fixed inset-x-0 bottom-10 z-20 flex justify-center px-4">
          <div className="flex flex-wrap items-center gap-3 border-[1.5px] border-paper-blue bg-paper-white px-4 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            <span className="text-[13.5px] text-paper-char">{read.exists ? "Unsaved changes" : "Not saved yet"}</span>
            <PaperButton
              variant="amber"
              disabled={save.isPending || hasBlanks(compass)}
              title={hasBlanks(compass) ? "Every goal, area and project needs a name" : undefined}
              onClick={() => save.mutate({ compass: tidy(compass), revision: read.revision })}
            >
              {save.isPending ? "Saving…" : "Save Compass"}
            </PaperButton>
            <PaperButton disabled={save.isPending} onClick={() => (read.exists ? setCompass(read.compass) : onDiscard?.())}>
              Discard
            </PaperButton>
            {save.error ? (
              <span role="alert" className="basis-full text-[13px] text-paper-flame-deep">
                {save.error.message}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {goalIds.size !== compass.goals.length ? <p className="text-paper-flame-deep">Two goals share an id.</p> : null}
    </div>
  );
}

function hasBlanks(compass: Compass): boolean {
  return compass.goals.some((goal) => !goal.title.trim()) || compass.areas.some((area) => !area.name.trim()) || compass.projects.some((project) => !project.name.trim());
}

function tidy(compass: Compass): Compass {
  return {
    ...compass,
    values: compass.values.map((value) => value.trim()).filter(Boolean),
    thisWeek: compass.thisWeek.map((value) => value.trim()).filter(Boolean),
  };
}

function replace<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((entry, at) => (at === index ? value : entry));
}

function ListInput({ values, onChange, placeholder, max, numbered = false }: { values: string[]; onChange: (values: string[]) => void; placeholder: string; max: number; numbered?: boolean }) {
  return (
    <div>
      <ul className="space-y-1.5">
        {values.map((value, index) => (
          <li key={index} className="flex items-center gap-2">
            {numbered ? <span className="w-5 text-right text-[13px] text-paper-sage tabular-nums">{index + 1}.</span> : null}
            <input aria-label={`${placeholder.replace(/^e\.g\. /, "")} ${index + 1}`} value={value} maxLength={200} onChange={(event) => onChange(replace(values, index, event.target.value))} className={cn(PAPER_INPUT, "min-w-0 flex-1")} />
            <RemoveButton label="Remove" onClick={() => onChange(values.filter((_, at) => at !== index))} />
          </li>
        ))}
      </ul>
      <AddButton disabled={values.length >= max} onClick={() => onChange([...values, ""])}>
        Add
      </AddButton>
      {values.length === 0 ? <p className="mt-1 text-[12.5px] text-paper-sage">{placeholder}</p> : null}
    </div>
  );
}

function Small({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn("mt-2 inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-paper-blue hover:underline disabled:cursor-not-allowed disabled:opacity-40", PAPER_FOCUS)}>
      <Plus className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-linen hover:text-paper-flame-deep", PAPER_FOCUS)}>
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}

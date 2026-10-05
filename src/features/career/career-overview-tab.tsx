import { useState } from "react";
import { Link } from "react-router-dom";
import type { CareerData } from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { openCareerResource, useSaveCurrentWork } from "@/lib/agentos/career";
import { cn } from "@/lib/utils";
import { ErrorLine, Field } from "./career-kit";
import { formatDay, formatTimestamp, TEXTAREA } from "./career-model";
import type { CareerTab } from "./career-types-ui";

/** Today, what's being worked on, where the career is heading, and the routines — in that order. */
export function CareerOverviewTab({ data, onTab }: { data: CareerData; onTab: (tab: CareerTab) => void }) {
  const activeGoals = data.growth.goals.filter((goal) => goal.status === "active");

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <PaperSection label="Today" count={data.todayItems.length}>
          {data.todayItems.length === 0 ? (
            <p className="text-[15px] leading-6 text-paper-char">Nothing due. Career admin is up to date.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.todayItems.map((item) => (
                <li key={item.id} className="flex min-w-0 items-baseline gap-3">
                  <span className="size-1.5 shrink-0 translate-y-[-0.15em] rounded-full border border-paper-amber-deep" aria-hidden="true" />
                  <Link to={item.href} className="min-w-0 rounded-sm text-[16px] leading-7 text-paper-char hover:text-paper-moss">
                    {item.title}
                    {item.detail ? <span className="ml-2 text-[12.5px] text-paper-sage">{item.detail}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PaperSection>

        <CurrentWorkSection data={data} />

        <PaperSection
          label="Career"
          action={
            <PaperButton variant="quiet" onClick={() => onTab("growth")}>
              Growth →
            </PaperButton>
          }
        >
          <dl className="grid gap-4 text-[15px] leading-6 sm:grid-cols-3">
            <div>
              <dt className="text-[12.5px] text-paper-sage">Growth focus</dt>
              <dd className="text-paper-char">{data.growth.growthAreas[0] ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-paper-sage">Skills in progress</dt>
              <dd className="text-paper-char">{data.growth.growthAreas.slice(1, 4).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-paper-sage">Next milestone</dt>
              <dd className="text-paper-char">{data.growth.nextMilestone || "Not set"}</dd>
            </div>
          </dl>
          {activeGoals.length > 0 ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-[14.5px] leading-6 text-paper-char">
              {activeGoals.slice(0, 4).map((goal) => (
                <li key={goal.id}>{goal.text}</li>
              ))}
            </ul>
          ) : null}
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
        <PaperSection label="Routines">
          <ul className="space-y-2">
            {data.routines.map((routine) => (
              <li key={routine.id} className="flex items-baseline justify-between gap-3 text-[15px] leading-6">
                <span className={cn(routine.doneThisCycle ? "text-paper-green" : routine.due ? "text-paper-flame-deep" : "text-paper-char")}>
                  <span aria-hidden="true">{routine.doneThisCycle ? "✓ " : "○ "}</span>
                  {routine.name}
                  <span className="sr-only">{routine.doneThisCycle ? " (done)" : routine.due ? " (due)" : ""}</span>
                </span>
                <span className="text-[12.5px] text-paper-sage">{routine.enabled ? formatDay(routine.dueOn) : "off"}</span>
              </li>
            ))}
          </ul>
          {data.timesheet.lastSubmittedAt ? (
            <p className="mt-3 text-[12.5px] text-paper-sage">Last timesheet submitted {formatTimestamp(data.timesheet.lastSubmittedAt)}</p>
          ) : null}
          <PaperButton variant="ghost" className="mt-4" onClick={() => onTab("routines")}>
            Prepare my timesheet
          </PaperButton>
        </PaperSection>

        <ResourcesSection data={data} />
      </div>
    </div>
  );
}

function CurrentWorkSection({ data }: { data: CareerData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.currentWork);
  const save = useSaveCurrentWork();
  const work = data.currentWork;

  return (
    <PaperSection
      label="Currently working on"
      action={
        editing ? null : (
          <PaperButton
            variant="quiet"
            onClick={() => {
              setDraft(work);
              setEditing(true);
            }}
          >
            Edit
          </PaperButton>
        )
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ project: draft.project, objective: draft.objective, progress: draft.progress }, { onSuccess: () => setEditing(false) });
          }}
        >
          <Field label="Project / initiative">
            <input className={cn(PAPER_INPUT, "w-full")} value={draft.project} maxLength={160} onChange={(event) => setDraft({ ...draft, project: event.target.value })} />
          </Field>
          <Field label="Current objective">
            <input className={cn(PAPER_INPUT, "w-full")} value={draft.objective} maxLength={1000} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} />
          </Field>
          <Field label="Recent progress">
            <textarea className={TEXTAREA} value={draft.progress} maxLength={2000} onChange={(event) => setDraft({ ...draft, progress: event.target.value })} />
          </Field>
          <div className="flex gap-2">
            <PaperButton type="submit" variant="amber" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </PaperButton>
            <PaperButton onClick={() => setEditing(false)}>Cancel</PaperButton>
          </div>
          <ErrorLine error={save.error} />
        </form>
      ) : work.project || work.objective ? (
        <div className="space-y-2 text-[15px] leading-6 text-paper-char">
          <p className="font-medium text-paper-moss">{work.project}</p>
          {work.objective ? <p>{work.objective}</p> : null}
          {work.progress ? <p className="whitespace-pre-line text-paper-sage">{work.progress}</p> : null}
        </div>
      ) : (
        <p className="text-[15px] leading-6 text-paper-char">Say what you're working on, so Today and the weekly summary can use it.</p>
      )}
    </PaperSection>
  );
}

function ResourcesSection({ data }: { data: CareerData }) {
  const [error, setError] = useState<unknown>(null);
  return (
    <PaperSection label="Resources">
      <PaperCard className="space-y-1 p-2">
        {data.resources.map((resource) => (
          <button
            key={resource.id}
            type="button"
            disabled={!resource.available}
            title={resource.available ? resource.url : "Switched off in Connectors"}
            onClick={() => {
              setError(null);
              openCareerResource(resource.id).catch(setError);
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-none px-2 py-2 text-left text-[14.5px] text-paper-char hover:bg-paper-linen disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resource.label}
            <span aria-hidden="true" className="text-paper-sage">
              ↗
            </span>
            <span className="sr-only">(opens in a new tab)</span>
          </button>
        ))}
      </PaperCard>
      <ErrorLine error={error} />
      <p className="mt-2 text-[12.5px] text-paper-sage">
        Each link is a capability in <Link to="/connectors" className="underline-offset-4 hover:underline">Connectors</Link>.
      </p>
    </PaperSection>
  );
}

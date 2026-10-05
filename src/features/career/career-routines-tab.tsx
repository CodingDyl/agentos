import { useState } from "react";
import { Link } from "react-router-dom";
import { formatMinutes } from "@shared/career-logic";
import type { CareerData, RoutineStatus, TimesheetRun } from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperSection, PaperSwitch, Tag } from "@/components/paper";
import {
  openCareerResource,
  useMarkTimesheetSubmitted,
  usePatchRoutine,
  useRecordSoccerEvent,
  useReviewTimesheet,
  useRunTimesheet,
  useSaveSoccerDefaults,
} from "@/lib/agentos/career";
import { cn } from "@/lib/utils";
import { ErrorLine, Field } from "./career-kit";
import { WEEKDAYS, formatDay, formatTimestamp } from "./career-model";

export function CareerRoutinesTab({ data }: { data: CareerData }) {
  return (
    <div className="space-y-14">
      <TimesheetSection data={data} />
      <SoccerSection data={data} />
      <RoutineSettings routines={data.routines} />
    </div>
  );
}

// ---------------------------------------------------------------- timesheet

function TimesheetSection({ data }: { data: CareerData }) {
  const run = data.timesheet.latest;
  const extract = useRunTimesheet();
  const [weekStart, setWeekStart] = useState("");

  return (
    <PaperSection id="timesheet" label="Timesheet">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Week starting (optional)">
          <input type="date" className={PAPER_INPUT} value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
        </Field>
        <PaperButton variant="amber" disabled={extract.isPending || !data.timesheet.ready} onClick={() => extract.mutate(weekStart || undefined)}>
          {extract.isPending ? "Reading Toggl…" : "Run extraction"}
        </PaperButton>
        <PaperButton variant="ghost" onClick={() => void openCareerResource("entelect-timesheet").catch(() => undefined)}>
          Open Entelect timesheet ↗
        </PaperButton>
      </div>
      {!data.timesheet.ready ? (
        <p className="mt-3 text-[14px] leading-6 text-paper-flame-deep">
          {data.timesheet.readyDetail}{" "}
          <Link to="/connectors" className="underline underline-offset-4">
            Connectors
          </Link>
        </p>
      ) : null}
      <ErrorLine error={extract.error} />
      {data.timesheet.lastSubmittedAt ? (
        <p className="mt-3 text-[12.5px] text-paper-sage">Last submitted {formatTimestamp(data.timesheet.lastSubmittedAt)}</p>
      ) : null}
      {run ? <TimesheetRunCard run={run} /> : <p className="mt-6 text-[15px] text-paper-char">No extraction yet. Friday's one button: Run extraction.</p>}
    </PaperSection>
  );
}

function TimesheetRunCard({ run }: { run: TimesheetRun }) {
  const review = useReviewTimesheet();
  const submit = useMarkTimesheetSubmitted();
  const [showAll, setShowAll] = useState(false);
  const unmapped = run.rows.filter((row) => !row.mapped);
  const rows = showAll ? run.rows : [...unmapped, ...run.rows.filter((row) => row.mapped)].slice(0, 12);

  return (
    <PaperCard className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-paper-display text-[17px] font-bold">
          Week {run.week} <span className="text-[13px] font-normal text-paper-sage">{formatDay(run.weekStart)} – {formatDay(run.weekEnd)}</span>
        </h3>
        <Tag tone={run.status === "submitted" ? "green" : run.status === "reviewed" ? "blue" : "marigold"}>{run.status}</Tag>
      </div>

      <dl className="mt-4 grid max-w-[28rem] grid-cols-[1fr_auto] gap-x-6 gap-y-1 font-paper-utility text-[15px] tabular-nums">
        <dt>Toggl recorded</dt>
        <dd>{formatMinutes(run.totals.recordedMinutes)}</dd>
        <dt>Mapped</dt>
        <dd>{formatMinutes(run.totals.mappedMinutes)}</dd>
        <dt className={run.totals.unmappedMinutes > 0 ? "text-paper-flame-deep" : undefined}>Unmapped</dt>
        <dd className={run.totals.unmappedMinutes > 0 ? "text-paper-flame-deep" : undefined}>{formatMinutes(run.totals.unmappedMinutes)}</dd>
        <dt className="text-paper-sage">To submit (rounded)</dt>
        <dd className="text-paper-sage">{formatMinutes(run.totals.submittedMinutes)}</dd>
      </dl>

      {run.missingDays.length > 0 || run.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-[14px] leading-6 text-paper-flame-deep">
          {run.missingDays.length > 0 ? <li>No time recorded on {run.missingDays.map(formatDay).join(", ")}.</li> : null}
          {run.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13.5px]">
          <caption className="sr-only">Extracted timesheet rows</caption>
          <thead className="text-[12px] text-paper-sage">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Date</th>
              <th className="py-1.5 pr-3 font-medium">Project</th>
              <th className="py-1.5 pr-3 font-medium">Category</th>
              <th className="py-1.5 pr-3 font-medium">Time</th>
              <th className="py-1.5 pr-3 font-medium">Billable</th>
              <th className="py-1.5 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-mist">
            {rows.map((row, index) => (
              <tr key={`${row.date}-${row.description}-${index}`} className={row.mapped ? undefined : "bg-paper-linen"}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatDay(row.date)}</td>
                <td className="py-1.5 pr-3">{row.project || <span className="text-paper-flame-deep">—</span>}</td>
                <td className="py-1.5 pr-3">{row.category || <span className="text-paper-flame-deep">—</span>}</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {row.hours}h {String(row.minutes).padStart(2, "0")}m
                </td>
                <td className="py-1.5 pr-3">{row.billable ? "Yes" : "No"}</td>
                <td className="py-1.5">
                  {row.description}
                  {row.issue ? <span className="ml-2 text-[12px] text-paper-flame-deep">{row.issue}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {run.rows.length > rows.length || showAll ? (
          <PaperButton className="mt-2 -mx-2" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${run.rows.length} rows`}
          </PaperButton>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {run.status === "extracted" ? (
          <PaperButton variant="amber" disabled={review.isPending} onClick={() => review.mutate(run.id)}>
            Mark reviewed
          </PaperButton>
        ) : null}
        {run.uploadFile ? (
          <a
            href={`/api/career/timesheet/files/${encodeURIComponent(run.uploadFile)}`}
            className="inline-flex min-h-8 items-center px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen"
          >
            Download upload file
          </a>
        ) : null}
        {run.status === "reviewed" ? (
          <PaperButton
            variant="ghost"
            disabled={submit.isPending}
            onClick={() => {
              const acceptUnmapped = run.totals.unmappedMinutes > 0;
              const message = acceptUnmapped
                ? `${formatMinutes(run.totals.unmappedMinutes)} is still unmapped. Did you submit week ${run.week} on the Entelect site with that handled?`
                : `Did you submit week ${run.week} on the Entelect site? AgentOS records it; it does not submit for you.`;
              if (window.confirm(message)) submit.mutate({ runId: run.id, acceptUnmapped });
            }}
          >
            I submitted it
          </PaperButton>
        ) : null}
      </div>
      <ErrorLine error={review.error ?? submit.error} />
      {run.submittedAt ? <p className="mt-3 text-[13px] text-paper-green">Submitted {formatTimestamp(run.submittedAt)}.</p> : null}
    </PaperCard>
  );
}

// ------------------------------------------------------------------- soccer

function SoccerSection({ data }: { data: CareerData }) {
  const { defaults, events, nextDate } = data.soccer;
  const record = useRecordSoccerEvent();
  const saveDefaults = useSaveSoccerDefaults();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(defaults);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const last = events[0];

  return (
    <PaperSection id="soccer" label={defaults.eventType || "Indoor soccer"}>
      <div className="grid gap-8 lg:grid-cols-2">
        <PaperCard>
          <p className="text-[12.5px] text-paper-sage">Next event</p>
          <p className="font-paper-display text-[19px] font-bold">{formatDay(nextDate)}</p>
          <p className="mt-1 text-[14px] text-paper-char">
            {defaults.time}
            {defaults.venue ? ` · ${defaults.venue}` : ""}
            {defaults.maxParticipants ? ` · max ${defaults.maxParticipants}` : ""}
          </p>

          <ol className="mt-4 list-decimal space-y-3 pl-5 text-[14px] leading-6 text-paper-char">
            <li>
              Open Entelect Events and create the event with the defaults above.{" "}
              <PaperButton variant="ghost" className="mt-1" onClick={() => void openCareerResource("entelect-events").catch(() => undefined)}>
                Open Entelect Events ↗
              </PaperButton>
            </li>
            <li>
              Paste the generated link to record it and finish this week's routine.
              <form
                className="mt-2 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (window.confirm(`Record the ${formatDay(nextDate)} soccer event with this link?`)) {
                    record.mutate({ date: nextDate, link: link.trim() }, { onSuccess: () => setLink("") });
                  }
                }}
              >
                <input
                  type="url"
                  required
                  pattern="https://.*"
                  aria-label="Event link"
                  className={cn(PAPER_INPUT, "min-w-0 flex-1")}
                  placeholder="https://events.entelect.co.za/…"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
                <PaperButton type="submit" variant="amber" disabled={record.isPending}>
                  Record link
                </PaperButton>
              </form>
            </li>
          </ol>
          <ErrorLine error={record.error} />
        </PaperCard>

        <div className="space-y-6">
          <div>
            <p className="text-[12.5px] text-paper-sage">Last link</p>
            {last ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <a href={last.link} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-[14px] text-paper-blue underline-offset-4 hover:underline">
                  {formatDay(last.date)} · {last.link}
                </a>
                <PaperButton
                  onClick={() => {
                    void navigator.clipboard?.writeText(last.link).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </PaperButton>
              </div>
            ) : (
              <p className="mt-1 text-[14px] text-paper-char">None yet.</p>
            )}
          </div>

          {editing ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveDefaults.mutate(draft, { onSuccess: () => setEditing(false) });
              }}
            >
              <Field label="Event type">
                <input className={cn(PAPER_INPUT, "w-full")} value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })} />
              </Field>
              <Field label="Day">
                <select className={cn(PAPER_INPUT, "w-full")} value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Time">
                <input type="time" className={cn(PAPER_INPUT, "w-full")} value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
              </Field>
              <Field label="Venue">
                <input className={cn(PAPER_INPUT, "w-full")} value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} />
              </Field>
              <Field label="Max participants">
                <input
                  type="number"
                  min={1}
                  max={200}
                  className={cn(PAPER_INPUT, "w-full")}
                  value={draft.maxParticipants ?? ""}
                  onChange={(event) => setDraft({ ...draft, maxParticipants: event.target.value ? Number(event.target.value) : undefined })}
                />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <input className={cn(PAPER_INPUT, "w-full")} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              </Field>
              <div className="flex gap-2 sm:col-span-2">
                <PaperButton type="submit" variant="amber" disabled={saveDefaults.isPending}>
                  Save defaults
                </PaperButton>
                <PaperButton onClick={() => setEditing(false)}>Cancel</PaperButton>
              </div>
              <ErrorLine error={saveDefaults.error} />
            </form>
          ) : (
            <PaperButton
              variant="quiet"
              className="-mx-2"
              onClick={() => {
                setDraft(defaults);
                setEditing(true);
              }}
            >
              Edit saved defaults
            </PaperButton>
          )}
        </div>
      </div>
    </PaperSection>
  );
}

// ----------------------------------------------------------------- settings

function RoutineSettings({ routines }: { routines: RoutineStatus[] }) {
  const patch = usePatchRoutine();
  return (
    <PaperSection label="Schedule">
      <ul className="divide-y divide-paper-mist border-y border-paper-mist">
        {routines.map((routine) => (
          <li key={routine.id} className="flex flex-wrap items-center gap-4 py-3">
            <PaperSwitch
              checked={routine.enabled}
              label={`${routine.name} on Today`}
              disabled={patch.isPending}
              onChange={(enabled) => patch.mutate({ routineId: routine.id, patch: { enabled } })}
            />
            <span className="min-w-[10rem] flex-1 text-[15px]">{routine.name}</span>
            <select
              aria-label={`${routine.name} day`}
              className={PAPER_INPUT}
              value={routine.weekday}
              onChange={(event) => patch.mutate({ routineId: routine.id, patch: { weekday: Number(event.target.value) } })}
            >
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
            <AutomationLink routine={routine} onSave={(automationId) => patch.mutate({ routineId: routine.id, patch: { automationId } })} />
          </li>
        ))}
      </ul>
      <ErrorLine error={patch.error} />
      <p className="mt-3 max-w-[70ch] text-[13px] leading-6 text-paper-sage">
        Due routines show on Today. For a scheduled reminder, create a Hermes cron job that reads <code>/api/career/agenda</code> and link its id
        here; it then appears under Automations.
      </p>
    </PaperSection>
  );
}

function AutomationLink({ routine, onSave }: { routine: RoutineStatus; onSave: (automationId: string | null) => void }) {
  const [value, setValue] = useState(routine.automationId ?? "");
  if (routine.automationId) {
    return (
      <span className="flex items-center gap-2 text-[13px]">
        <Link to={`/automations/${encodeURIComponent(routine.automationId)}`} className="text-paper-blue underline-offset-4 hover:underline">
          Automation ↗
        </Link>
        <PaperButton onClick={() => onSave(null)}>Unlink</PaperButton>
      </span>
    );
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
    >
      <input aria-label={`Hermes automation id for ${routine.name}`} className={cn(PAPER_INPUT, "w-40")} placeholder="Automation id" value={value} onChange={(event) => setValue(event.target.value)} />
      <PaperButton type="submit">Link</PaperButton>
    </form>
  );
}

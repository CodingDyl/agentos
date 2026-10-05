import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, Plus, CheckSquare } from "lucide-react";
import type { CalendarEvent } from "@shared/today-types";
import type { CalendarTask } from "@shared/calendar-types";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { useCalendarSuggestions, useSaveCalendarEvent, useSaveCalendarTask } from "@/lib/agentos/calendar";
import { addDays, calendarDate, dateFromKey, localDateTime } from "./calendar-model";

const INPUT = `mt-1.5 block min-h-10 w-full border border-paper-mist bg-paper-white px-3 py-2 text-sm text-paper-moss ${PAPER_FOCUS}`;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-paper-char">{label}{children}</label>;
}
function CalendarDialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(560px,calc(100%-32px))] overflow-y-auto border border-paper-mist bg-paper-white p-6 text-paper-moss backdrop:bg-black/35">
    <div className="mb-6 flex items-center justify-between gap-4"><h2 id={id} className="font-paper-display text-2xl font-bold">{title}</h2><PaperButton aria-label="Close editor" disabled={busy} onClick={onClose}><X className="size-4" /></PaperButton></div>
    {children}
  </dialog>;
}
export type TaskDraft = { task?: CalendarTask; date: string; eventId?: string; title?: string };
export function CalendarEventEditor({ event, date, time = "09:00", canWrite, tasks, onClose, onSaved, onTask }: {
  event?: CalendarEvent; date: string; time?: string; canWrite: boolean; tasks: CalendarTask[];
  onClose: () => void; onSaved: (event: CalendarEvent) => void; onTask: (draft: TaskDraft) => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(event ? event.allDay ? event.start : localDateTime(event.start) : `${date}T${time}`);
  const [end, setEnd] = useState(event ? event.allDay ? calendarDate(addDays(dateFromKey(event.end ?? event.start), event.end ? -1 : 0)) : localDateTime(event.end ?? new Date(Date.parse(event.start) + 3600000).toISOString()) : localDateTime(new Date(new Date(`${date}T${time}`).getTime() + 3600000).toISOString()));
  const [allowTasks, setAllowTasks] = useState(event?.allowTasks ?? false);
  const [preparation, setPreparation] = useState(event?.preparation ?? "");
  const [review, setReview] = useState(false);
  const [validation, setValidation] = useState("");
  const save = useSaveCalendarEvent();
  const suggestions = useCalendarSuggestions(event?.id, review && Boolean(event?.allowTasks));
  const linked = tasks.filter((task) => task.calendarEventId === event?.id && event);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dirty = !event || title !== event.title || description !== (event.description ?? "") || location !== (event.location ?? "") || allowTasks !== Boolean(event.allowTasks) || preparation !== (event.preparation ?? "") || allDay !== event.allDay || start !== (event.allDay ? event.start : localDateTime(event.start)) || end !== (event.allDay ? calendarDate(addDays(dateFromKey(event.end ?? event.start), event.end ? -1 : 0)) : localDateTime(event.end ?? new Date(Date.parse(event.start) + 3600000).toISOString()));
  return <CalendarDialog title={event ? "Event details" : "New event"} onClose={onClose} busy={save.isPending}>
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault(); setValidation("");
      if (!start || !end || end < start || (!allDay && end === start)) { setValidation("Choose an end after the start. All-day events may start and end on the same day."); return; }
      void save.mutateAsync({ id: event?.id, etag: event?.etag, input: { title, description, location, allDay, start: allDay ? start : new Date(start).toISOString(), end: allDay ? calendarDate(addDays(dateFromKey(end), 1)) : new Date(end).toISOString(), timeZone: zone, allowTasks, preparation } }).then(onSaved).catch(() => undefined);
    }}>
      <fieldset disabled={!canWrite || save.isPending} className="space-y-4 disabled:opacity-75">
        <Field label="Event title"><input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={500} autoFocus /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => { const checked = e.target.checked; setAllDay(checked); setStart(checked ? start.slice(0, 10) : `${start}T09:00`); setEnd(checked ? end.slice(0, 10) : `${end}T10:00`); }} />All day</label>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Starts"><input className={INPUT} type={allDay ? "date" : "datetime-local"} value={start} onChange={(e) => setStart(e.target.value)} required /></Field><Field label="Ends"><input className={INPUT} type={allDay ? "date" : "datetime-local"} value={end} onChange={(e) => setEnd(e.target.value)} required /></Field></div>
        <p className="text-xs text-paper-sage">{allDay ? "Includes the end date." : `Times shown in ${zone}.`}{event?.recurringEventId ? " Changes apply to this occurrence only." : ""}</p>
        <Field label="Location"><input className={INPUT} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={1000} /></Field>
        <Field label="Description"><textarea className={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} /></Field>
        <div className="border-t border-paper-mist pt-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={allowTasks} onChange={(e) => setAllowTasks(e.target.checked)} />Allow tasks for this event</label><p className="mt-1.5 text-sm text-paper-char">Link your tasks and review suggestions from your preparation notes. Nothing is created automatically.</p></div>
        {allowTasks && <Field label="Preparation notes — one task per line"><textarea className={INPUT} value={preparation} onChange={(e) => setPreparation(e.target.value)} rows={3} maxLength={1000} placeholder="Prepare the slides&#10;Review the agenda" /></Field>}
      </fieldset>
      {!canWrite && <p role="status" className="text-sm text-paper-char">Google event editing is unavailable. Reconnect Google or check Calendar permissions in Connectors.</p>}
      {(validation || save.error) && <p role="alert" className="text-sm text-paper-flame-deep">{validation || save.error?.message}</p>}
      <div className="flex justify-end gap-2"><PaperButton onClick={onClose} disabled={save.isPending}>Close</PaperButton><PaperButton type="submit" variant="amber" disabled={!canWrite || save.isPending || !dirty}>{save.isPending ? "Saving…" : "Save event"}</PaperButton></div>
    </form>
    {event && <section aria-label="Event tasks" className="mt-6 border-t border-paper-mist pt-5">
      <h3 className="flex items-center gap-2 font-semibold"><CheckSquare className="size-4" />Linked tasks</h3>
      {linked.length > 0 ? <ul className="mt-3 space-y-2">{linked.map((task) => <li key={`${task.projectSlug}:${task.taskId}`}><button type="button" disabled={dirty} className={`w-full text-left text-sm underline underline-offset-4 disabled:opacity-50 ${PAPER_FOCUS}`} onClick={() => onTask({ task, date: task.schedule?.date ?? date })}>{task.completed ? "Done: " : ""}{task.title}{task.schedule ? ` · ${task.schedule.date}` : ""}</button></li>)}</ul> : <p className="mt-2 text-sm text-paper-sage">No tasks linked yet.</p>}
      {event.allowTasks && <div className="mt-4 flex flex-wrap gap-2"><PaperButton variant="ghost" disabled={dirty} onClick={() => onTask({ date, eventId: event.id })}><Plus className="size-3.5" />Create task</PaperButton><PaperButton disabled={dirty || !event.preparation?.trim()} onClick={() => setReview(true)}>Review suggestions</PaperButton></div>}
      {dirty && <p className="mt-2 text-xs text-paper-sage">Save your changes before working with linked tasks.</p>}
      {review && <div className="mt-4 space-y-2">
        <p className="text-sm text-paper-char">From your preparation notes. Open a suggestion, choose its date and save to create it.</p>
        {suggestions.isPending && <p role="status" className="text-sm">Reading preparation notes…</p>}
        {suggestions.error && <p role="alert" className="text-sm text-paper-flame-deep">{suggestions.error.message}</p>}
        {suggestions.data?.suggestions.map((suggestion) => { const exists = linked.some((task) => task.title === suggestion); return <div key={suggestion} className="flex items-center justify-between gap-3 border-b border-paper-mist py-2 text-sm"><span>{suggestion}</span><PaperButton disabled={exists || dirty} onClick={() => onTask({ date, eventId: event.id, title: suggestion })}>{exists ? "Already linked" : "Review task"}</PaperButton></div>; })}
        {suggestions.data?.suggestions.length === 0 && <p className="text-sm text-paper-sage">Add preparation notes and save the event first.</p>}
      </div>}
    </section>}
  </CalendarDialog>;
}

export function CalendarTaskEditor({ draft, projects, onClose, onSaved }: { draft: TaskDraft; projects: { slug: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const task = draft.task;
  const [title, setTitle] = useState(task?.title ?? draft.title ?? "");
  const [projectSlug, setProjectSlug] = useState(task?.projectSlug ?? projects[0]?.slug ?? "");
  const [date, setDate] = useState(task?.schedule?.date ?? draft.date);
  const [time, setTime] = useState(task?.schedule?.time ?? "");
  const [duration, setDuration] = useState(task?.schedule?.durationMinutes ?? 60);
  const [completed, setCompleted] = useState(task?.completed ?? false);
  const save = useSaveCalendarTask();
  return <CalendarDialog title={task ? "Edit task" : "Schedule a task"} onClose={onClose} busy={save.isPending}>
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void save.mutateAsync({ projectSlug, taskId: task?.taskId, title, schedule: date ? { date, time: time || undefined, durationMinutes: duration } : null, calendarEventId: draft.eventId ?? task?.calendarEventId, expectedRevision: task?.revision, completed }).then(onSaved).catch(() => undefined);
    }}>
      <fieldset disabled={save.isPending} className="space-y-4">
        <Field label="Task title"><input className={INPUT} required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus /></Field>
        <Field label="Workspace"><select className={INPUT} required value={projectSlug} disabled={Boolean(task)} onChange={(e) => setProjectSlug(e.target.value)}><option value="" disabled>Choose a workspace</option>{projects.map((project) => <option key={project.slug} value={project.slug}>{project.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Scheduled date"><input className={INPUT} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="Time (optional)"><input className={INPUT} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field></div>
        {time && <Field label="Duration in minutes"><input className={INPUT} type="number" min={15} max={1440} step={15} required value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>}
        <p className="text-sm text-paper-char">This task will appear in Today on its scheduled date. Clear the date to leave it unscheduled.</p>
        {task && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} />Completed</label>}
      </fieldset>
      {projects.length === 0 && <p role="status" className="text-sm">Create a workspace first to store your tasks.</p>}
      {save.error && <p role="alert" className="text-sm text-paper-flame-deep">{save.error.message}</p>}
      <div className="flex justify-end gap-2"><PaperButton disabled={save.isPending} onClick={onClose}>Cancel</PaperButton><PaperButton type="submit" variant="amber" disabled={save.isPending || !projectSlug}>{save.isPending ? "Saving…" : task ? "Save task" : "Create task"}</PaperButton></div>
    </form>
  </CalendarDialog>;
}

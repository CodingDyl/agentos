import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import type { CalendarEvent } from "@shared/today-types";
import { PAPER_FOCUS, PaperButton, PaperSection, SegmentedControl } from "@/components/paper";
import { mailConnectUrl } from "@/lib/agentos/client";
import { useCalendarRange, useCalendarTasks, useSaveCalendarTask } from "@/lib/agentos/calendar";
import { CalendarEventEditor, CalendarTaskEditor, type TaskDraft } from "./calendar-editors";
import { addDays, calendarDate, calendarDays, dateFromKey, entriesForDay, type CalendarEntry } from "./calendar-model";
import { CalendarDayAgenda, CalendarMonthGrid, CalendarWeekGrid, CalendarEntryButton } from "./calendar-grid";

export function OverviewCalendar() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"day" | "week" | "month">("month");
  const [selected, setSelected] = useState(() => calendarDate(new Date()));
  const [editingEvent, setEditingEvent] = useState<{ event?: CalendarEvent; date: string; time?: string }>();
  const [editingTask, setEditingTask] = useState<TaskDraft>();
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const days = calendarDays(anchor, view);
  const calendar = useCalendarRange(days[0].toISOString(), addDays(days[days.length - 1], 1).toISOString());
  const taskQuery = useCalendarTasks();
  const moveTask = useSaveCalendarTask();
  const events = calendar.data?.events ?? [];
  const tasks = taskQuery.data?.tasks ?? [];
  const canWrite = calendar.data?.canWrite ?? false;
  const unscheduled = tasks.filter((task) => !task.completed && !task.schedule && task.title.toLowerCase().includes(search.toLowerCase()));
  const openEntry = (entry: CalendarEntry) => { setNotice(""); if (entry.event) setEditingEvent({ event: entry.event, date: entry.event.allDay ? entry.event.start : calendarDate(new Date(entry.event.start)) }); else if (entry.task) setEditingTask({ task: entry.task, date: entry.task.schedule?.date ?? selected }); };
  const navigate = (direction: number) => { const next = view !== "month" ? addDays(anchor, direction * (view === "week" ? 7 : 1)) : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1); setAnchor(next); setSelected(calendarDate(next)); };
  const drop = (key: string, date: string, time?: string) => {
    const task = tasks.find((entry) => `${entry.projectSlug}:${entry.taskId}` === key);
    if (!task || moveTask.isPending) return;
    setNotice("");
    void moveTask.mutateAsync({ projectSlug: task.projectSlug, taskId: task.taskId, title: task.title, expectedRevision: task.revision, schedule: { date, time: time === undefined ? task.schedule?.time : time || undefined, durationMinutes: task.schedule?.durationMinutes ?? 60 } }).then(() => setNotice(`${task.title} moved to ${date}${time ? ` at ${time}` : ""}.`)).catch(() => undefined);
  };
  const gridProps = { days, events, tasks, selected, onSelect: (date: string) => { setSelected(date); setAnchor(dateFromKey(date)); setView("day"); }, onOpen: openEntry, onDrop: drop, canDrag: !moveTask.isPending, canCreate: canWrite, onCreateEvent: (date: string, time: string) => setEditingEvent({ date, time }) };
  const rangeTitle = view === "day" ? anchor.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : view === "month" ? anchor.toLocaleDateString([], { month: "long", year: "numeric" }) : `${days[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
  return <PaperSection id="overview-calendar" label="Calendar" className="mt-10" action={<div className="flex flex-wrap gap-2"><PaperButton onClick={() => setEditingTask({ date: selected })}><Plus className="size-3.5" />Task</PaperButton><PaperButton variant="amber" disabled={!canWrite} onClick={() => setEditingEvent({ date: selected })}><Plus className="size-3.5" />New event</PaperButton></div>}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2"><PaperButton aria-label="Previous calendar period" onClick={() => navigate(-1)}><ChevronLeft className="size-4" /></PaperButton><PaperButton aria-label="Next calendar period" onClick={() => navigate(1)}><ChevronRight className="size-4" /></PaperButton><h3 className="min-w-40 font-paper-display text-lg font-bold" aria-live="polite">{rangeTitle}</h3><PaperButton onClick={() => { const now = new Date(); setAnchor(now); setSelected(calendarDate(now)); }}>Today</PaperButton></div>
      <div className="flex items-center gap-2"><SegmentedControl label="Calendar view" value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" }]} /><PaperButton aria-label="Refresh calendar" disabled={calendar.isFetching || taskQuery.isFetching} onClick={() => { void calendar.refetch(); void taskQuery.refetch(); }}><RefreshCw className="size-3.5" /></PaperButton></div>
    </div>
    {(calendar.data && (calendar.data.status !== "ready" || !canWrite)) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-paper-mist bg-paper-linen px-4 py-3 text-sm"><p className="max-w-[75ch]">{calendar.data.detail ?? "Your Google connection is read-only or editing is disabled. Reconnect Google to grant editing access, or check permissions in Connectors."}</p><div className="flex gap-3">{calendar.data.status !== "not-configured" && <a href={mailConnectUrl()} className={`font-medium text-paper-blue underline ${PAPER_FOCUS}`}>{calendar.data.status === "not-connected" ? "Connect Google" : "Reconnect Google"}</a>}<Link to="/connectors" className={`font-medium text-paper-blue underline ${PAPER_FOCUS}`}>Connectors</Link></div></div>}
    {calendar.error && <p role="alert" className="mb-3 text-sm text-paper-flame-deep">Events could not be loaded: {calendar.error.message}</p>}
    {taskQuery.error && <p role="alert" className="mb-3 text-sm text-paper-flame-deep">Tasks could not be loaded: {taskQuery.error.message}</p>}
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-paper-sage"><p><span className="font-medium text-paper-blue">Google events</span> · AgentOS tasks · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><p role="status">{calendar.isFetching || taskQuery.isFetching ? "Refreshing calendar…" : moveTask.isPending ? "Moving task…" : "Drag a task to reschedule, or open it to edit."}</p></div>
    {moveTask.error && <p role="alert" className="mb-3 text-sm text-paper-flame-deep">{moveTask.error.message}</p>}
    {notice && <p role="status" className="mb-3 text-sm text-paper-char">{notice}</p>}
    {view !== "day" && <p className="mb-2 text-xs text-paper-sage sm:hidden">Swipe the calendar sideways to see every day. Open a task to change its date.</p>}
    {view === "month" ? <CalendarMonthGrid {...gridProps} month={anchor.getMonth()} /> : <CalendarWeekGrid key={view} {...gridProps} />}
    <CalendarDayAgenda date={selected} entries={entriesForDay(events, tasks, selected)} onOpen={openEntry} onCreate={() => setEditingTask({ date: selected })} />
    <div className="mt-4 border-t border-paper-mist pt-3"><PaperButton aria-expanded={showUnscheduled} onClick={() => setShowUnscheduled(!showUnscheduled)}>Unscheduled tasks ({tasks.filter((task) => !task.completed && !task.schedule).length})</PaperButton>{showUnscheduled && <div className="mt-3"><label className="block text-sm text-paper-char">Find a task<input value={search} onChange={(e) => setSearch(e.target.value)} type="search" className={`mt-1 block min-h-9 w-full max-w-sm border border-paper-mist px-3 ${PAPER_FOCUS}`} /></label><p className="mt-2 text-xs text-paper-sage">Drag onto the calendar or open a task to choose its date.</p><ul className="mt-3 grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">{unscheduled.map((task) => <li key={`${task.projectSlug}:${task.taskId}`}><CalendarEntryButton entry={{ key: task.taskId, title: task.title, time: task.projectName, task }} onOpen={openEntry} draggable={!moveTask.isPending} /></li>)}</ul>{!unscheduled.length && <p className="mt-2 text-sm text-paper-sage">No matching unscheduled tasks.</p>}</div>}</div>
    {editingEvent && <CalendarEventEditor key={`${editingEvent.event?.id ?? "new"}:${editingEvent.event?.etag ?? ""}`} {...editingEvent} canWrite={canWrite} tasks={tasks} onClose={() => setEditingEvent(undefined)} onSaved={(event) => { setEditingEvent({ event, date: event.allDay ? event.start : calendarDate(new Date(event.start)) }); setNotice("Event saved to Google Calendar."); }} onTask={(draft) => { setEditingEvent(undefined); setEditingTask(draft); }} />}
    {editingTask && <CalendarTaskEditor draft={editingTask} projects={taskQuery.data?.projects ?? []} onClose={() => setEditingTask(undefined)} onSaved={() => { setEditingTask(undefined); setNotice("Task saved. It will appear in Today on its scheduled date."); }} />}
  </PaperSection>;
}

export function TodayScheduledTasks() {
  const query = useCalendarTasks();
  const [draft, setDraft] = useState<TaskDraft>();
  const today = calendarDate(new Date());
  const tasks = (query.data?.tasks ?? []).filter((task) => task.schedule?.date === today).sort((a, b) => (a.schedule?.time ?? "99").localeCompare(b.schedule?.time ?? "99"));
  if (!tasks.length && !query.error) return null;
  return <PaperSection label="Scheduled today" action={<a href="#overview-calendar" className={`text-sm text-paper-blue underline ${PAPER_FOCUS}`}><CalendarDays className="mr-1 inline size-3.5" />Calendar</a>}>
    {query.error && <p role="alert" className="text-sm text-paper-flame-deep">Scheduled tasks couldn't be read. Refresh the calendar to try again.</p>}
    <ul className="divide-y divide-paper-mist">{tasks.map((task) => <li key={`${task.projectSlug}:${task.taskId}`}><button type="button" className={`flex w-full items-start gap-3 py-3 text-left text-sm ${PAPER_FOCUS}`} onClick={() => setDraft({ task, date: today })}><span className="w-14 shrink-0 text-paper-sage">{task.schedule?.time ?? "Any time"}</span><span className="min-w-0 flex-1"><span className={task.completed ? "line-through" : "font-medium"}>{task.title}</span><span className="mt-1 block text-xs text-paper-sage">{task.projectName}{task.calendarEventId ? " · Event preparation" : ""}</span></span><span className="text-xs text-paper-sage">{task.completed ? "Done" : "Edit"}</span></button></li>)}</ul>
    {draft && <CalendarTaskEditor draft={draft} projects={query.data?.projects ?? []} onClose={() => setDraft(undefined)} onSaved={() => setDraft(undefined)} />}
  </PaperSection>;
}

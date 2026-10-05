import { CalendarDays, CheckSquare, Plus } from "lucide-react";
import { useEffect, useRef, type DragEvent } from "react";
import type { CalendarTask } from "@shared/calendar-types";
import type { CalendarEvent } from "@shared/today-types";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import { calendarDate, entriesForDay, layoutEntries, type CalendarEntry } from "./calendar-model";

export const TASK_DRAG_TYPE = "application/x-agentos-calendar-task";
export function CalendarEntryButton({ entry, onOpen, compact = false, draggable = true }: { entry: CalendarEntry; onOpen: (entry: CalendarEntry) => void; compact?: boolean; draggable?: boolean }) {
  return <button type="button" draggable={Boolean(entry.task) && draggable} onDragStart={(event) => {
    if (!entry.task) return;
    event.dataTransfer.setData(TASK_DRAG_TYPE, `${entry.task.projectSlug}:${entry.task.taskId}`); event.dataTransfer.effectAllowed = "move";
  }} onClick={() => onOpen(entry)} title={`${entry.time} · ${entry.title}${entry.task ? ` · ${entry.task.projectName}` : ""}`} className={cn("flex h-full w-full min-w-0 items-start gap-1.5 rounded-none px-2 py-1.5 text-left text-xs leading-4 transition-colors hover:brightness-95", PAPER_FOCUS, entry.task ? "border border-paper-mist bg-paper-linen text-paper-char" : "bg-paper-blue text-paper-white", entry.task?.completed && "opacity-60", compact ? "max-h-12" : "")}>
    {entry.task ? <CheckSquare className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> : <CalendarDays className="mt-0.5 size-3 shrink-0" aria-hidden="true" />}
    <span className="min-w-0"><span className={cn("block font-medium", compact ? "truncate" : "line-clamp-2", entry.task?.completed && "line-through")}>{entry.title}</span><span className="block text-[12px] opacity-90">{entry.time}{entry.task?.completed ? " · Done" : ""}</span></span>
  </button>;
}
function acceptDrop(event: DragEvent) { if (event.dataTransfer.types.includes(TASK_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }
interface GridProps { days: Date[]; events: CalendarEvent[]; tasks: CalendarTask[]; selected: string; onSelect: (date: string) => void; onOpen: (entry: CalendarEntry) => void; onDrop: (key: string, date: string, time?: string) => void; canDrag: boolean; onCreateEvent: (date: string, time: string) => void; canCreate: boolean }
export function CalendarMonthGrid({ days, events, tasks, selected, onSelect, onOpen, onDrop, canDrag, month }: GridProps & { month: number }) {
  const today = calendarDate(new Date());
  return <div className="overflow-x-auto border border-paper-mist" tabIndex={0} aria-label="Month calendar, scroll horizontally on smaller screens">
    <div className="min-w-[630px]">
      <div className="grid grid-cols-7 border-b border-paper-mist bg-paper-linen">{days.slice(0, 7).map((day) => <div key={day.toISOString()} className="px-3 py-2 text-xs font-medium text-paper-char">{day.toLocaleDateString([], { weekday: "short" })}</div>)}</div>
      <div className="grid grid-cols-7">{days.map((day) => {
        const date = calendarDate(day); const entries = entriesForDay(events, tasks, date);
        return <div key={date} data-calendar-date={date} onDragOver={acceptDrop} onDrop={(event) => { event.preventDefault(); if (canDrag) onDrop(event.dataTransfer.getData(TASK_DRAG_TYPE), date); }} className={cn("relative min-h-32 border-r border-b border-paper-mist p-1.5", day.getMonth() !== month && "bg-paper-linen/60", selected === date && "bg-paper-cream")}>
          <button type="button" aria-label={`Open day view for ${day.toLocaleDateString([], { dateStyle: "full" })}`} onClick={() => onSelect(date)} className={`absolute inset-0 hover:bg-paper-cream ${PAPER_FOCUS}`} />
          <button type="button" aria-label={`Show ${day.toLocaleDateString([], { dateStyle: "full" })}`} aria-pressed={selected === date} aria-current={date === today ? "date" : undefined} onClick={() => onSelect(date)} className={cn("relative mb-1.5 flex min-h-7 w-full items-center justify-between px-1.5 text-xs hover:bg-paper-stone", PAPER_FOCUS, date === today && "font-bold text-paper-blue")}><span>{day.getDate()}</span>{date === today && <span>Today</span>}</button>
          <div className="relative space-y-1">{entries.slice(0, 3).map((entry) => <CalendarEntryButton key={entry.key} entry={entry} onOpen={onOpen} compact draggable={canDrag} />)}</div>
          {entries.length > 3 && <button type="button" className={`relative mt-1 w-full px-1 text-left text-xs text-paper-blue underline ${PAPER_FOCUS}`} onClick={() => onSelect(date)}>+{entries.length - 3} more</button>}
        </div>;
      })}</div>
    </div>
  </div>;
}
export function CalendarWeekGrid({ days, events, tasks, selected, onSelect, onOpen, onDrop, canDrag, onCreateEvent, canCreate }: GridProps) {
  const singleDay = days.length === 1;
  const columns = singleDay ? "grid-cols-[48px_minmax(0,1fr)]" : "grid-cols-[48px_repeat(7,minmax(0,1fr))]";
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * 48; }, []);
  const today = calendarDate(new Date());
  return <div className="overflow-x-auto border border-paper-mist" tabIndex={0} aria-label={singleDay ? "Day calendar" : "Week calendar, scroll horizontally on smaller screens"}>
    <div className={singleDay ? "min-w-0" : "min-w-[720px]"}>
      <div className={cn("grid bg-paper-linen", columns)}><span /><>{days.map((day) => {
        const date = calendarDate(day);
        return <button type="button" key={date} onClick={() => onSelect(date)} aria-pressed={selected === date} aria-current={date === today ? "date" : undefined} className={cn("border-l border-paper-mist py-3 text-sm hover:bg-paper-stone", PAPER_FOCUS, selected === date && "bg-paper-cream", date === today && "font-bold text-paper-blue")}><span className="block text-xs">{day.toLocaleDateString([], { weekday: "short" })}</span><span className="mt-1 block text-lg">{day.getDate()}</span></button>;
      })}</></div>
      <div className={cn("grid border-y border-paper-mist", columns)}><span className="p-1 pt-3 text-[12px] text-paper-sage">All day</span>{days.map((day) => {
        const date = calendarDate(day); const entries = entriesForDay(events, tasks, date).filter((entry) => entry.event ? entry.event.allDay : !entry.task?.schedule?.time);
        return <div key={date} data-calendar-date={date} className="min-h-12 space-y-1 border-l border-paper-mist p-1" onDragOver={acceptDrop} onDrop={(event) => { event.preventDefault(); if (canDrag) onDrop(event.dataTransfer.getData(TASK_DRAG_TYPE), date, ""); }}>{entries.map((entry) => <CalendarEntryButton key={entry.key} entry={entry} onOpen={onOpen} compact draggable={canDrag} />)}</div>;
      })}</div>
      <div ref={scroll} className="max-h-[480px] overflow-y-auto" tabIndex={0} aria-label={singleDay ? "Hours of the day" : "Hours of the week"}>
        <div className={cn("grid", columns)}>
          <div>{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="h-12 border-b border-paper-mist pr-1 pt-1 text-right text-[12px] text-paper-sage tabular-nums">{String(hour).padStart(2, "0")}:00</div>)}</div>
          {days.map((day) => {
            const date = calendarDate(day); const layout = layoutEntries(entriesForDay(events, tasks, date), date);
            return <div key={date} className={cn("relative border-l border-paper-mist", date === today && "bg-paper-linen/50")}>
              {Array.from({ length: 24 }, (_, hour) => { const time = `${String(hour).padStart(2, "0")}:00`; return <button type="button" tabIndex={-1} onClick={() => onCreateEvent(date, time)} disabled={!canCreate} key={hour} data-calendar-slot={`${date}T${time}`} aria-label={`Create event ${date} ${time}`} className="block h-12 w-full border-b border-paper-mist enabled:hover:bg-paper-cream" onDragOver={acceptDrop} onDrop={(event) => { event.preventDefault(); if (canDrag) onDrop(event.dataTransfer.getData(TASK_DRAG_TYPE), date, time); }} />; })}
              {layout.map(({ entry, start, end, lane, lanes }) => <div key={entry.key} className="absolute overflow-hidden p-px" style={{ top: start * 0.8, height: Math.max(24, (end - start) * 0.8), left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}><CalendarEntryButton entry={entry} onOpen={onOpen} draggable={canDrag} /></div>)}
            </div>;
          })}
        </div>
      </div>
    </div>
  </div>;
}
export function CalendarDayAgenda({ date, entries, onOpen, onCreate }: { date: string; entries: CalendarEntry[]; onOpen: (entry: CalendarEntry) => void; onCreate: () => void }) {
  return <div className="mt-4 border-t border-paper-mist pt-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h3><button type="button" className={`inline-flex min-h-8 items-center gap-1 text-xs font-medium text-paper-blue ${PAPER_FOCUS}`} onClick={onCreate}><Plus className="size-3.5" />Add task</button></div>
    {entries.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => <li key={entry.key}><CalendarEntryButton entry={entry} onOpen={onOpen} /></li>)}</ul> : <p className="mt-2 text-sm text-paper-sage">Nothing scheduled for this day.</p>}
  </div>;
}

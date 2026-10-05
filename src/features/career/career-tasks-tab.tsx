import { useMemo, useState } from "react";
import {
  CAREER_SLUG,
  CAREER_TASK_CATEGORIES,
  CAREER_TASK_CATEGORY_LABELS,
  type CareerData,
  type CareerTaskCategory,
  type CareerTaskMeta,
} from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useSaveTaskMeta } from "@/lib/agentos/career";
import type { TaskRecord } from "@/lib/agentos/client";
import { useCreateTask, useEditableTasks, usePatchTask } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { ErrorLine, Field } from "./career-kit";
import { formatDay, TEXTAREA } from "./career-model";

/**
 * Career's tasks are the `career` workspace's TASKS.md, read and written
 * through the same endpoints every workspace uses. Career only adds what
 * TASKS.md has no field for: category, client, due date and notes.
 */
export function CareerTasksTab({ data }: { data: CareerData }) {
  const tasks = useEditableTasks(CAREER_SLUG);
  const [filter, setFilter] = useState<CareerTaskCategory | "all">("all");
  const meta = useMemo(() => new Map(data.taskMeta.map((item) => [item.taskId, item])), [data.taskMeta]);

  const all = (tasks.data?.tasks ?? []).filter((task): task is TaskRecord & { id: string } => Boolean(task.id) && task.section !== "archived");
  const visible = all.filter((task) => filter === "all" || (meta.get(task.id)?.category ?? "other") === filter);
  const open = visible
    .filter((task) => !task.completed)
    .sort((a, b) => (meta.get(a.id)?.dueDate ?? "9999").localeCompare(meta.get(b.id)?.dueDate ?? "9999"));
  const done = visible.filter((task) => task.completed);

  return (
    <div className="max-w-[880px] space-y-10">
      <NewCareerTask revision={tasks.data?.revision} />

      <PaperSection
        label="Open"
        count={open.length}
        action={
          <select aria-label="Filter by category" className={PAPER_INPUT} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">All categories</option>
            {CAREER_TASK_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CAREER_TASK_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        }
      >
        {tasks.isPending ? (
          <p className="text-[14px] text-paper-sage">Reading tasks…</p>
        ) : tasks.isError ? (
          <ErrorLine error={tasks.error} />
        ) : open.length === 0 ? (
          <p className="text-[15px] leading-6 text-paper-char">No open career tasks.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {open.map((task) => (
              <CareerTaskRow key={task.id} task={task} meta={meta.get(task.id)} today={data.today} revision={tasks.data?.revision} />
            ))}
          </ul>
        )}
      </PaperSection>

      {done.length > 0 ? (
        <PaperSection label="Done" count={done.length}>
          <ul className="space-y-1 text-[14px] text-paper-sage">
            {done.slice(0, 15).map((task) => (
              <li key={task.id} className="line-through">
                {task.title}
              </li>
            ))}
          </ul>
        </PaperSection>
      ) : null}
    </div>
  );
}

function NewCareerTask({ revision }: { revision?: string }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CareerTaskCategory>("client");
  const [client, setClient] = useState("");
  const [dueDate, setDueDate] = useState("");
  const create = useCreateTask(CAREER_SLUG);
  const saveMeta = useSaveTaskMeta();

  return (
    <form
      aria-label="New career task"
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_9.5rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        create.mutate(
          { title, section: "now", expectedRevision: revision },
          {
            onSuccess: ({ taskId }) => {
              saveMeta.mutate({ taskId, patch: { category, client: client.trim() || undefined, dueDate: dueDate || undefined } });
              setTitle("");
              setDueDate("");
            },
          },
        );
      }}
    >
      <Field label="Task">
        <input className={cn(PAPER_INPUT, "w-full")} value={title} maxLength={300} placeholder="Standard Bank task follow-up" onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Category">
        <select className={cn(PAPER_INPUT, "w-full")} value={category} onChange={(event) => setCategory(event.target.value as CareerTaskCategory)}>
          {CAREER_TASK_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CAREER_TASK_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Client">
        <input className={cn(PAPER_INPUT, "w-full")} value={client} maxLength={80} placeholder="Standard Bank" onChange={(event) => setClient(event.target.value)} />
      </Field>
      <Field label="Due">
        <input type="date" className={cn(PAPER_INPUT, "w-full")} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </Field>
      <PaperButton type="submit" variant="amber" disabled={create.isPending || !title.trim()}>
        Add
      </PaperButton>
      <div className="sm:col-span-5">
        <ErrorLine error={create.error ?? saveMeta.error} />
      </div>
    </form>
  );
}

function CareerTaskRow({ task, meta, today, revision }: { task: TaskRecord & { id: string }; meta?: CareerTaskMeta; today: string; revision?: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(meta?.notes ?? "");
  const [links, setLinks] = useState((meta?.memoryLinks ?? []).join("\n"));
  const [dueDate, setDueDate] = useState(meta?.dueDate ?? "");
  const patch = usePatchTask(CAREER_SLUG);
  const saveMeta = useSaveTaskMeta();
  const overdue = meta?.dueDate !== undefined && meta.dueDate < today;

  return (
    <li className="py-3">
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Mark “${task.title}” done`}
          className="mt-1.5 size-4 cursor-pointer accent-paper-green"
          checked={task.completed}
          disabled={patch.isPending}
          onChange={() => patch.mutate({ taskId: task.id, completed: true, expectedRevision: revision })}
        />
        <div className="min-w-0 flex-1">
          <button type="button" className="cursor-pointer text-left text-[15.5px] leading-6 text-paper-char hover:text-paper-moss" aria-expanded={open} onClick={() => setOpen(!open)}>
            {task.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-paper-sage">
            <Tag>{CAREER_TASK_CATEGORY_LABELS[meta?.category ?? "other"]}</Tag>
            {meta?.client ? <span>{meta.client}</span> : null}
            {meta?.dueDate ? <span className={overdue ? "text-paper-flame-deep" : undefined}>due {formatDay(meta.dueDate)}</span> : null}
            <span>{task.id}</span>
          </div>
        </div>
      </div>
      {open ? (
        <form
          className="mt-3 ml-7 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveMeta.mutate({
              taskId: task.id,
              patch: {
                notes,
                dueDate: dueDate || undefined,
                memoryLinks: links
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .slice(0, 20),
              },
            });
          }}
        >
          <Field label="Due" className="max-w-[12rem]">
            <input type="date" className={cn(PAPER_INPUT, "w-full")} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea className={TEXTAREA} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field label="Memory / document links (one per line)">
            <textarea className={cn(TEXTAREA, "min-h-16")} value={links} onChange={(event) => setLinks(event.target.value)} />
          </Field>
          <PaperButton type="submit" variant="ghost" disabled={saveMeta.isPending}>
            {saveMeta.isPending ? "Saving…" : "Save details"}
          </PaperButton>
          <ErrorLine error={saveMeta.error} />
        </form>
      ) : null}
      <ErrorLine error={patch.error} />
    </li>
  );
}

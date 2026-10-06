import { Check, PenLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { chaseDate, daysBetween, WAITING_CHASE_AFTER_DAYS } from "@shared/traction-dates";
import type { TractionData, WaitingOn, WaitingOnInput } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperPagination, PaperSection, Tag } from "@/components/paper";
import { useProjects } from "@/lib/agentos/queries";
import { useDeleteWaiting, useResolveWaiting, useSaveWaiting } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, hermesHref, optional, prospectHref, waitingPrompt } from "./traction-model";
import { usePagination } from "@/lib/use-pagination";

/**
 * Waiting On — everything someone else owes.
 *
 * Who, what, since when, and when to chase. Writing it down is the point: a
 * deposit or a piece of feedback you are carrying in your head is mental load,
 * and the day it is due to be chased it joins the queue on its own.
 */

export function TractionWaitingTab({ data }: { data: TractionData }) {
  const [editing, setEditing] = useState<string | "new" | undefined>(data.waiting.length === 0 ? "new" : undefined);
  const pager = usePagination(data.waiting);

  return (
    <PaperSection
      label="Waiting on"
      count={data.waiting.length}
      action={
        editing === "new" ? null : (
          <PaperButton variant="amber" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </PaperButton>
        )
      }
    >
      {editing === "new" ? (
        <PaperCard className="mb-6 max-w-2xl p-5">
          <WaitingForm data={data} onDone={() => setEditing(undefined)} canCancel={data.waiting.length > 0} />
        </PaperCard>
      ) : null}

      {data.waiting.length === 0 ? (
        editing === "new" ? null : <p className="text-[14px] leading-6 text-paper-char">Nothing outstanding. Nobody owes you anything right now.</p>
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((item) =>
            editing === item.id ? (
              <li key={item.id} className="py-4">
                <WaitingForm data={data} item={item} onDone={() => setEditing(undefined)} canCancel />
              </li>
            ) : (
              <WaitingRow key={item.id} data={data} item={item} onEdit={() => setEditing(item.id)} />
            ),
          )}
        </ul>
      )}
      <PaperPagination pager={pager} label="Waiting pages" />
    </PaperSection>
  );
}

function WaitingRow({ data, item, onEdit }: { data: TractionData; item: WaitingOn; onEdit: () => void }) {
  const resolve = useResolveWaiting();
  const remove = useDeleteWaiting();
  const prospect = data.prospects.find((entry) => entry.id === item.prospectId);
  const chase = chaseDate(item);
  const overdue = chase <= data.today;
  const waited = daysBetween(item.since, data.today);

  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] leading-6 font-semibold text-paper-moss">{item.who}</h3>
          {overdue ? <Tag tone="marigold">Chase today</Tag> : null}
        </div>
        <p className="text-[14px] leading-6 text-paper-char">{item.what}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-paper-sage">
          Since {formatShortDate(item.since)} ({waited <= 0 ? "today" : `${waited} ${waited === 1 ? "day" : "days"}`}) · {overdue ? `Chase was due ${formatShortDate(chase)}` : `Next chase ${formatShortDate(chase)}`}
          {prospect ? (
            <>
              {" · "}
              <Link to={prospectHref(prospect.id)} className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
                {prospect.company}
              </Link>
            </>
          ) : null}
          {item.workspace ? (
            <>
              {" · "}
              <Link to={`/workspaces/${encodeURIComponent(item.workspace)}`} className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
                {item.workspace}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <PaperButton variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate(item.id)} aria-label={`Received: ${item.what} from ${item.who}`}>
          <Check className="size-3.5" aria-hidden="true" />
          Received
        </PaperButton>
        <Link
          to={hermesHref(waitingPrompt(item, data.today, prospect))}
          className={cn(
            "inline-flex min-h-8 items-center gap-1.5 rounded-none px-3 text-[13.5px] font-semibold text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
            PAPER_FOCUS,
          )}
        >
          <PenLine className="size-3.5" aria-hidden="true" />
          Draft chase
        </Link>
        <PaperButton onClick={onEdit}>Edit</PaperButton>
        <PaperButton
          aria-label={`Remove ${item.what} from ${item.who}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove “${item.what}” from ${item.who}? Use Received instead if it arrived.`)) remove.mutate(item.id);
          }}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </PaperButton>
      </div>
      {resolve.error ?? remove.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep sm:col-span-2">
          {(resolve.error ?? remove.error)?.message}
        </p>
      ) : null}
    </li>
  );
}

function WaitingForm({ data, item, onDone, canCancel }: { data: TractionData; item?: WaitingOn; onDone: () => void; canCancel: boolean }) {
  const [draft, setDraft] = useState({
    who: item?.who ?? "",
    what: item?.what ?? "",
    since: item?.since ?? data.today,
    nextFollowUp: item?.nextFollowUp ?? "",
    prospectId: item?.prospectId ?? "",
    workspace: item?.workspace ?? "",
  });
  const save = useSaveWaiting();
  const { data: projects } = useProjects();

  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input: WaitingOnInput = {
          who: draft.who.trim(),
          what: draft.what.trim(),
          since: draft.since,
          nextFollowUp: optional(draft.nextFollowUp),
          prospectId: optional(draft.prospectId),
          workspace: optional(draft.workspace),
        };
        save.mutate({ waitingId: item?.id, input }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Who</FieldLabel>
          <input required maxLength={120} placeholder="Story Keeper" className={cn(PAPER_INPUT, "w-full")} value={draft.who} onChange={set("who")} />
        </label>
        <label className="block">
          <FieldLabel>What they owe</FieldLabel>
          <input required maxLength={200} placeholder="Deposit" className={cn(PAPER_INPUT, "w-full")} value={draft.what} onChange={set("what")} />
        </label>
        <label className="block">
          <FieldLabel>Since</FieldLabel>
          <input required type="date" max={data.today} className={cn(PAPER_INPUT, "w-full")} value={draft.since} onChange={set("since")} />
        </label>
        <label className="block">
          <FieldLabel>Chase on (blank means {WAITING_CHASE_AFTER_DAYS} days after)</FieldLabel>
          <input type="date" className={cn(PAPER_INPUT, "w-full")} value={draft.nextFollowUp} onChange={set("nextFollowUp")} />
        </label>
        <label className="block">
          <FieldLabel>Prospect or client</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} value={draft.prospectId} onChange={set("prospectId")}>
            <option value="">None</option>
            {data.prospects.map((prospect) => (
              <option key={prospect.id} value={prospect.id}>
                {prospect.company}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Workspace</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} value={draft.workspace} onChange={set("workspace")}>
            <option value="">None</option>
            {(projects?.projects ?? []).map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2 pt-1">
        <PaperButton type="submit" variant="amber" disabled={save.isPending}>
          {save.isPending ? "Saving…" : item ? "Save" : "Add"}
        </PaperButton>
        {canCancel ? <PaperButton onClick={onDone}>Cancel</PaperButton> : null}
      </div>
      {save.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}

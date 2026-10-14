import { Check, Copy, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PATH_PLAY, type OutreachCase } from "@shared/outreach-case";
import { FOLLOW_UP_STATE_LABELS, type FollowUpRow } from "@shared/outreach-follow-ups";
import { MAX_TOUCHES } from "@shared/outreach-plays";
import type { Touch } from "@shared/outreach-library";
import type { Prospect, TractionData } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperEmpty, PaperError, PaperSection, Tag } from "@/components/paper";
import { useCheckTitanReplies, useFollowUps, useRecordManualSend, useReplyWatch } from "@/lib/agentos/outreach";
import { useDraftCase, useOutreachCases, useSaveToLibrary, useWriteCase } from "@/lib/agentos/outreach-cases";
import { useDismissMailSuggestion, useUpdateProspect } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { CleanUpSection } from "./traction-cleanup";
import { formatShortDate } from "./traction-model";
import { ReviseDraftPanel } from "./traction-outreach-case";

/**
 * Follow-ups: everyone you have emailed who has not answered.
 *
 * One schedule: 3 days after the first email, 4 after the second, and after the
 * third they have gone quiet. A follow-up due is drafted here (in your voice,
 * building on the email you already sent), copied, sent from your own mailbox,
 * and recorded with one press. Nothing is sent from this screen.
 */

const DAY = 86_400_000;

/** Whole days from `iso` to `now`, where `now` is the server's own clock from the loaded data. */
function daysBetween(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
}

function ago(days: number): string {
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

type Notice =
  | { kind: "replied"; row: FollowUpRow }
  | { kind: "closed"; row: FollowUpRow }
  | { kind: "sent"; company: string; touch: number };

export function TractionFollowUpsTab({ data, selectedId, onCompose }: { data: TractionData; selectedId: string | undefined; onCompose: (prospectId: string) => void }) {
  const followUps = useFollowUps();
  const cases = useOutreachCases();
  const [notice, setNotice] = useState<Notice>();

  if (followUps.error) {
    return <PaperError title="Follow-ups could not be read." detail={followUps.error.message} headingLevel="h2" isRetrying={followUps.isFetching} onRetry={() => void followUps.refetch()} />;
  }
  const rows = followUps.data ?? [];
  const group = (...states: FollowUpRow["state"][]) => rows.filter((row) => states.includes(row.state));
  const replied = group("replied");
  const due = group("due");
  const waiting = group("waiting", "final");
  const quiet = group("quiet");
  const stopped = group("stopped");

  const renderRow = (row: FollowUpRow) => (
    <FollowUpItem key={row.prospectId} row={row} data={data} entry={cases.data?.[row.prospectId]} selected={row.prospectId === selectedId} onCompose={onCompose} onNotice={setNotice} />
  );

  return (
    <div className="max-w-[64rem] space-y-10">
      <ReplyWatchBar now={Date.parse(data.generatedAt)} />
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />

      {replied.length > 0 ? (
        <PaperSection label="Wrote back" count={replied.length}>
          <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">They answered, so no more follow-ups go to them. Reply from your mailbox, then move them to Conversation. If it is not really from them, say so and they go back to their follow-ups.</p>
          <ul className="space-y-4">{replied.map(renderRow)}</ul>
        </PaperSection>
      ) : null}

      <PaperSection label="Due now" count={due.length}>
        {due.length === 0 ? (
          <PaperEmpty description={rows.length === 0 ? "Nobody is waiting on a follow-up. Once you press “I sent it” on an email, they appear here with the day the next one is due." : "No follow-up is due right now."} />
        ) : (
          <ul className="space-y-4">{due.map(renderRow)}</ul>
        )}
      </PaperSection>

      {waiting.length > 0 ? (
        <PaperSection label="Waiting for an answer" count={waiting.length}>
          <ul className="space-y-3">{waiting.map(renderRow)}</ul>
        </PaperSection>
      ) : null}

      {quiet.length > 0 ? (
        <PaperSection label="Gone quiet" count={quiet.length}>
          <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">All three emails went unanswered. Close them when you are ready to stop; reaching out again sooner than a few months is not worth it.</p>
          <ul className="space-y-3">{quiet.map(renderRow)}</ul>
        </PaperSection>
      ) : null}

      {stopped.length > 0 ? (
        <PaperSection label="Stopped" count={stopped.length}>
          <ul className="space-y-3">{stopped.map(renderRow)}</ul>
        </PaperSection>
      ) : null}

      <CleanUpSection />
    </div>
  );
}

// ─── What just happened ─────────────────────────────────────────────────────

function NoticeBar({ notice, onDismiss }: { notice: Notice | undefined; onDismiss: () => void }) {
  const update = useUpdateProspect();
  const save = useSaveToLibrary();
  if (!notice) return null;

  const dismiss = (
    <PaperButton variant="ghost" onClick={onDismiss}>
      Dismiss
    </PaperButton>
  );

  if (notice.kind === "sent") {
    return (
      <p role="status" className="border-l-2 border-paper-green bg-paper-cream px-4 py-3 text-[14px] text-paper-moss">
        Recorded: email {notice.touch} to {notice.company}. {notice.touch >= MAX_TOUCHES ? "That was the last one in the sequence." : "The next follow-up shows under Waiting with its date."}
      </p>
    );
  }

  const { row } = notice;
  const canSave = notice.kind === "replied" && row.lastSubject && row.lastBody;
  return (
    <div role="status" className="space-y-2 border-l-2 border-paper-green bg-paper-cream px-4 py-3 text-[14px] text-paper-moss">
      <p>
        {notice.kind === "replied" ? `${row.company} moved to Conversation. Their follow-ups stop.` : `${row.company} closed. Their follow-ups stop.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canSave && !save.isSuccess ? (
          <PaperButton
            variant="amber"
            disabled={save.isPending}
            onClick={() => save.mutate({ prospectId: row.prospectId, subject: row.lastSubject as string, body: row.lastBody as string, touch: Math.min(row.touches, 3) as Touch, gotReply: true, note: "" })}
          >
            {save.isPending ? "Saving…" : "Save the email that got the reply to my library"}
          </PaperButton>
        ) : null}
        {save.isSuccess ? <span className="text-[13px]">Saved to your library, without their details.</span> : null}
        <PaperButton variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ prospectId: row.prospectId, patch: { stage: "contacted" } }, { onSuccess: onDismiss })}>
          Undo
        </PaperButton>
        {dismiss}
      </div>
      {save.error ?? update.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {(save.error ?? update.error)?.message}
        </p>
      ) : null}
    </div>
  );
}

// ─── One business ───────────────────────────────────────────────────────────

const TONE: Record<FollowUpRow["state"], "flame" | "marigold" | "muted" | "green"> = { replied: "green", due: "flame", waiting: "muted", final: "muted", quiet: "marigold", stopped: "muted" };

function FollowUpItem({
  row,
  data,
  entry,
  selected,
  onCompose,
  onNotice,
}: {
  row: FollowUpRow;
  data: TractionData;
  entry: OutreachCase | undefined;
  selected: boolean;
  onCompose: (prospectId: string) => void;
  onNotice: (notice: Notice) => void;
}) {
  const prospect = data.prospects.find((candidate) => candidate.id === row.prospectId);
  const update = useUpdateProspect();
  const draft = useDraftCase();
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "center" });
  }, [selected]);

  const now = Date.parse(data.generatedAt);
  const since = daysBetween(row.lastAt, now);
  const overdue = row.dueAt ? daysBetween(row.dueAt, now) : 0;
  const when =
    row.state === "replied" && row.reply
      ? `Wrote back ${ago(daysBetween(row.reply.at, now))}${row.reply.source === "titan" ? ", found in your Virtara mailbox" : ""}`
      : row.state === "due"
      ? overdue > 0
        ? `Follow-up ${row.nextTouch} was due ${ago(overdue)}`
        : `Follow-up ${row.nextTouch} is due today`
      : row.state === "waiting"
        ? `Follow-up ${row.nextTouch} due ${row.dueAt ? formatShortDate(row.dueAt) : "soon"}`
        : row.state === "final"
          ? "Waiting for an answer to the last email"
          : row.state === "quiet"
            ? `No answer in ${since} days`
            : (row.stoppedReason ?? "Stopped");

  // A draft written after the last email is this follow-up's; the older one is the email already sent.
  const current = entry?.draft && entry.draftAt && entry.draftAt > row.lastAt ? entry : undefined;
  const canDraft = (row.state === "due" || row.state === "waiting") && row.nextTouch !== undefined;
  const needsSetup = draft.error && /^Add .* first\.$/.test(draft.error.message);

  return (
    <li ref={ref} className={cn("border border-paper-mist bg-paper-white p-4", selected ? "border-paper-blue" : undefined)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-paper-moss">
            {row.company}
            {row.contact ? <span className="font-normal text-paper-sage"> · {row.contact}</span> : null}
          </h3>
          <p className="mt-0.5 text-[13px] text-paper-char">
            Email {row.touches} of {MAX_TOUCHES} sent {ago(since)}
            {row.lastSubject ? <span className="text-paper-sage"> · “{row.lastSubject}”</span> : null}
          </p>
          <p className="mt-0.5 text-[13px] font-medium text-paper-moss">{when}</p>
        </div>
        <Tag tone={TONE[row.state]}>{FOLLOW_UP_STATE_LABELS[row.state]}</Tag>
      </div>

      {row.state === "replied" && row.reply ? <ReplyBlock row={row} onNotice={onNotice} /> : null}

      {row.state !== "stopped" && row.state !== "replied" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {canDraft && !current ? (
            <PaperButton variant={row.state === "due" ? "amber" : "ghost"} disabled={draft.isPending} onClick={() => draft.mutate({ prospectId: row.prospectId })}>
              <PenLine className="size-3.5" aria-hidden="true" />
              {draft.isPending ? "Writing… (up to a minute)" : row.state === "due" ? "Draft follow-up" : "Draft it early"}
            </PaperButton>
          ) : null}
          <PaperButton
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate({ prospectId: row.prospectId, patch: { stage: "conversation" } }, { onSuccess: () => onNotice({ kind: "replied", row }) })}
            aria-label={`${row.company} replied`}
          >
            They replied
          </PaperButton>
          <PaperButton
            disabled={update.isPending}
            onClick={() => update.mutate({ prospectId: row.prospectId, patch: { stage: "lost" } }, { onSuccess: () => onNotice({ kind: "closed", row }) })}
            aria-label={`${row.company} is not interested`}
          >
            Not interested
          </PaperButton>
          {prospect?.website ? (
            <a href={prospect.website} target="_blank" rel="noopener noreferrer" className={cn("px-2 text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}>
              Website
            </a>
          ) : null}
        </div>
      ) : null}

      {draft.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {draft.error.message}{" "}
          {needsSetup ? (
            <button type="button" onClick={() => onCompose(row.prospectId)} className={cn("cursor-pointer text-paper-blue hover:underline", PAPER_FOCUS)}>
              Open their email details
            </button>
          ) : null}
        </p>
      ) : null}
      {update.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}

      {current && prospect ? (
        <FollowUpDraft
          key={row.lastAt}
          row={row}
          entry={current}
          prospect={prospect}
          onSent={(touch) => onNotice({ kind: "sent", company: row.company, touch })}
          onRedraft={() => draft.mutate({ prospectId: row.prospectId })}
          redrafting={draft.isPending}
        />
      ) : null}
    </li>
  );
}

// ─── They wrote back ────────────────────────────────────────────────────────

function ReplyBlock({ row, onNotice }: { row: FollowUpRow; onNotice: (notice: Notice) => void }) {
  const update = useUpdateProspect();
  const notTheirs = useDismissMailSuggestion();
  const reply = row.reply;
  if (!reply) return null;

  return (
    <div className="mt-3 space-y-3">
      {/* Their words, shown as text and never followed as instructions. */}
      <div className="border-l-2 border-paper-green bg-paper-cream px-3 py-2 text-[13px] leading-5 text-paper-char">
        <p className="font-semibold text-paper-moss">{reply.subject}</p>
        {reply.snippet ? <p className="mt-0.5 whitespace-pre-wrap">{reply.snippet}</p> : null}
        <p className="mt-1 text-[12px] text-paper-sage">From {reply.fromEmail}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PaperButton
          variant="amber"
          disabled={update.isPending}
          onClick={() => update.mutate({ prospectId: row.prospectId, patch: { stage: "conversation" } }, { onSuccess: () => onNotice({ kind: "replied", row }) })}
          aria-label={`Move ${row.company} to conversation`}
        >
          Move to conversation
        </PaperButton>
        <PaperButton
          disabled={notTheirs.isPending}
          onClick={() => notTheirs.mutate(reply.threadId)}
          aria-label={`This message is not from ${row.company}`}
          title="It is not really from them: they go back to their follow-ups"
        >
          Not theirs
        </PaperButton>
        <PaperButton
          disabled={update.isPending}
          onClick={() => update.mutate({ prospectId: row.prospectId, patch: { stage: "lost" } }, { onSuccess: () => onNotice({ kind: "closed", row }) })}
          aria-label={`${row.company} is not interested`}
        >
          Not interested
        </PaperButton>
        {reply.source === "titan" ? (
          <a href="/inbox" className={cn("px-2 text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}>
            Open Inbox
          </a>
        ) : null}
      </div>
      {update.error ?? notTheirs.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {(update.error ?? notTheirs.error)?.message}
        </p>
      ) : null}
    </div>
  );
}

/** Says whether replies in your Titan mailbox are being noticed, when it last looked, and lets you look now. */
function ReplyWatchBar({ now }: { now: number }) {
  const watch = useReplyWatch();
  const check = useCheckTitanReplies();
  if (!watch.data) return null;

  if (!watch.data.connected) {
    return (
      <p className="text-[13px] leading-5 text-paper-sage">
        Replies to emails you send from your own mailbox are not noticed yet.{" "}
        <a href="/inbox" className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
          Connect your Virtara (Titan) mailbox in Inbox
        </a>{" "}
        and AgentOS checks it for replies every 15 minutes, without marking anything read.
      </p>
    );
  }

  const last = watch.data.lastCheckAt ? Math.max(0, Math.round((now - Date.parse(watch.data.lastCheckAt)) / 60_000)) : undefined;
  const status = check.data ?? watch.data;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-paper-char" aria-live="polite">
      <span>
        Replies are checked in {watch.data.address} every 15 minutes
        {last === undefined ? ", not yet checked." : `; last checked ${last <= 1 ? "just now" : `${last} minutes ago`}.`}
      </span>
      <PaperButton variant="ghost" disabled={check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? "Checking…" : "Check now"}
      </PaperButton>
      {status.lastError ? (
        <span role="alert" className="basis-full text-paper-flame-deep">
          The last check failed: {status.lastError}
        </span>
      ) : null}
      {check.error ? (
        <span role="alert" className="basis-full text-paper-flame-deep">
          {check.error.message}
        </span>
      ) : null}
    </div>
  );
}

// ─── The draft ──────────────────────────────────────────────────────────────

function FollowUpDraft({ row, entry, prospect, onSent, onRedraft, redrafting }: { row: FollowUpRow; entry: OutreachCase; prospect: Prospect; onSent: (touch: number) => void; onRedraft: () => void; redrafting: boolean }) {
  const write = useWriteCase();
  const manual = useRecordManualSend();
  const prospectId = prospect.id;
  const saved = entry.draft ?? { subject: "", body: "" };
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  // A new saved draft (written again, or revised) replaces what is on screen. Our own save changes nothing visible.
  const [seenAt, setSeenAt] = useState(entry.draftAt);
  if (seenAt !== entry.draftAt) {
    setSeenAt(entry.draftAt);
    setSubject(saved.subject);
    setBody(saved.body);
  }
  const [copied, setCopied] = useState(false);
  const play = entry.path ? PATH_PLAY[entry.path] : undefined;

  const keep = () => {
    if (subject !== saved.subject || body !== saved.body) write.mutate({ prospectId, patch: { draft: { subject, body } } });
  };

  const copy = async () => {
    keep();
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-paper-mist pt-4">
      <p className="text-[12px] font-semibold tracking-[0.06em] text-paper-char uppercase">Follow-up {row.nextTouch}: your draft</p>
      <label className="block">
        <FieldLabel>Subject</FieldLabel>
        <input maxLength={150} value={subject} onChange={(event) => setSubject(event.target.value.replace(/[\r\n]/g, " "))} onBlur={keep} className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <label className="block">
        <FieldLabel>Email</FieldLabel>
        <textarea rows={10} maxLength={6000} value={body} onChange={(event) => setBody(event.target.value)} onBlur={keep} className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <PaperButton variant="amber" onClick={() => void copy()}>
          <Copy className="size-3.5" aria-hidden="true" />
          {copied ? "Copied" : "Copy email"}
        </PaperButton>
        <PaperButton
          variant="ghost"
          disabled={manual.isPending || !subject.trim() || !body.trim()}
          onClick={() => manual.mutate({ prospectId, content: { subject, body }, play }, { onSuccess: () => onSent(row.touches + 1) })}
        >
          <Check className="size-3.5" aria-hidden="true" />
          {manual.isPending ? "Saving…" : "I sent it"}
        </PaperButton>
        <PaperButton variant="quiet" disabled={redrafting} onClick={onRedraft}>
          {redrafting ? "Writing…" : "Draft again"}
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">Copy it, send it from your own mailbox, then press I sent it.</span>
      </div>
      {manual.error ?? write.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {(manual.error ?? write.error)?.message}
        </p>
      ) : null}
      <ReviseDraftPanel prospect={prospect} entry={entry} />
    </div>
  );
}

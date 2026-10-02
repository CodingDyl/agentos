import { Check, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CASE_FIELDS,
  draftGaps,
  PATH_PLAY,
  PATHS,
  type CaseFieldKey,
  type OutreachCase,
  type OutreachCasePatch,
  type OutreachPath,
  type Sender,
} from "@shared/outreach-case";
import { MAX_EMAIL_BODY } from "@shared/outreach-types";
import type { Prospect } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, Tag } from "@/components/paper";
import { useCreateGmailDraft, useOutreachStatus, useSendOutreachEmail, useUseInboxForOutreach, type GmailDraftResult } from "@/lib/agentos/outreach";
import { useBriefCase, useDraftCase, useSenders, useWriteCase } from "@/lib/agentos/outreach-cases";
import { useUpdateProspect } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { EmailFinder } from "./traction-outreach-email";
import { SenderManager } from "./traction-outreach-senders";

/**
 * One business, from "who are they" to a sent email.
 *
 * Three cards, always open, top to bottom: get to know them, decide the
 * offer, write the email. Every field saves when you leave it, and every
 * field Hermes can fill is one you can edit. A small tag says who filled a
 * field when it was not you.
 */
export function OutreachCaseView({ prospect, entry }: { prospect: Prospect; entry: OutreachCase }) {
  const senders = useSenders();
  const sender = senders.data?.find((candidate) => candidate.id === entry.senderId);

  return (
    <div className="space-y-6">
      <Overview prospect={prospect} />
      <KnowThem prospect={prospect} entry={entry} />
      <Decide prospect={prospect} entry={entry} sender={sender} />
      <WriteEmail prospect={prospect} entry={entry} senders={senders.data ?? []} sender={sender} />
    </div>
  );
}

// ─── Who they are ───────────────────────────────────────────────────────────

function Overview({ prospect }: { prospect: Prospect }) {
  const update = useUpdateProspect();
  const save = (field: "contact" | "email" | "website", value: string) => {
    const current = prospect[field] ?? "";
    if (value.trim() === current) return;
    update.mutate({ prospectId: prospect.id, patch: { [field]: value.trim() || null } });
  };

  return (
    <PaperCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-paper-display text-[22px] leading-7 font-bold tracking-[-0.01em] text-paper-moss">{prospect.company}</h2>
          <p className="mt-0.5 text-[13px] text-paper-sage">
            {[prospect.segment, prospect.fit ? `${prospect.fit} fit` : undefined, prospect.stage].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {prospect.website ? (
            <a href={prospect.website} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)}>
              Visit website
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
          <Link to={`/traction?tab=prospects&prospect=${encodeURIComponent(prospect.id)}`} className={cn("text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}>
            Open in Prospects
          </Link>
        </div>
      </div>

      {prospect.reasons.length > 0 || prospect.notes ? (
        <div className="mt-4 grid gap-4 text-[13px] leading-5 text-paper-char sm:grid-cols-2">
          {prospect.reasons.length > 0 ? (
            <div>
              <FieldLabel>Why they are on your list</FieldLabel>
              <ul className="list-disc pl-5">
                {prospect.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {prospect.notes ? (
            <div>
              <FieldLabel>From your list</FieldLabel>
              <p className="whitespace-pre-wrap">{prospect.notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ProspectInput key={`c${prospect.contact}`} label="Owner's name" placeholder="e.g. Thandi" value={prospect.contact ?? ""} onSave={(value) => save("contact", value)} />
        <ProspectInput key={`e${prospect.email}`} label="Email" type="email" value={prospect.email ?? ""} onSave={(value) => save("email", value)} />
        <ProspectInput key={`w${prospect.website}`} label="Website" type="url" placeholder="https://" value={prospect.website ?? ""} onSave={(value) => save("website", value)} />
      </div>
      {update.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}
      {!prospect.email ? <EmailFinder prospect={prospect} /> : null}
    </PaperCard>
  );
}

function ProspectInput({ label, value, onSave, type = "text", placeholder }: { label: string; value: string; onSave: (value: string) => void; type?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input type={type} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => onSave(draft)} className={cn(PAPER_INPUT, "w-full")} />
    </label>
  );
}

// ─── 1. Get to know them ────────────────────────────────────────────────────

function KnowThem({ prospect, entry }: { prospect: Prospect; entry: OutreachCase }) {
  const brief = useBriefCase();
  const [notesOpen, setNotesOpen] = useState(Boolean(entry.notes));
  const briefed = Boolean(entry.about || entry.findings.length > 0);

  return (
    <Card number={1} title="Get to know them" done={briefed}>
      <div className="flex flex-wrap items-center gap-3">
        <PaperButton variant={briefed ? "ghost" : "amber"} disabled={brief.isPending} onClick={() => brief.mutate({ prospectId: prospect.id })}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {brief.isPending ? "Hermes is reading their website… (up to two minutes)" : briefed ? "Brief me again" : "Brief me with Hermes"}
        </PaperButton>
        {briefed && !brief.isPending ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Replace what is in these fields with a fresh Hermes brief?")) brief.mutate({ prospectId: prospect.id, replace: true });
            }}
            className={cn("inline-flex cursor-pointer items-center gap-1 text-[13px] text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Start the brief over
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[12.5px] text-paper-sage">
        Hermes reads their website and fills the fields below. It only fills empty ones, so your edits stay.
      </p>
      {brief.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {brief.error.message}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        <CaseText entry={entry} field="about" rows={3} />
        <CaseText entry={entry} field="findings" rows={4} />
        <CaseText entry={entry} field="howWeHelp" rows={3} />
        <CaseText entry={entry} field="hook" rows={2} />
        {notesOpen ? (
          <CaseText entry={entry} field="notes" rows={4} />
        ) : (
          <button type="button" onClick={() => setNotesOpen(true)} className={cn("w-fit cursor-pointer text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}>
            Add research notes
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── 2. Decide ──────────────────────────────────────────────────────────────

function Decide({ prospect, entry, sender }: { prospect: Prospect; entry: OutreachCase; sender: Sender | undefined }) {
  const write = useWriteCase();
  const hermesPath = entry.filledBy.path === "hermes" ? entry.path : undefined;

  const choose = (path: OutreachPath) => {
    const patch: OutreachCasePatch = { path };
    // Your usual prices, from the company it is sent as, when nothing is set yet.
    if (sender) {
      if (path === "build_first" && !entry.monthlyPrice && sender.defaultMonthly) patch.monthlyPrice = sender.defaultMonthly;
      if (path === "build_first" && !entry.setupPrice && sender.defaultSetup) patch.setupPrice = sender.defaultSetup;
      if (path === "cold_pitch" && !entry.projectPrice && sender.defaultProject) patch.projectPrice = sender.defaultProject;
    }
    write.mutate({ prospectId: prospect.id, patch });
  };

  return (
    <Card number={2} title="Decide how to help" done={Boolean(entry.path && entry.offer && (entry.path !== "build_first" || entry.previewUrl))}>
      {entry.path && entry.pathReason ? (
        <p className="mb-3 flex max-w-[72ch] items-start gap-2 text-[13px] leading-5 text-paper-char">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-paper-blue" aria-hidden="true" />
          <span>
            {hermesPath ? <span className="font-semibold">Hermes suggests {PATHS[hermesPath].name.toLowerCase()}. </span> : null}
            {entry.pathReason}
          </span>
        </p>
      ) : null}

      <div role="radiogroup" aria-label="Approach" className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(PATHS) as OutreachPath[]).map((path) => {
          const selected = entry.path === path;
          return (
            <button
              key={path}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={write.isPending}
              onClick={() => choose(path)}
              className={cn(
                "cursor-pointer rounded-none border-[1.5px] px-4 py-3 text-left transition-colors duration-150",
                selected ? "border-paper-blue bg-paper-white" : "border-paper-mist bg-paper-cream hover:border-paper-sage",
                PAPER_FOCUS,
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-paper-moss">{PATHS[path].name}</span>
                {selected ? <Check className="size-4 text-paper-blue" aria-hidden="true" /> : null}
              </span>
              <span className="mt-1 block text-[13px] leading-5 text-paper-char">{PATHS[path].line}</span>
              <span className="mt-1 block text-[12.5px] leading-5 text-paper-sage">{PATHS[path].when}</span>
            </button>
          );
        })}
      </div>

      {entry.path === "build_first" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CaseLine entry={entry} field="previewUrl" type="url" />
          <CaseLine entry={entry} field="monthlyPrice" />
          <CaseLine entry={entry} field="setupPrice" />
        </div>
      ) : null}
      {entry.path === "cold_pitch" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CaseLine entry={entry} field="projectPrice" />
        </div>
      ) : null}

      {entry.framing.length > 0 ? (
        <div className="mt-5">
          <FieldLabel>Ways to frame the offer</FieldLabel>
          <ul className="mt-1 space-y-1.5">
            {entry.framing.map((idea) => {
              const inUse = entry.offer.trim() === idea.trim();
              return (
                <li key={idea} className="flex items-start justify-between gap-3 bg-paper-linen px-3 py-2 text-[13px] leading-5 text-paper-char">
                  <span>{idea}</span>
                  <PaperButton variant="ghost" className="shrink-0" disabled={inUse || write.isPending} onClick={() => write.mutate({ prospectId: prospect.id, patch: { offer: idea } })}>
                    {inUse ? "In use" : "Use this"}
                  </PaperButton>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="mt-4">
        <CaseText entry={entry} field="offer" rows={2} />
      </div>
      {write.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {write.error.message}
        </p>
      ) : null}
    </Card>
  );
}

// ─── 3. The email ───────────────────────────────────────────────────────────

function WriteEmail({ prospect, entry, senders, sender }: { prospect: Prospect; entry: OutreachCase; senders: Sender[]; sender: Sender | undefined }) {
  const write = useWriteCase();
  const draft = useDraftCase();
  const status = useOutreachStatus();
  const useInbox = useUseInboxForOutreach();
  const [managing, setManaging] = useState(false);
  const gaps = draftGaps(entry, sender);
  const mailbox = status.data;

  return (
    <Card number={3} title="Write the email" done={Boolean(entry.draft?.body.trim())}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px]">
          <FieldLabel>Send as</FieldLabel>
          <select
            value={entry.senderId}
            onChange={(event) => write.mutate({ prospectId: prospect.id, patch: { senderId: event.target.value || null } })}
            className={cn(PAPER_INPUT, "w-full")}
          >
            <option value="">{senders.length === 0 ? "Add a company first" : "Choose a company…"}</option>
            {senders.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.company} ({candidate.fromName})
              </option>
            ))}
          </select>
        </label>
        <PaperButton variant="quiet" onClick={() => setManaging((open) => !open)}>
          {managing ? "Done with companies" : senders.length === 0 ? "Add a company" : "Manage companies"}
        </PaperButton>
      </div>
      {managing || senders.length === 0 ? (
        <div className="mt-3">
          <SenderManager />
        </div>
      ) : null}

      <p className="mt-3 text-[12.5px] text-paper-sage">
        {mailbox?.connected ? (
          <>
            Goes out from <span className="font-semibold text-paper-char">{mailbox.address}</span>
            {sender ? (
              <>
                {" "}
                as <span className="font-semibold text-paper-char">{sender.fromName}</span>, with {sender.company}&apos;s signature.
              </>
            ) : null}
          </>
        ) : mailbox?.inboxAddress ? (
          <>
            No outreach mailbox is connected.{" "}
            <button type="button" disabled={useInbox.isPending} onClick={() => useInbox.mutate()} className={cn("cursor-pointer text-paper-blue hover:underline", PAPER_FOCUS)}>
              Send from {mailbox.inboxAddress}
            </button>
          </>
        ) : (
          "No outreach mailbox is connected. Connect Gmail in Connectors first."
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PaperButton variant="amber" disabled={draft.isPending || gaps.length > 0} onClick={() => draft.mutate(prospect.id)}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {draft.isPending ? "Hermes is writing… (up to a minute)" : entry.draft ? "Draft again with Hermes" : "Draft with Hermes"}
        </PaperButton>
        {gaps.length > 0 ? <span className="text-[13px] text-paper-sage">Still needed: {gaps.join(", ")}.</span> : null}
      </div>
      {draft.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {draft.error.message}
        </p>
      ) : null}

      <DraftEditor key={`${entry.draft?.subject}\u0000${entry.draft?.body}`} prospect={prospect} entry={entry} sender={sender} />
    </Card>
  );
}

function DraftEditor({ prospect, entry, sender }: { prospect: Prospect; entry: OutreachCase; sender: Sender | undefined }) {
  const write = useWriteCase();
  const status = useOutreachStatus();
  const send = useSendOutreachEmail();
  const create = useCreateGmailDraft();
  const [subject, setSubject] = useState(entry.draft?.subject ?? "");
  const [body, setBody] = useState(entry.draft?.body ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [created, setCreated] = useState<GmailDraftResult>();

  const changed = subject !== (entry.draft?.subject ?? "") || body !== (entry.draft?.body ?? "");
  const saveDraft = () => {
    if (changed) write.mutate({ prospectId: prospect.id, patch: { draft: subject.trim() || body.trim() ? { subject, body } : null } });
  };
  const hasContent = subject.trim().length > 0 && body.trim().length > 0;
  const mailbox = status.data;
  const blocker = !mailbox?.connected
    ? "Connect the outreach mailbox first."
    : !sender
      ? "Choose which company it is from."
      : !prospect.email
        ? "Add their email address at the top."
        : undefined;
  const play = entry.path ? PATH_PLAY[entry.path] : undefined;

  return (
    <div className="mt-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <label className="block">
            <FieldLabel>Subject</FieldLabel>
            <input maxLength={150} value={subject} onChange={(event) => setSubject(event.target.value.replace(/[\r\n]/g, " "))} onBlur={saveDraft} className={cn(PAPER_INPUT, "w-full")} />
          </label>
          <label className="block">
            <FieldLabel>Email</FieldLabel>
            <textarea
              rows={14}
              maxLength={MAX_EMAIL_BODY}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onBlur={saveDraft}
              placeholder="Draft with Hermes, or write it yourself. It saves when you click away."
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>
          {sender && body.trim() && !body.includes(sender.signature.trim()) ? (
            <button
              type="button"
              onClick={() => setBody(`${body.trim()}\n\n--\n${sender.signature.trim()}`)}
              className={cn("cursor-pointer text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}
            >
              Add {sender.company}&apos;s signature
            </button>
          ) : null}
        </div>
        <Checklist subject={subject} body={body} entry={entry} sender={sender} />
      </div>

      {hasContent ? (
        <div className="mt-4 space-y-2">
          {reviewing ? (
            <div role="group" aria-label="Review before sending" className="rounded-none border-[1.5px] border-paper-blue bg-paper-white px-4 py-3 text-[13px] leading-5 text-paper-char">
              <p className="text-[12px] font-semibold tracking-[0.06em] uppercase">Review before sending</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-paper-sage">From</dt>
                <dd>
                  {sender?.fromName} &lt;{mailbox?.address}&gt;
                </dd>
                <dt className="text-paper-sage">To</dt>
                <dd className="font-semibold">{prospect.email}</dd>
                <dt className="text-paper-sage">Subject</dt>
                <dd className="font-semibold">{subject}</dd>
              </dl>
              <pre className="mt-3 max-h-72 overflow-auto border-t border-paper-mist pt-3 font-sans whitespace-pre-wrap">{body}</pre>
              <p className="mt-2 text-paper-sage">
                Sent now, to this one address. {mailbox?.sentToday ?? 0} of {mailbox?.dailyCap ?? 0} sent in the last 24 hours. It cannot be recalled.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <PaperButton
                  variant="amber"
                  disabled={send.isPending}
                  onClick={() => {
                    saveDraft();
                    send.mutate(
                      { prospectId: prospect.id, content: { subject, body }, play, senderId: sender?.id },
                      {
                        onSuccess: (result) => {
                          setSentTo(result.to);
                          setReviewing(false);
                        },
                      },
                    );
                  }}
                >
                  {send.isPending ? "Sending…" : `Send to ${prospect.email}`}
                </PaperButton>
                <PaperButton variant="ghost" disabled={send.isPending} onClick={() => setReviewing(false)}>
                  Keep editing
                </PaperButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <PaperButton variant="amber" disabled={Boolean(blocker) || Boolean(sentTo)} onClick={() => setReviewing(true)}>
                Review and send
              </PaperButton>
              <PaperButton
                variant="ghost"
                disabled={Boolean(blocker) || create.isPending || Boolean(sentTo)}
                onClick={() => {
                  saveDraft();
                  create.mutate({ prospectId: prospect.id, content: { subject, body }, play, senderId: sender?.id }, { onSuccess: setCreated });
                }}
              >
                {create.isPending ? "Saving…" : "Save as Gmail draft"}
              </PaperButton>
              {blocker ? <span className="text-[13px] text-paper-sage">{blocker}</span> : null}
            </div>
          )}
          {send.error ?? create.error ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {(send.error ?? create.error)?.message}
            </p>
          ) : null}
          {sentTo ? (
            <p role="status" className="text-[13px] font-semibold text-paper-moss">
              Sent to {sentTo}. If they do not reply, a follow-up shows under Results in 3 days.
            </p>
          ) : null}
          {created ? (
            <p role="status" className="text-[13px] text-paper-char">
              Saved in {created.address}&apos;s Drafts.{" "}
              <a href={created.openUrl} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)}>
                Open in Gmail
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {write.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {write.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** What separates an email that gets answered from one that is ignored. Advice; the server holds the hard rules. */
function Checklist({ subject, body, entry, sender }: { subject: string; body: string; entry: OutreachCase; sender: Sender | undefined }) {
  if (!body.trim()) return null;
  const signature = sender?.signature.trim() ?? "";
  const message = signature && body.includes(signature) ? body.slice(0, body.lastIndexOf(signature)).replace(/--\s*$/, "") : body;
  const words = message.split(/\s+/).filter(Boolean).length;
  const links = message.match(/https?:\/\/\S+/g) ?? [];
  const questions = (message.match(/\?/g) ?? []).length;
  const firstWords = message.trim().split(/\n/).find((line) => line.trim() && !/^(hi|hello|hey|dear)\b/i.test(line.trim())) ?? "";
  const spammy = /(guarantee|100%|act now|limited time|click here|amazing (company|business)|hope this (email )?finds you)/i.test(`${subject} ${message}`);
  const prices = [entry.monthlyPrice, entry.setupPrice, entry.projectPrice].filter(Boolean);

  const checks: { ok: boolean; label: string }[] = [
    { ok: words <= 125, label: `${words} words (under 125 reads well on a phone)` },
    { ok: subject.split(/\s+/).filter(Boolean).length <= 8, label: "Short, plain subject" },
    { ok: !/^i\b/i.test(firstWords.trim()), label: "Opens about them, not you" },
    { ok: questions === 1, label: questions === 1 ? "One question to answer" : `${questions} questions: ask exactly one` },
    entry.path === "build_first"
      ? { ok: Boolean(entry.previewUrl) && message.includes(entry.previewUrl), label: "Includes the preview link" }
      : { ok: links.length === 0, label: links.length === 0 ? "No links (better delivery)" : `${links.length} links: remove them` },
    ...prices.map((price) => ({ ok: message.includes(price), label: `Price as you set it: ${price}` })),
    { ok: !spammy, label: spammy ? "Wording that trips spam filters" : "No spam-filter wording" },
    { ok: Boolean(signature) && body.includes(signature), label: "Signature and opt-out line at the foot" },
  ];

  return (
    <div aria-label="Checks" className="self-start bg-paper-linen px-3 py-3">
      <p className="text-[12px] font-semibold tracking-[0.06em] text-paper-char uppercase">Checks</p>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-5">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2">
            <span className={cn("mt-[3px] inline-flex size-3.5 shrink-0 items-center justify-center font-bold", check.ok ? "text-paper-green" : "text-paper-flame-deep")} aria-hidden="true">
              {check.ok ? <Check className="size-3.5" /> : "!"}
            </span>
            <span className={check.ok ? "text-paper-char" : "text-paper-flame-deep"}>
              <span className="sr-only">{check.ok ? "Passed: " : "Check: "}</span>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-5 text-paper-sage">Best sent Tuesday to Thursday, mid-morning.</p>
    </div>
  );
}

// ─── Fields ─────────────────────────────────────────────────────────────────

const FIELD = Object.fromEntries(CASE_FIELDS.map((field) => [field.key, field])) as Record<CaseFieldKey, (typeof CASE_FIELDS)[number]>;

function FilledTag({ entry, field }: { entry: OutreachCase; field: CaseFieldKey }) {
  const by = entry.filledBy[field];
  if (!by || by === "you") return null;
  return (
    <Tag tone={by === "hermes" ? "blue" : "marigold"} className="ml-2 align-middle">
      {by === "hermes" ? "Hermes" : "Agent"}
    </Tag>
  );
}

/** A text field on the case. Saves when you leave it; shows Hermes' or an agent's tag until you edit it. */
function CaseText({ entry, field, rows }: { entry: OutreachCase; field: CaseFieldKey; rows: number }) {
  const meta = FIELD[field];
  const raw = entry[field as keyof OutreachCase];
  const serverValue = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
  return <CaseTextInner key={serverValue} entry={entry} field={field} rows={rows} serverValue={serverValue} label={meta.label} hint={meta.hint} list={Boolean(meta.list)} />;
}

function CaseTextInner({ entry, field, rows, serverValue, label, hint, list }: { entry: OutreachCase; field: CaseFieldKey; rows: number; serverValue: string; label: string; hint: string; list: boolean }) {
  const write = useWriteCase();
  const [value, setValue] = useState(serverValue);
  const save = () => {
    if (value === serverValue) return;
    const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
    const next = list ? (lines.length > 0 ? lines : null) : value.trim() || null;
    write.mutate({ prospectId: entry.prospectId, patch: { [field]: next } as OutreachCasePatch });
  };
  return (
    <label className="block">
      <FieldLabel>
        {label}
        <FilledTag entry={entry} field={field} />
      </FieldLabel>
      <textarea rows={rows} value={value} onChange={(event) => setValue(event.target.value)} onBlur={save} className={cn(PAPER_INPUT, "w-full")} />
      {hint ? <span className="mt-0.5 block text-[12.5px] text-paper-sage">{hint}</span> : null}
      {write.error ? <span className="mt-0.5 block text-[12.5px] text-paper-flame-deep">{write.error.message}</span> : null}
    </label>
  );
}

function CaseLine({ entry, field, type = "text" }: { entry: OutreachCase; field: CaseFieldKey; type?: string }) {
  const serverValue = String(entry[field as keyof OutreachCase] ?? "");
  return <CaseLineInner key={serverValue} entry={entry} field={field} type={type} serverValue={serverValue} />;
}

function CaseLineInner({ entry, field, type, serverValue }: { entry: OutreachCase; field: CaseFieldKey; type: string; serverValue: string }) {
  const write = useWriteCase();
  const meta = FIELD[field];
  const [value, setValue] = useState(serverValue);
  return (
    <label className="block">
      <FieldLabel>{meta.label}</FieldLabel>
      <input
        type={type}
        value={value}
        placeholder={type === "url" ? "https://" : undefined}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() !== serverValue) write.mutate({ prospectId: entry.prospectId, patch: { [field]: value.trim() || null } as OutreachCasePatch });
        }}
        className={cn(PAPER_INPUT, "w-full")}
      />
      <span className="mt-0.5 block text-[12.5px] text-paper-sage">{meta.hint}</span>
      {write.error ? <span className="mt-0.5 block text-[12.5px] text-paper-flame-deep">{write.error.message}</span> : null}
    </label>
  );
}

function Card({ number, title, done, children }: { number: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <PaperCard className="p-5" aria-label={title}>
      <h3 className="mb-4 flex items-center gap-2.5 font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">
        <span
          className={cn("inline-flex size-6 items-center justify-center rounded-none font-paper-ui text-[12px] tabular-nums", done ? "bg-paper-green text-paper-white" : "bg-paper-blue text-paper-white")}
          aria-hidden="true"
        >
          {done ? <Check className="size-3.5" /> : number}
        </span>
        {title}
        {done ? <span className="sr-only">(done)</span> : null}
      </h3>
      {children}
    </PaperCard>
  );
}

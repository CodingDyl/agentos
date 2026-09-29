import { Check, Clock, ExternalLink, PenLine, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { QueueItem, TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PaperButton, Tag } from "@/components/paper";
import { useConfirmMailLink, useDismissMailSuggestion, useQueueAction } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { magnetForSource } from "@shared/lead-magnet-types";
import {
  crmFollowUpPrompt,
  hermesHref,
  hermesPrompt,
  inboundReplyPrompt,
  portalViewPrompt,
  prospectReplyPrompt,
  queueItemHref,
  secondTouchPrompt,
  stageLabel,
  waitingPrompt,
} from "./traction-model";

/**
 * Today's traction: the revenue work, one item at a time.
 *
 * Four verbs and no more. DONE records that the person did it; SNOOZE puts it
 * off until tomorrow; OPEN goes to the prospect (or the Waiting On list); ASK
 * HERMES hands the item to
 * the agent console with everything known about the prospect — research when
 * the specifics are missing, a draft when they are present. Nothing is sent
 * from here, ever.
 */

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  viewed: "Opened",
  reply: "They replied",
  inbound: "Website lead",
  second_touch: "Second touch",
  due: "Due",
  follow_up: "Follow-up",
  waiting: "Waiting on",
  crm: "Virtec",
  case_study: "Case study",
  referral: "Referral",
  contact: "New outreach",
};

const KIND_TONE: Record<QueueItem["kind"], "flame" | "marigold" | "green" | "muted" | "blue"> = {
  viewed: "blue",
  reply: "flame",
  inbound: "flame",
  second_touch: "marigold",
  due: "flame",
  follow_up: "marigold",
  waiting: "marigold",
  crm: "blue",
  case_study: "green",
  referral: "green",
  contact: "muted",
};

export function TractionQueue({ data, limit }: { data: TractionData; limit?: number }) {
  const action = useQueueAction();
  const confirmReply = useConfirmMailLink();
  const notTheirs = useDismissMailSuggestion();
  const navigate = useNavigate();
  const items = limit ? data.queue.slice(0, limit) : data.queue;

  if (data.queue.length === 0) {
    return (
      <p className="text-[14px] leading-6 text-paper-char">
        {data.prospects.length === 0
          ? data.waiting.length > 0
            ? "Nothing to chase today."
            : "Nothing to work on yet. Add a few prospects that fit the ICP and the queue fills itself."
          : data.doneToday > 0
            ? "Today's traction is done. Tomorrow's queue builds itself from what you did."
            : "Nothing due today. Add prospects to keep the pipeline moving."}
      </p>
    );
  }

  return (
    <div>
      <ol className="divide-y divide-paper-mist border-y border-paper-mist">
        {items.map((item, index) => {
          const prospect = data.prospects.find((entry) => entry.id === item.prospectId);
          const owed = item.waitingId ? data.waiting.find((entry) => entry.id === item.waitingId) : undefined;
          const crmFollowUp = item.crmFollowUpId ? data.crm.followUps.find((entry) => entry.id === item.crmFollowUpId) : undefined;
          const inbound = item.inboundLeadId ? data.crm.inbound.find((entry) => entry.id === item.inboundLeadId) : undefined;
          // The newest unsettled message from this prospect, for a "They replied" item.
          const reply =
            item.kind === "reply"
              ? data.replies.filter((entry) => entry.prospectId === item.prospectId).sort((a, b) => b.messageDate.localeCompare(a.messageDate))[0]
              : undefined;
          const viewedClient = item.kind === "viewed" ? item.title.replace(/ opened their portal$/, "") : undefined;
          const viewedAsk = item.kind === "viewed" ? { kind: "draft" as const, prompt: portalViewPrompt(viewedClient as string, item.detail.slice(1)) } : undefined;
          const ask = viewedAsk ? viewedAsk : reply && prospect
            ? { kind: "draft" as const, prompt: prospectReplyPrompt(prospect, reply, { icp: data.icp, offers: data.offers }) }
            : inbound
            ? {
                kind: "draft" as const,
                prompt:
                  item.kind === "second_touch" ? secondTouchPrompt(inbound, magnetForSource(data.leadMagnets, inbound.source)) : inboundReplyPrompt(inbound),
              }
            : crmFollowUp
            ? { kind: "draft" as const, prompt: crmFollowUpPrompt(crmFollowUp) }
            : owed
            ? { kind: "draft" as const, prompt: waitingPrompt(owed, data.today, prospect) }
            : prospect
              ? hermesPrompt({ prospect, item, icp: data.icp, offers: data.offers, gaps: data.outreachGaps[prospect.id] ?? [] })
              : undefined;
          const pending = action.isPending && action.variables?.itemId === item.id;

          return (
            <li key={item.id} className="grid gap-3 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start">
              <span className="hidden font-paper-display text-[15px] font-bold text-paper-ash tabular-nums sm:block">{index + 1}.</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] leading-6 font-semibold text-paper-moss">{item.title}</h3>
                  <Tag tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Tag>
                </div>
                <p className="mt-0.5 text-[13px] leading-5 text-paper-sage">{item.detail.join(" · ")}</p>
                {reply ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {reply.moveTo && reply.moveFrom ? (
                      <PaperButton
                        variant="amber"
                        disabled={confirmReply.isPending || notTheirs.isPending}
                        onClick={() => confirmReply.mutate({ threadId: reply.threadId, prospectId: reply.prospectId, moveTo: reply.moveTo })}
                        aria-label={`Move ${prospect?.company ?? "them"} from ${stageLabel(reply.moveFrom)} to ${stageLabel(reply.moveTo)} and link this message`}
                      >
                        Move to {stageLabel(reply.moveTo).toLowerCase()}
                      </PaperButton>
                    ) : null}
                    <PaperButton
                      variant="ghost"
                      disabled={confirmReply.isPending || notTheirs.isPending}
                      onClick={() => notTheirs.mutate(reply.threadId)}
                      aria-label={`This message is not from ${prospect?.company ?? "them"}`}
                    >
                      Not theirs
                    </PaperButton>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <PaperButton
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    action.mutate(
                      { itemId: item.id, action: { action: "done" } },
                      {
                        // Starting a case study opens it: the draft is the next step, not a silent disappearance.
                        onSuccess: (result) => {
                          if (item.kind === "case_study" && result.caseStudy) {
                            navigate(`/traction?tab=case-studies&study=${encodeURIComponent(result.caseStudy.id)}`);
                          }
                        },
                      },
                    )
                  }
                  aria-label={
                    item.kind === "case_study"
                      ? item.title
                      : item.kind === "inbound"
                        ? `Replied: ${item.title}`
                        : item.kind === "second_touch"
                          ? `Sent: ${item.title}`
                          : item.kind === "reply"
                            ? `Answered: ${item.title}`
                            : `Done: ${item.title}`
                  }
                  title={
                    item.kind === "inbound"
                      ? "You replied: they become a prospect in conversation"
                      : item.kind === "second_touch"
                        ? "You sent it: they become a prospect you have contacted, and ordinary follow-ups take over"
                        : item.kind === "reply"
                          ? "You answered them: this clears until they write again"
                          : undefined
                  }
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  {item.kind === "case_study" ? "Start" : item.kind === "inbound" || item.kind === "reply" ? "Replied" : item.kind === "second_touch" ? "Sent" : "Done"}
                </PaperButton>
                <PaperButton
                  disabled={pending}
                  onClick={() => action.mutate({ itemId: item.id, action: { action: "snooze", days: 1 } })}
                  aria-label={`Snooze until tomorrow: ${item.title}`}
                >
                  <Clock className="size-3.5" aria-hidden="true" />
                  Snooze
                </PaperButton>
                <QueueLink to={queueItemHref(item)} label={`Open ${prospect?.company ?? owed?.who ?? crmFollowUp?.companyName ?? inbound?.name ?? viewedClient ?? "item"}`}>
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open
                </QueueLink>
                {ask ? (
                  <QueueLink
                    to={hermesHref(ask.prompt)}
                    label={`Ask Hermes to ${ask.kind === "research" ? "research" : "draft for"} ${prospect?.company ?? owed?.who ?? crmFollowUp?.companyName ?? inbound?.name ?? viewedClient ?? "this item"}`}
                    title={ask.kind === "research" ? "Not enough context to draft yet, so Hermes researches first" : "Hermes drafts; you review and send"}
                  >
                    {ask.kind === "research" ? <Search className="size-3.5" aria-hidden="true" /> : <PenLine className="size-3.5" aria-hidden="true" />}
                    {ask.kind === "research" ? "Research" : "Ask Hermes"}
                  </QueueLink>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {action.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {action.error.message}
        </p>
      ) : null}
      {/* Done here, but Virtec was not updated — the one outcome that needs a person. */}
      {action.data?.virtec && !action.data.virtec.ok ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          Recorded here, but Virtec was not updated: {action.data.virtec.error} Update it in Virtec by hand.
        </p>
      ) : null}
    </div>
  );
}

function QueueLink({ to, label, title, children }: { to: string; label: string; title?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={title}
      className={cn(
        "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
        PAPER_FOCUS,
      )}
    >
      {children}
    </Link>
  );
}

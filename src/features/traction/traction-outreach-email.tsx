import { ExternalLink, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Prospect } from "@shared/traction-types";
import { MAX_EMAIL_BODY } from "@shared/outreach-types";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperButton,
} from "@/components/paper";
import {
  useAddSuppression,
  useCreateGmailDraft,
  useDisconnectOutreach,
  useCheckReplies,
  useDraftOutreachEmail,
  useDraftReply,
  useProspectReplies,
  useOutreachStatus,
  useRemoveSuppression,
  useSaveOutreachSignature,
  useSendOutreachEmail,
  useSuppressions,
  type GmailDraftResult,
} from "@/lib/agentos/outreach";
import { cn } from "@/lib/utils";
import { formatShortDate } from "./traction-model";

/**
 * Writing to one prospect from the separate outreach mailbox.
 *
 * Hermes drafts, a person edits, and the result lands in the outreach
 * mailbox's Drafts. Sending is done in Gmail, by a person, one email at a
 * time. Nothing on this screen sends.
 */

const RETURN_MESSAGES: Record<string, string> = {
  connected: "Outreach mailbox connected.",
  "same-account":
    "That is your main inbox. Choose the separate outreach account.",
  scope:
    "Google did not grant everything needed. Try again and allow both permissions.",
};

export function ProspectEmailSection({ prospect }: { prospect: Prospect }) {
  const status = useOutreachStatus();
  const disconnect = useDisconnectOutreach();
  const [searchParams, setSearchParams] = useSearchParams();
  const returned = searchParams.get("outreach");

  useEffect(() => {
    if (!returned) return;
    const next = new URLSearchParams(searchParams);
    next.delete("outreach");
    setSearchParams(next, { replace: true });
  }, [returned, searchParams, setSearchParams]);

  const banner = returned
    ? (RETURN_MESSAGES[returned] ??
      `The outreach mailbox was not connected (${returned}).`)
    : undefined;

  return (
    <div
      className="mt-5 rounded-none border border-paper-linen px-3 py-3"
      aria-label="Email this prospect"
    >
      <p className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.06em] text-paper-char uppercase">
        <Mail className="size-3.5" aria-hidden="true" />
        Email from the outreach mailbox
      </p>
      {banner ? (
        <p role="status" className="mt-2 text-[13px] text-paper-char">
          {banner}
        </p>
      ) : null}

      {status.isPending ? (
        <p className="mt-2 text-[13px] text-paper-sage">
          Checking the outreach mailbox…
        </p>
      ) : null}
      {status.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {status.error.message}
        </p>
      ) : null}

      {status.data && !status.data.configured ? (
        <p className="mt-2 text-[13px] leading-5 text-paper-sage">
          Google sign-in is not set up in AgentOS yet, so a mailbox cannot be
          connected.
        </p>
      ) : null}

      {status.data?.configured && !status.data.connected ? (
        <div className="mt-2 text-[13px] leading-5 text-paper-char">
          <p>
            Connect the separate account you send outreach from. Choose it in
            Google&apos;s account list, not your main inbox.
          </p>
          <a
            href="/api/outreach/connect"
            className={cn(
              "mt-2 inline-flex min-h-8 items-center rounded-none border-[1.5px] border-paper-gold px-3 font-semibold text-paper-moss hover:bg-paper-white",
              PAPER_FOCUS,
            )}
          >
            Connect outreach mailbox
          </a>
        </div>
      ) : null}

      {status.data?.connected ? (
        <>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[13px] text-paper-char">
            Sending as{" "}
            <span className="font-semibold">{status.data.address}</span>
            <button
              type="button"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className={cn(
                "cursor-pointer rounded-[2px] text-paper-sage hover:text-paper-moss hover:underline",
                PAPER_FOCUS,
              )}
            >
              Disconnect
            </button>
          </p>
          <CheckReplies lastSyncAt={status.data.lastSyncAt} />
          <SignatureEditor
            key={status.data.signature}
            saved={status.data.signature}
          />
          <Composer
            prospect={prospect}
            signature={status.data.signature}
            sentToday={status.data.sentToday}
            dailyCap={status.data.dailyCap}
          />
        </>
      ) : null}
    </div>
  );
}

function SignatureEditor({ saved }: { saved: string }) {
  const save = useSaveOutreachSignature();
  const [value, setValue] = useState(saved);
  const changed = value.trim() !== saved.trim();

  return (
    <div className="mt-3">
      <label className="block">
        <FieldLabel>Signature and opt-out line</FieldLabel>
        <textarea
          rows={3}
          maxLength={600}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            'Your name, business and site.\nNot for you? Reply "no thanks" and I will not email you again.'
          }
          className={cn(PAPER_INPUT, "w-full")}
        />
      </label>
      <div className="mt-1 flex items-center gap-3">
        <PaperButton
          variant="ghost"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate(value)}
        >
          Save signature
        </PaperButton>
        {save.error ? (
          <span role="alert" className="text-[13px] text-paper-flame-deep">
            {save.error.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Composer({
  prospect,
  signature,
  sentToday,
  dailyCap,
}: {
  prospect: Prospect;
  signature: string;
  sentToday: number;
  dailyCap: number;
}) {
  const draft = useDraftOutreachEmail();
  const create = useCreateGmailDraft();
  const send = useSendOutreachEmail();
  const suppressions = useSuppressions();
  const addSuppression = useAddSuppression();
  const removeSuppression = useRemoveSuppression();
  const draftReply = useDraftReply();
  const replies = useProspectReplies(prospect.id);
  const [replyToId, setReplyToId] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const suppressed = prospect.email
    ? suppressions.data?.find(
        (entry) => entry.address === prospect.email?.toLowerCase(),
      )
    : undefined;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [created, setCreated] = useState<GmailDraftResult>();

  const blocker = suppressed
    ? `On the do-not-contact list (${suppressed.reason}). Nothing can be sent or drafted to this address.`
    : !prospect.email
      ? "Add this prospect's email address first."
      : !signature.trim()
        ? "Write your signature and opt-out line first."
        : prospect.stage === "won" || prospect.stage === "lost"
          ? "This prospect is closed."
          : undefined;
  const hasContent = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="mt-4">
      <p className="text-[13px] text-paper-char">
        To{" "}
        <span className="font-semibold">
          {prospect.email ?? "no email on file"}
        </span>
      </p>
      {blocker ? (
        <p className="mt-1 text-[13px] text-paper-sage">{blocker}</p>
      ) : null}

      {replies.data && replies.data.length > 0 ? (
        <div className="mt-3 space-y-2" aria-label="Replies from this prospect">
          {replies.data.slice(0, 3).map((reply) => (
            <div key={reply.id} className="rounded-none bg-paper-linen px-3 py-2 text-[13px] leading-5 text-paper-char">
              <p className="text-[12px] font-semibold tracking-[0.06em] uppercase">
                They wrote · {formatShortDate(reply.at)}
              </p>
              <p className="mt-1 font-semibold">{reply.subject}</p>
              {/* Their words, shown as text and never followed as instructions. */}
              <p className="mt-1 whitespace-pre-wrap">{reply.text}</p>
              <PaperButton
                variant="ghost"
                className="mt-2"
                disabled={Boolean(blocker) || draftReply.isPending}
                onClick={() =>
                  draftReply.mutate(
                    { prospectId: prospect.id, replyId: reply.id },
                    {
                      onSuccess: (result) => {
                        setSubject(result.subject);
                        setBody(result.body);
                        setReplyToId(reply.id);
                        setCreated(undefined);
                        setPreviewing(false);
                        setSentTo(undefined);
                        create.reset();
                        send.reset();
                      },
                    },
                  )
                }
              >
                {draftReply.isPending ? "Hermes is writing…" : "Draft a reply with Hermes"}
              </PaperButton>
            </div>
          ))}
          {draftReply.error ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {draftReply.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <PaperButton
          variant="amber"
          disabled={Boolean(blocker) || draft.isPending}
          onClick={() =>
            draft.mutate(prospect.id, {
              onSuccess: (result) => {
                setSubject(result.subject);
                setBody(result.body);
                setReplyToId(undefined);
                setCreated(undefined);
                setPreviewing(false);
                setSentTo(undefined);
                create.reset();
                send.reset();
              },
            })
          }
        >
          {draft.isPending
            ? "Hermes is writing…"
            : hasContent
              ? "Redraft with Hermes"
              : "Draft with Hermes"}
        </PaperButton>
      </div>
      {draft.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {draft.error.message}
        </p>
      ) : null}

      {prospect.email ? (
        <p className="mt-2 text-[12.5px] text-paper-sage">
          {suppressed ? (
            <button
              type="button"
              disabled={removeSuppression.isPending}
              onClick={() => removeSuppression.mutate(suppressed.address)}
              className={cn(
                "cursor-pointer rounded-[2px] hover:text-paper-moss hover:underline",
                PAPER_FOCUS,
              )}
            >
              Remove from do-not-contact list
            </button>
          ) : (
            <button
              type="button"
              disabled={addSuppression.isPending}
              onClick={() => {
                if (
                  window.confirm(`Never email ${prospect.email} from AgentOS?`)
                ) {
                  addSuppression.mutate({
                    address: prospect.email as string,
                    reason: "manual",
                  });
                }
              }}
              className={cn(
                "cursor-pointer rounded-[2px] hover:text-paper-moss hover:underline",
                PAPER_FOCUS,
              )}
            >
              Do not contact
            </button>
          )}
        </p>
      ) : null}

      {hasContent || subject || body ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            <FieldLabel>Subject</FieldLabel>
            <input
              maxLength={150}
              value={subject}
              onChange={(event) =>
                setSubject(event.target.value.replace(/[\r\n]/g, " "))
              }
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>
          <label className="block">
            <FieldLabel>Email</FieldLabel>
            <textarea
              rows={12}
              maxLength={MAX_EMAIL_BODY}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={cn(PAPER_INPUT, "w-full")}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <PaperButton
              variant="amber"
              disabled={Boolean(blocker) || !hasContent || create.isPending || Boolean(replyToId)}
              onClick={() =>
                create.mutate(
                  { prospectId: prospect.id, content: { subject, body } },
                  { onSuccess: (result) => setCreated(result) },
                )
              }
            >
              {create.isPending ? "Creating…" : "Create Gmail draft"}
            </PaperButton>
            <span className="text-[12.5px] text-paper-sage">
              {replyToId ? "A Gmail draft would not be in their thread, so a reply is sent from here." : "Or save it as a Gmail draft to send yourself."}
            </span>
          </div>
          {create.error ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {create.error.message}
            </p>
          ) : null}
          {previewing ? (
            <div
              role="group"
              aria-label="Preview before sending"
              className="rounded-none border-[1.5px] border-paper-gold bg-paper-white px-3 py-3 text-[13px] leading-5 text-paper-char"
            >
              <p className="text-[12px] font-semibold tracking-[0.06em] uppercase">
                Check before sending
              </p>
              <p className="mt-1">
                To <span className="font-semibold">{prospect.email}</span>
              </p>
              <p>
                Subject <span className="font-semibold">{subject}</span>
              </p>
              <pre className="mt-2 max-h-56 overflow-auto font-sans whitespace-pre-wrap">
                {body}
              </pre>
              <p className="mt-2 text-paper-sage">
                {replyToId ? "A reply in their thread, sent now" : "Sent now"} from the outreach mailbox, to this one address.{" "}
                {sentToday} of {dailyCap} sent in the last 24 hours. It cannot
                be recalled.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PaperButton
                  variant="amber"
                  disabled={send.isPending || !hasContent}
                  onClick={() =>
                    send.mutate(
                      { prospectId: prospect.id, content: { subject, body }, replyToId },
                      {
                        onSuccess: (result) => {
                          setSentTo(result.to);
                          setReplyToId(undefined);
                          setPreviewing(false);
                        },
                      },
                    )
                  }
                >
                  {send.isPending
                    ? "Sending…"
                    : `Send now to ${prospect.email}`}
                </PaperButton>
                <PaperButton
                  variant="ghost"
                  disabled={send.isPending}
                  onClick={() => setPreviewing(false)}
                >
                  Back to editing
                </PaperButton>
              </div>
            </div>
          ) : (
            <PaperButton
              disabled={Boolean(blocker) || !hasContent || send.isPending}
              onClick={() => setPreviewing(true)}
            >
              Preview and send
            </PaperButton>
          )}
          {send.error ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {send.error.message}
            </p>
          ) : null}
          {sentTo ? (
            <p
              role="status"
              className="text-[13px] font-semibold text-paper-moss"
            >
              Sent to {sentTo}. The prospect is now marked contacted.
            </p>
          ) : null}
          {created ? (
            <p role="status" className="text-[13px] text-paper-char">
              Draft saved in {created.address}.{" "}
              <a
                href={created.openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1 text-paper-blue hover:underline",
                  PAPER_FOCUS,
                )}
              >
                Open in Gmail
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CheckReplies({ lastSyncAt }: { lastSyncAt?: string }) {
  const check = useCheckReplies();
  const result = check.data;

  return (
    <div className="mt-2 text-[13px] text-paper-char">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <PaperButton variant="ghost" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Check for replies"}
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">
          {lastSyncAt ? `Last checked ${formatShortDate(lastSyncAt)}. Also checked every 15 minutes.` : "Not checked yet. Reading only: nothing is changed in Gmail."}
        </span>
      </div>
      {check.error ? (
        <p role="alert" className="mt-1 text-paper-flame-deep">
          {check.error.message}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="mt-1">
          {result.replies + result.stops + result.bounces + result.unverified === 0
            ? `Nothing new (${result.checked} checked).`
            : [
                result.replies > 0 ? `${result.replies} new ${result.replies === 1 ? "reply" : "replies"}` : undefined,
                result.stops > 0 ? `${result.stops} asked to stop (added to do-not-contact)` : undefined,
                result.bounces > 0 ? `${result.bounces} bounced (added to do-not-contact)` : undefined,
                result.unverified > 0 ? `${result.unverified} set aside: could not confirm the sender` : undefined,
              ]
                .filter(Boolean)
                .join(", ") + "."}
        </p>
      ) : null}
    </div>
  );
}

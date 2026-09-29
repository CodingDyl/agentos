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
  useCreateGmailDraft,
  useDisconnectOutreach,
  useDraftOutreachEmail,
  useOutreachStatus,
  useSaveOutreachSignature,
  type GmailDraftResult,
} from "@/lib/agentos/outreach";
import { cn } from "@/lib/utils";

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
      className="mt-5 rounded-[4px] border border-paper-linen px-3 py-3"
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
              "mt-2 inline-flex min-h-8 items-center rounded-[4px] border-[1.5px] border-paper-gold px-3 font-semibold text-paper-moss hover:bg-paper-white",
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
          <SignatureEditor key={status.data.signature} saved={status.data.signature} />
          <Composer prospect={prospect} signature={status.data.signature} />
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
}: {
  prospect: Prospect;
  signature: string;
}) {
  const draft = useDraftOutreachEmail();
  const create = useCreateGmailDraft();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [created, setCreated] = useState<GmailDraftResult>();

  const blocker = !prospect.email
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

      <div className="mt-2 flex flex-wrap gap-2">
        <PaperButton
          variant="amber"
          disabled={Boolean(blocker) || draft.isPending}
          onClick={() =>
            draft.mutate(prospect.id, {
              onSuccess: (result) => {
                setSubject(result.subject);
                setBody(result.body);
                setCreated(undefined);
                create.reset();
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
              disabled={Boolean(blocker) || !hasContent || create.isPending}
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
              Nothing is sent. You review and send it in Gmail.
            </span>
          </div>
          {create.error ? (
            <p role="alert" className="text-[13px] text-paper-flame-deep">
              {create.error.message}
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

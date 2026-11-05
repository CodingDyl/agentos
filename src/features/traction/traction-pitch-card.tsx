import { Camera, Check, ExternalLink, FileText, Mail, Wand2 } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PATH_PLAY, type OutreachCase, type Sender } from "@shared/outreach-case";
import type { PitchPack, PitchShot } from "@shared/pitch-types";
import type { Prospect } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, Tag } from "@/components/paper";
import { formatRand } from "@/features/business/business-model";
import { useRecordManualSend } from "@/lib/agentos/outreach";
import { useSenders, useWriteCase } from "@/lib/agentos/outreach-cases";
import { useCapturePitchShots, useCreatePitchQuote, useDraftPitch, usePitch } from "@/lib/agentos/pitch";
import { useUpdateProspect } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { SenderManager } from "./traction-outreach-senders";
import { planPitchDraft, writeEmailAnchor, type PitchDraftPlan } from "./traction-pitch-model";

/**
 * Pitch ready: a "build it first" prospect whose rebuild has a live preview,
 * with what is needed to sell it: the before and after, two or three
 * findings and what the leak costs, the preview link, the prices, and the
 * three actions (draft the email, make the quote, mark it sent).
 *
 * What the draft still needs (the company above all) is asked for right here,
 * before you press anything, and pressing draft saves it and carries on.
 *
 * Nothing here sends. The draft lands in "Write the email" below for you to
 * read and send through the usual mail flow.
 */
export function PitchReadyCard({ prospect, entry }: { prospect: Prospect; entry: OutreachCase }) {
  const pitch = usePitch(prospect.id, entry.path === "build_first");
  if (entry.path !== "build_first" || !pitch.data || (pitch.data.status !== "ready" && pitch.data.status !== "pitched")) return null;
  return <PitchPackView prospect={prospect} entry={entry} pack={pitch.data} />;
}

const rand = (minor: number | undefined) => (minor === undefined ? undefined : formatRand(minor / 100));

export function PitchPackView({ prospect, entry, pack }: { prospect: Prospect; entry: OutreachCase; pack: PitchPack }) {
  const shots = useCapturePitchShots();
  const draft = useDraftPitch();
  const manual = useRecordManualSend();
  const write = useWriteCase();
  const senders = useSenders();
  const [chosenSenderId, setChosenSenderId] = useState<string>();
  const [hook, setHook] = useState("");
  const [offer, setOffer] = useState(entry.framing[0] ?? "");
  const [addingCompany, setAddingCompany] = useState(false);
  // You pressed draft before everything was there: the draft starts as soon as the company is chosen.
  const [waitingToDraft, setWaitingToDraft] = useState(false);
  const senderRef = useRef<HTMLSelectElement>(null);
  const hookRef = useRef<HTMLInputElement>(null);
  const offerRef = useRef<HTMLInputElement>(null);

  const pitched = pack.status === "pitched";
  const previewUrl = pack.rebuild?.previewUrl;
  const closed = prospect.stage === "won" || prospect.stage === "lost";
  const companies = senders.data ?? [];
  const planWith = (senderId: string | undefined, list: readonly Sender[] = companies) =>
    planPitchDraft({ entry, senders: list, previewUrl, findings: pack.findings, quoteCompany: pack.quote?.entityName, chosenSenderId: senderId, hook, offer });
  const plan = planWith(chosenSenderId);
  const busy = write.isPending || draft.isPending;
  const hasEmail = Boolean(entry.draft?.subject.trim() && entry.draft?.body.trim());
  const quoteElsewhere = pack.quote && plan.sender && pack.quote.entityName.trim().toLowerCase() !== plan.sender.company.trim().toLowerCase() ? pack.quote.entityName : undefined;

  const startDraft = async (next: PitchDraftPlan) => {
    setWaitingToDraft(false);
    try {
      if (Object.keys(next.patch).length > 0) await write.mutateAsync({ prospectId: prospect.id, patch: next.patch });
      await draft.mutateAsync(prospect.id);
    } catch {
      // Both hooks hold the error, and the card shows it.
    }
  };

  const pressDraft = () => {
    if (plan.ready) {
      void startDraft(plan);
      return;
    }
    setWaitingToDraft(true);
    if (plan.needsSender && companies.length === 0) setAddingCompany(true);
    else if (plan.needsSender) senderRef.current?.focus();
    else if (plan.gaps.length > 0 && plan.asksHook && !hook.trim()) hookRef.current?.focus();
    else offerRef.current?.focus();
  };

  const chooseSender = (senderId: string, list: readonly Sender[] = companies) => {
    setChosenSenderId(senderId);
    const next = planWith(senderId, list);
    if (waitingToDraft && next.ready) void startDraft(next);
    else write.mutate({ prospectId: prospect.id, patch: { senderId } });
  };

  return (
    <PaperCard className="border-paper-ash p-5" aria-labelledby={`pitch-${prospect.id}`} data-testid="pitch-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`pitch-${prospect.id}`} className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.01em] text-paper-moss">
          {pitched ? "Pitched with preview" : "Pitch ready"}
          <Tag tone={pitched ? "muted" : "green"}>{pitched ? `Sent ${new Date(pack.pitchedAt ?? "").toLocaleDateString("en-ZA")}` : "Preview live"}</Tag>
        </h3>
        {previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-[13px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
            Open the preview <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Shot label="Their site now" shot={pack.before} />
        <Shot label="The new site" shot={pack.after} />
      </div>
      {!pack.before || !pack.after ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PaperButton variant="ghost" disabled={shots.isPending} onClick={() => shots.mutate(prospect.id)}>
            <Camera className="size-3.5" aria-hidden="true" /> {shots.isPending ? "Taking screenshots…" : "Take the missing screenshots"}
          </PaperButton>
          {shots.error ? (
            <span role="alert" className="text-[13px] text-paper-flame-deep">
              {shots.error.message}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <section aria-label="What we found">
          <FieldLabel>What we found</FieldLabel>
          {pack.findings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-[14px] leading-5 text-paper-char">
              {pack.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-paper-sage">Nothing specific yet. Brief the case in “Get to know them” first.</p>
          )}
          {pack.leak ? <p className="mt-2 text-[14px] leading-5 font-semibold text-paper-flame-deep">{pack.leak}</p> : null}
        </section>
        <PricesAndQuote prospect={prospect} pack={pack} />
      </div>

      <div className="mt-5 space-y-4 border-t border-paper-mist pt-4">
        {!closed && (!pitched || !plan.ready) ? (
          <section aria-label="What the pitch email needs" className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              {companies.length > 0 ? (
                <label className="block min-w-[240px] max-w-sm">
                  <FieldLabel>
                    Send as
                    {plan.needsSender ? (
                      <Tag tone="marigold" className="ml-2 align-middle">
                        Needed first
                      </Tag>
                    ) : null}
                  </FieldLabel>
                  <select ref={senderRef} value={plan.sender?.id ?? ""} disabled={busy} onChange={(event) => chooseSender(event.target.value)} className={cn(PAPER_INPUT, "w-full")}>
                    {!plan.sender ? <option value="">Choose a company…</option> : null}
                    {companies.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.company} ({candidate.fromName})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!senders.isPending ? (
                <PaperButton variant="quiet" aria-expanded={addingCompany} onClick={() => setAddingCompany((open) => !open)}>
                  {addingCompany ? "Close" : companies.length === 0 ? "Add the company it is from" : "Add a company"}
                </PaperButton>
              ) : null}
            </div>
            {plan.needsSender && !senders.isPending ? (
              <p className="max-w-[72ch] text-[13px] leading-5 text-paper-char">
                {waitingToDraft ? (companies.length === 0 ? "Add the company and the draft starts." : "Choose the company and the draft starts.") : companies.length === 0 ? "The email needs a company to come from, for its name and signature. You have none yet." : "Choose which company this email is from. It sets the name and the signature."}
                {pack.quote && companies.length > 0 ? ` The quote is in ${pack.quote.entityName}, which is not one of these companies.` : ""}
              </p>
            ) : null}
            {quoteElsewhere ? <p className="max-w-[72ch] text-[13px] leading-5 text-paper-char">The quote is in {quoteElsewhere}, and this email would come from {plan.sender?.company}. Check that is what you want.</p> : null}
            {senders.error ? (
              <p role="alert" className="text-[13px] text-paper-flame-deep">
                Your companies could not be loaded: {senders.error.message}
              </p>
            ) : null}
            {addingCompany ? (
              <SenderManager
                onAdded={(added) => {
                  setAddingCompany(false);
                  chooseSender(added.id, [...companies, added]);
                }}
              />
            ) : null}
            {plan.asksHook ? (
              <label className="block max-w-[72ch]">
                <FieldLabel>
                  An opening line or something you noticed
                  <Tag tone="marigold" className="ml-2 align-middle">
                    Needed first
                  </Tag>
                </FieldLabel>
                <input ref={hookRef} value={hook} disabled={busy} onChange={(event) => setHook(event.target.value)} placeholder="e.g. No way to book a call-out on a phone." className={cn(PAPER_INPUT, "w-full")} />
              </label>
            ) : null}
            {plan.asksOffer ? (
              <label className="block max-w-[72ch]">
                <FieldLabel>
                  The offer
                  <Tag tone="marigold" className="ml-2 align-middle">
                    Needed first
                  </Tag>
                </FieldLabel>
                <input ref={offerRef} value={offer} disabled={busy} onChange={(event) => setOffer(event.target.value)} placeholder="e.g. A new site with a booking button, ready to look at now." className={cn(PAPER_INPUT, "w-full")} />
              </label>
            ) : null}
            {!prospect.email ? <TheirEmail key={prospect.id} prospect={prospect} /> : null}
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={busy || closed || senders.isPending} onClick={pressDraft}>
            <Wand2 className="size-3.5" aria-hidden="true" /> {draft.isPending ? "Drafting…" : write.isPending ? "Saving…" : pack.draftReady ? "Redraft the pitch" : "Draft the pitch email"}
          </PaperButton>
          <PaperButton
            variant="ghost"
            disabled={!hasEmail || manual.isPending || pitched || closed}
            onClick={() => entry.draft && manual.mutate({ prospectId: prospect.id, content: { subject: entry.draft.subject, body: entry.draft.body }, play: PATH_PLAY.build_first })}
          >
            <Check className="size-3.5" aria-hidden="true" /> {pitched ? "Pitch sent" : manual.isPending ? "Saving…" : "Mark pitch sent"}
          </PaperButton>
          <span className="max-w-[72ch] basis-full text-[13px] leading-5 text-paper-sage">
            {closed ? (
              <>
                This prospect is {prospect.stage}, so the pitch is locked. Change its stage in{" "}
                <Link to={`/traction?tab=prospects&prospect=${encodeURIComponent(prospect.id)}`} className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
                  Prospects
                </Link>{" "}
                to reopen it.
              </>
            ) : draft.isSuccess ? (
              <>
                Draft saved in <WriteEmailLink prospectId={prospect.id} /> below. Read it, then send it there. Nothing has been sent.
              </>
            ) : pitched ? (
              "Follow-ups and reply checks now track this prospect."
            ) : hasEmail ? (
              <>
                Nothing is sent from here. Read it and send it from <WriteEmailLink prospectId={prospect.id} /> below, or mark it sent if you sent it yourself.
              </>
            ) : (
              <>
                Drafts only: nothing is sent from here. Mark pitch sent opens once there is an email to record, so draft one, or put what you already sent in <WriteEmailLink prospectId={prospect.id} /> below.
              </>
            )}
          </span>
        </div>
      </div>
      {write.error || draft.error || manual.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {(write.error ?? draft.error ?? manual.error)?.message}
        </p>
      ) : null}
    </PaperCard>
  );
}

/** Takes you to the "Write the email" card, the place the draft lands and goes out from. */
function WriteEmailLink({ prospectId }: { prospectId: string }) {
  return (
    <button
      type="button"
      className={cn("cursor-pointer text-paper-blue hover:underline", PAPER_FOCUS)}
      onClick={() => {
        const target = document.getElementById(writeEmailAnchor(prospectId));
        if (!target) return;
        const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
        target.focus({ preventScroll: true });
      }}
    >
      “Write the email”
    </button>
  );
}

/** Not needed to draft, but the email cannot go out without it, so it is asked for here rather than at the send button. */
function TheirEmail({ prospect }: { prospect: Prospect }) {
  const update = useUpdateProspect();
  const [value, setValue] = useState("");
  return (
    <label className="block max-w-sm">
      <FieldLabel>Their email address</FieldLabel>
      <input
        type="email"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim()) update.mutate({ prospectId: prospect.id, patch: { email: value.trim() } });
        }}
        className={cn(PAPER_INPUT, "w-full")}
      />
      <span className="mt-0.5 block text-[13px] text-paper-sage">You can draft without it, but it cannot be sent from AgentOS until it is here.</span>
      {update.error ? (
        <span role="alert" className="mt-0.5 block text-[13px] text-paper-flame-deep">
          {update.error.message}
        </span>
      ) : null}
    </label>
  );
}

function Shot({ label, shot }: { label: string; shot: PitchShot | undefined }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 text-[13px] font-medium text-paper-char">{label}</figcaption>
      {shot ? (
        <img src={shot.src} alt={`${label}: ${shot.title}`} loading="lazy" className="aspect-[16/10] w-full border border-paper-mist object-cover object-top" />
      ) : (
        <div className="flex aspect-[16/10] w-full items-center justify-center border border-dashed border-paper-mist text-[13px] text-paper-sage">No screenshot yet</div>
      )}
    </figure>
  );
}

function PricesAndQuote({ prospect, pack }: { prospect: Prospect; pack: PitchPack }) {
  const formId = useId();
  const quote = useCreatePitchQuote();
  const priced = pack.prices.monthlyMinor !== undefined || pack.prices.setupMinor !== undefined;
  const [asking, setAsking] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const setupPrice = String(form.get("setupPrice") ?? "").trim();
    const monthlyPrice = String(form.get("monthlyPrice") ?? "").trim();
    quote.mutate({ prospectId: prospect.id, input: { setupPrice, monthlyPrice } }, { onSuccess: () => setAsking(false) });
  };

  const existing = quote.data?.quote ?? pack.quote;

  return (
    <section aria-label="Prices and quote">
      <FieldLabel>Prices</FieldLabel>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[14px] leading-5">
        <dt className="text-paper-sage">Set-up</dt>
        <dd className="text-paper-char">{pack.prices.setup || "None: no upfront cost"}</dd>
        <dt className="text-paper-sage">Monthly</dt>
        <dd className="text-paper-char">{pack.prices.monthly || "Not set"}</dd>
      </dl>

      {existing ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-paper-char">
          <FileText className="size-3.5 text-paper-blue" aria-hidden="true" />
          Quote {existing.number ?? "draft"} in {existing.entityName}
          {existing.amountMinor !== undefined ? ` · ${rand(existing.amountMinor)}` : ""}
          {existing.status ? <Tag tone="muted">{existing.status}</Tag> : null}
          <Link to={`/business?tab=quotes&entity=${encodeURIComponent(existing.entityId)}`} className={cn("font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
            Open in Business
          </Link>
        </p>
      ) : asking || !priced ? (
        <form key={`${pack.prices.defaultSetup}\u0000${pack.prices.defaultMonthly}`} aria-labelledby={`${formId}-title`} className="mt-3 space-y-2" onSubmit={submit}>
          <p id={`${formId}-title`} className="text-[13px] text-paper-sage">
            {priced ? "Change the prices for the quote." : "Set the prices for the quote. Filled from your company's defaults."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Set-up fee</FieldLabel>
              <input name="setupPrice" className={cn(PAPER_INPUT, "w-full")} defaultValue={pack.prices.setup || pack.prices.defaultSetup} placeholder="e.g. R2 500, or empty" />
            </label>
            <label className="block">
              <FieldLabel>Monthly price</FieldLabel>
              <input name="monthlyPrice" className={cn(PAPER_INPUT, "w-full")} defaultValue={pack.prices.monthly || pack.prices.defaultMonthly} placeholder="e.g. R450 a month" />
            </label>
          </div>
          <PaperButton type="submit" variant="amber" disabled={quote.isPending}>
            <FileText className="size-3.5" aria-hidden="true" /> {quote.isPending ? "Creating…" : "Save prices and create quote"}
          </PaperButton>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PaperButton variant="amber" disabled={quote.isPending} onClick={() => quote.mutate({ prospectId: prospect.id, input: {} })}>
            <FileText className="size-3.5" aria-hidden="true" /> {quote.isPending ? "Creating…" : "Create quote"}
          </PaperButton>
          <span className="text-[13px] text-paper-sage">
            {[pack.prices.setupMinor ? `${rand(pack.prices.setupMinor)} set-up` : undefined, pack.prices.monthlyMinor ? `${rand(pack.prices.monthlyMinor)} first month` : undefined].filter(Boolean).join(" + ")}
          </span>
          <button type="button" className={cn("text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)} onClick={() => setAsking(true)}>
            Change prices
          </button>
        </div>
      )}
      {quote.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {quote.error.message}
        </p>
      ) : null}
      {!existing ? <p className="mt-2 flex items-center gap-1 text-[13px] text-paper-sage"><Mail className="size-3" aria-hidden="true" /> A draft in Business: nothing is issued or sent.</p> : null}
    </section>
  );
}


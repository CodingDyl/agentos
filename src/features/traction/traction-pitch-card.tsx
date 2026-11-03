import { Camera, Check, ExternalLink, FileText, Mail, Wand2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PATH_PLAY, type OutreachCase } from "@shared/outreach-case";
import type { PitchPack, PitchShot } from "@shared/pitch-types";
import type { Prospect } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, Tag } from "@/components/paper";
import { formatRand } from "@/features/business/business-model";
import { useRecordManualSend } from "@/lib/agentos/outreach";
import { useCapturePitchShots, useCreatePitchQuote, useDraftPitch, usePitch } from "@/lib/agentos/pitch";
import { cn } from "@/lib/utils";

/**
 * Pitch ready: a "build it first" prospect whose rebuild has a live preview,
 * with what is needed to sell it: the before and after, two or three
 * findings and what the leak costs, the preview link, the prices, and the
 * three actions (draft the email, make the quote, mark it sent).
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
  const pitched = pack.status === "pitched";
  const previewUrl = pack.rebuild?.previewUrl;
  const closed = prospect.stage === "won" || prospect.stage === "lost";

  return (
    <PaperCard className="border-paper-blue p-5" aria-labelledby={`pitch-${prospect.id}`} data-testid="pitch-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`pitch-${prospect.id}`} className="flex items-center gap-2.5 font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">
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
            <ul className="list-disc space-y-1 pl-5 text-[13.5px] leading-5 text-paper-char">
              {pack.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-paper-sage">Nothing specific yet. Brief the case in “Get to know them” first.</p>
          )}
          {pack.leak ? <p className="mt-2 text-[13.5px] leading-5 font-semibold text-paper-flame-deep">{pack.leak}</p> : null}
        </section>
        <PricesAndQuote prospect={prospect} pack={pack} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-paper-mist pt-4">
        <PaperButton variant="amber" disabled={draft.isPending || closed} onClick={() => draft.mutate(prospect.id)}>
          <Wand2 className="size-3.5" aria-hidden="true" /> {draft.isPending ? "Drafting…" : pack.draftReady ? "Redraft the pitch" : "Draft the pitch email"}
        </PaperButton>
        <PaperButton
          variant="ghost"
          disabled={!entry.draft?.body.trim() || manual.isPending || pitched || closed}
          onClick={() => entry.draft && manual.mutate({ prospectId: prospect.id, content: { subject: entry.draft.subject, body: entry.draft.body }, play: PATH_PLAY.build_first })}
        >
          <Check className="size-3.5" aria-hidden="true" /> {pitched ? "Pitch sent" : manual.isPending ? "Saving…" : "Mark pitch sent"}
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">
          {draft.isSuccess
            ? "Draft saved in “Write the email” below. Read it, then send it there."
            : pitched
              ? "Follow-ups and reply checks now track this prospect."
              : "Drafts only. You read and send it from “Write the email” below, or mark it sent if you sent it yourself."}
        </span>
      </div>
      {draft.error || manual.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {(draft.error ?? manual.error)?.message}
        </p>
      ) : null}
    </PaperCard>
  );
}

function Shot({ label, shot }: { label: string; shot: PitchShot | undefined }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 text-[12.5px] font-medium text-paper-char">{label}</figcaption>
      {shot ? (
        <img src={shot.src} alt={`${label}: ${shot.title}`} loading="lazy" className="aspect-[16/10] w-full border border-paper-mist object-cover object-top" />
      ) : (
        <div className="flex aspect-[16/10] w-full items-center justify-center border border-dashed border-paper-mist text-[12.5px] text-paper-sage">No screenshot yet</div>
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
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13.5px] leading-5">
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
        <form aria-labelledby={`${formId}-title`} className="mt-3 space-y-2" onSubmit={submit}>
          <p id={`${formId}-title`} className="text-[12.5px] text-paper-sage">
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
          <span className="text-[12.5px] text-paper-sage">
            {[pack.prices.setupMinor ? `${rand(pack.prices.setupMinor)} set-up` : undefined, pack.prices.monthlyMinor ? `${rand(pack.prices.monthlyMinor)} first month` : undefined].filter(Boolean).join(" + ")}
          </span>
          <button type="button" className={cn("text-[12.5px] text-paper-blue hover:underline", PAPER_FOCUS)} onClick={() => setAsking(true)}>
            Change prices
          </button>
        </div>
      )}
      {quote.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {quote.error.message}
        </p>
      ) : null}
      {!existing ? <p className="mt-2 flex items-center gap-1 text-[12px] text-paper-sage"><Mail className="size-3" aria-hidden="true" /> A draft in Business: nothing is issued or sent.</p> : null}
    </section>
  );
}


import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Offer, TractionData } from "@shared/traction-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useDeleteOffer, useSaveOffer } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { optional, toList } from "./traction-model";

/**
 * The offer library: what Virtara actually sells.
 *
 * Outreach stalls on "what am I offering this one?" — so the answer is
 * decided once, here, and every prospect picks from it. Hermes pitches only
 * what is on this list.
 */

const STARTER_OFFERS = ["Real estate website", "AI workflow audit", "Website redesign", "3D product configurator", "SEO retainer", "Monthly content package"];

export function TractionOffersTab({ data }: { data: TractionData }) {
  const [editing, setEditing] = useState<string | "new" | undefined>(data.offers.length === 0 ? "new" : undefined);
  const remove = useDeleteOffer();

  const pitchedBy = (offerId: string) => data.prospects.filter((prospect) => prospect.offerId === offerId).length;

  return (
    <PaperSection
      label="Offers"
      count={data.offers.length}
      action={
        editing === "new" ? null : (
          <PaperButton variant="amber" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add offer
          </PaperButton>
        )
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {editing === "new" ? (
          <PaperCard className="p-5">
            <OfferForm onDone={() => setEditing(undefined)} canCancel={data.offers.length > 0} />
          </PaperCard>
        ) : null}

        {data.offers.map((offer) =>
          editing === offer.id ? (
            <PaperCard key={offer.id} className="p-5">
              <OfferForm offer={offer} onDone={() => setEditing(undefined)} canCancel />
            </PaperCard>
          ) : (
            <PaperCard key={offer.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss uppercase">{offer.name}</h3>
                {offer.startingPrice ? <Tag tone="muted">From {offer.startingPrice}</Tag> : null}
              </div>
              <dl className="mt-3 space-y-2.5 text-[14px] leading-6">
                {offer.target ? <Row label="Target">{offer.target}</Row> : null}
                {offer.problem ? <Row label="Problem">{offer.problem}</Row> : null}
                <Row label="Offer">{offer.offer}</Row>
                {offer.upsells.length > 0 ? <Row label="Upsell">{offer.upsells.join(" · ")}</Row> : null}
              </dl>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-paper-sage">
                  {pitchedBy(offer.id)} {pitchedBy(offer.id) === 1 ? "prospect" : "prospects"}
                </span>
                <span className="flex gap-1.5">
                  <PaperButton variant="ghost" onClick={() => setEditing(offer.id)}>
                    Edit
                  </PaperButton>
                  <PaperButton
                    aria-label={`Remove ${offer.name}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove “${offer.name}”? Prospects pitching it will have no offer chosen.`)) remove.mutate(offer.id);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </PaperButton>
                </span>
              </div>
            </PaperCard>
          ),
        )}
      </div>
      {remove.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {remove.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-[12px] leading-6 font-semibold tracking-[0.06em] text-paper-sage uppercase">{label}</dt>
      <dd className="text-paper-moss">{children}</dd>
    </div>
  );
}

function OfferForm({ offer, onDone, canCancel }: { offer?: Offer; onDone: () => void; canCancel: boolean }) {
  const [name, setName] = useState(offer?.name ?? "");
  const [target, setTarget] = useState(offer?.target ?? "");
  const [problem, setProblem] = useState(offer?.problem ?? "");
  const [pitch, setPitch] = useState(offer?.offer ?? "");
  const [price, setPrice] = useState(offer?.startingPrice ?? "");
  const [upsells, setUpsells] = useState(offer?.upsells.join("\n") ?? "");
  const save = useSaveOffer();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            offerId: offer?.id,
            input: {
              name: name.trim(),
              target: optional(target),
              problem: optional(problem),
              offer: pitch.trim(),
              startingPrice: optional(price),
              upsells: toList(upsells),
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input required maxLength={120} list="starter-offers" className={cn(PAPER_INPUT, "w-full")} value={name} onChange={(event) => setName(event.target.value)} />
        <datalist id="starter-offers">
          {STARTER_OFFERS.map((starter) => (
            <option key={starter} value={starter} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <FieldLabel>Target</FieldLabel>
        <input maxLength={200} placeholder="Independent estate agencies" className={cn(PAPER_INPUT, "w-full")} value={target} onChange={(event) => setTarget(event.target.value)} />
      </label>
      <label className="block">
        <FieldLabel>Problem</FieldLabel>
        <textarea maxLength={500} rows={2} placeholder="Outdated websites that don't convert traffic." className={cn(PAPER_INPUT, "w-full py-2")} value={problem} onChange={(event) => setProblem(event.target.value)} />
      </label>
      <label className="block">
        <FieldLabel>Offer</FieldLabel>
        <textarea required maxLength={500} rows={2} placeholder="Modern conversion-focused website." className={cn(PAPER_INPUT, "w-full py-2")} value={pitch} onChange={(event) => setPitch(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="block">
          <FieldLabel>Starting price</FieldLabel>
          <input maxLength={60} placeholder="R45,000" className={cn(PAPER_INPUT, "w-full")} value={price} onChange={(event) => setPrice(event.target.value)} />
        </label>
        <label className="block">
          <FieldLabel>Upsells (one per line)</FieldLabel>
          <textarea rows={3} placeholder={"SEO\nContent\nHosting\nMaintenance"} className={cn(PAPER_INPUT, "w-full py-2")} value={upsells} onChange={(event) => setUpsells(event.target.value)} />
        </label>
      </div>
      <div className="flex gap-2 pt-1">
        <PaperButton type="submit" variant="amber" disabled={save.isPending}>
          {save.isPending ? "Saving…" : offer ? "Save offer" : "Add offer"}
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

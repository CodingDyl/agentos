import { useState } from "react";
import type { Icp } from "@shared/traction-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { useSaveIcp } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { optional, SUGGESTED_ICP, toList } from "./traction-model";

/**
 * The active ICP — one, on purpose.
 *
 * Everything else in Traction works against it: the queue's warnings, the
 * outreach guard, what Hermes is told it can pitch. With none set, the card
 * says so and offers the Step 60 starting point rather than a blank form.
 */
export function TractionIcpCard({ icp }: { icp: Icp | undefined }) {
  const [editing, setEditing] = useState(false);

  return (
    <PaperSection
      label="Active ICP"
      action={icp && !editing ? <PaperButton onClick={() => setEditing(true)}>Edit ICP</PaperButton> : null}
    >
      {editing || !icp ? (
        <IcpForm icp={icp} onDone={() => setEditing(false)} />
      ) : (
        <PaperCard>
          <p className="font-paper-display text-[18px] font-bold text-paper-moss">{icp.name}</p>
          <dl className="mt-3 space-y-3 text-[14px] leading-6">
            <div>
              <dt className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">Offer</dt>
              <dd className="text-paper-moss">{icp.offer}</dd>
            </div>
            {icp.geography ? (
              <div>
                <dt className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">Geography</dt>
                <dd className="text-paper-moss">{icp.geography}</dd>
              </div>
            ) : null}
            {icp.idealProspect.length > 0 ? (
              <div>
                <dt className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">Ideal prospect</dt>
                <dd>
                  <ul className="list-disc pl-5 text-paper-moss">
                    {icp.idealProspect.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        </PaperCard>
      )}
    </PaperSection>
  );
}

function IcpForm({ icp, onDone }: { icp: Icp | undefined; onDone: () => void }) {
  const [name, setName] = useState(icp?.name ?? "");
  const [offer, setOffer] = useState(icp?.offer ?? "");
  const [geography, setGeography] = useState(icp?.geography ?? "");
  const [ideal, setIdeal] = useState(icp?.idealProspect.join("\n") ?? "");
  const save = useSaveIcp();

  const applySuggested = () => {
    setName(SUGGESTED_ICP.name);
    setOffer(SUGGESTED_ICP.offer);
    setGeography(SUGGESTED_ICP.geography);
    setIdeal(SUGGESTED_ICP.idealProspect.join("\n"));
  };

  return (
    <PaperCard>
      {!icp ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[4px] bg-paper-linen px-3 py-2.5">
          <p className="text-[13.5px] leading-5 text-paper-char">One vertical at a time. No ICP means prospecting drifts.</p>
          <PaperButton variant="ghost" onClick={applySuggested}>
            Start from estate agencies
          </PaperButton>
        </div>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { name: name.trim(), offer: offer.trim(), geography: optional(geography), idealProspect: toList(ideal) },
            { onSuccess: onDone },
          );
        }}
      >
        <label className="block">
          <FieldLabel>Who</FieldLabel>
          <input required maxLength={120} className={cn(PAPER_INPUT, "w-full")} value={name} onChange={(event) => setName(event.target.value)} placeholder="Real estate agencies" />
        </label>
        <label className="block">
          <FieldLabel>Offer</FieldLabel>
          <textarea required maxLength={400} rows={2} className={cn(PAPER_INPUT, "w-full py-2")} value={offer} onChange={(event) => setOffer(event.target.value)} />
        </label>
        <label className="block">
          <FieldLabel>Geography</FieldLabel>
          <input maxLength={120} className={cn(PAPER_INPUT, "w-full")} value={geography} onChange={(event) => setGeography(event.target.value)} />
        </label>
        <label className="block">
          <FieldLabel>Ideal prospect (one trait per line)</FieldLabel>
          <textarea rows={4} className={cn(PAPER_INPUT, "w-full py-2")} value={ideal} onChange={(event) => setIdeal(event.target.value)} />
        </label>
        <div className="flex gap-2 pt-1">
          <PaperButton type="submit" variant="amber" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save ICP"}
          </PaperButton>
          {icp ? <PaperButton onClick={onDone}>Cancel</PaperButton> : null}
        </div>
        {save.error ? <p role="alert" className="text-[13px] text-paper-flame-deep">{save.error.message}</p> : null}
      </form>
    </PaperCard>
  );
}

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { addDays } from "@shared/traction-dates";
import { SOURCE_LABELS, type TractionData, type WeeklyReview } from "@shared/traction-types";
import { PAPER_FOCUS, PaperCard, PaperSection, SegmentedControl } from "@/components/paper";
import { cn } from "@/lib/utils";
import { formatShortDate, hermesHref, percent, reviewPrompt } from "./traction-model";

/**
 * The Friday review.
 *
 * Every number here is counted from the record — none is estimated, and none
 * comes from a model. Hermes is one click away to interpret them, and is told
 * explicitly not to recalculate.
 */

type Which = "thisWeek" | "lastWeek";

const ROWS: readonly { key: keyof WeeklyReview["week"]; label: string; target?: keyof TractionData["targets"] }[] = [
  { key: "newProspects", label: "New prospects", target: "newProspects" },
  { key: "outreach", label: "Personal outreach", target: "outreach" },
  { key: "followUps", label: "Follow-ups", target: "followUps" },
  { key: "conversations", label: "Conversations started", target: "conversations" },
  { key: "proposals", label: "Proposals", target: "proposals" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "referralsAsked", label: "Referrals asked" },
];

export function TractionReviewTab({ data }: { data: TractionData }) {
  const [which, setWhich] = useState<Which>("thisWeek");
  const review = data.reviews[which];
  const week = review.week;
  const best = review.sources.find((source) => source.source === review.bestSource);

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<Which>
          label="Week"
          value={which}
          onChange={setWhich}
          options={[
            { value: "thisWeek", label: "This week" },
            { value: "lastWeek", label: "Last week" },
          ]}
        />
        <Link
          to={hermesHref(reviewPrompt(review, data.targets))}
          className={cn(
            "inline-flex min-h-8 items-center gap-1.5 rounded-[4px] border-[1.5px] border-paper-gold px-3 text-[13.5px] font-semibold text-paper-moss hover:bg-paper-linen",
            PAPER_FOCUS,
          )}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Ask Hermes to interpret
        </Link>
      </div>

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <PaperSection label={`Week of ${formatShortDate(week.weekOf)} – ${formatShortDate(addDays(week.weekOf, 6))}`}>
          <table className="w-full border-collapse text-[14px]">
            <caption className="sr-only">This week's traction figures against the weekly targets</caption>
            <tbody>
              {ROWS.map((row) => {
                const value = week[row.key] as number;
                const target = row.target ? data.targets[row.target] : undefined;
                return (
                  <tr key={row.key} className="border-b border-paper-stone">
                    <th scope="row" className="py-2 text-left font-normal text-paper-char">
                      {row.label}
                    </th>
                    <td className="py-2 text-right font-paper-display font-bold text-paper-moss tabular-nums">
                      {value}
                      {target !== undefined ? <span className="ml-1 font-paper-ui font-normal text-paper-ash">/ {target}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PaperSection>

        <PaperSection label="Best source">
          {best ? (
            <PaperCard className="bg-paper-cream p-5">
              <p className="font-paper-display text-[20px] font-bold text-paper-moss">{SOURCE_LABELS[best.source]}</p>
              <p className="mt-1 text-[14px] text-paper-char">
                {best.leads} {best.leads === 1 ? "lead" : "leads"} → {best.conversations} {best.conversations === 1 ? "conversation" : "conversations"} → {best.proposals}{" "}
                {best.proposals === 1 ? "proposal" : "proposals"}
              </p>
            </PaperCard>
          ) : (
            <p className="text-[14px] leading-6 text-paper-char">Not enough leads yet to compare sources — it takes at least two from one source, with a conversation.</p>
          )}

          {review.sources.length > 0 ? (
            <table className="mt-5 w-full border-collapse text-[13.5px]">
              <caption className="mb-2 text-left text-[12.5px] text-paper-sage">Leads created in the four weeks to this one</caption>
              <thead>
                <tr className="border-b border-paper-mist text-[12px] tracking-[0.06em] text-paper-sage uppercase">
                  <th scope="col" className="py-2 text-left font-semibold">Source</th>
                  <th scope="col" className="py-2 text-right font-semibold">Leads</th>
                  <th scope="col" className="py-2 text-right font-semibold">Conv.</th>
                  <th scope="col" className="py-2 text-right font-semibold">Proposals</th>
                </tr>
              </thead>
              <tbody>
                {review.sources.map((source) => (
                  <tr key={source.source} className="border-b border-paper-stone">
                    <th scope="row" className="py-2 text-left font-normal text-paper-char">{SOURCE_LABELS[source.source]}</th>
                    <td className="py-2 text-right tabular-nums">{source.leads}</td>
                    <td className="py-2 text-right tabular-nums">{source.conversations}</td>
                    <td className="py-2 text-right tabular-nums">{source.proposals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </PaperSection>
      </div>

      <PaperSection label="Experiments">
        {review.experiments.length === 0 ? (
          <p className="text-[14px] leading-6 text-paper-char">No experiment is running or concluded. Plan one in Experiments.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {review.experiments.map((experiment) => (
              <PaperCard key={experiment.experimentId} className="p-5">
                <h3 className="font-paper-display text-[16px] font-bold text-paper-moss">{experiment.name}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-4">
                  <Figure label="Contacted" value={String(experiment.contacted)} />
                  <Figure label="Conversations" value={String(experiment.conversations)} />
                  <Figure label="Conversation rate" value={percent(experiment.conversationRate)} />
                  <Figure label="Proposal rate" value={percent(experiment.proposalRate)} />
                </dl>
              </PaperCard>
            ))}
          </div>
        )}
      </PaperSection>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{label}</dt>
      <dd className="font-paper-display text-[18px] font-bold text-paper-moss tabular-nums">{value}</dd>
    </div>
  );
}

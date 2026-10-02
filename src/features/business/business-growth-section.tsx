import type { BusinessData, BusinessEntitySummary } from "@shared/business-types";
import { PAPER_FOCUS, PaperCard, PaperSection, Tag } from "@/components/paper";
import { cn } from "@/lib/utils";
import { buildGrowth, CONCENTRATION_LIMIT, type GrowthCheck } from "./business-growth";
import { formatRand, type BusinessTab } from "./business-model";

const percent = (value: number | undefined) => (value === undefined ? "—" : `${Math.round(value * 100)}%`);

function Measure({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[12.5px] text-paper-sage">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2 font-paper-display text-[24px] font-bold tracking-[-0.01em]">
        {value}
        {warn ? <Tag tone="flame">Risk</Tag> : null}
      </dd>
      {note ? <dd className="mt-0.5 text-[12.5px] text-paper-sage">{note}</dd> : null}
    </div>
  );
}

export function GrowthSection({ entity, data, onTab, onClient }: { entity: BusinessEntitySummary; data: BusinessData; onTab: (tab: BusinessTab) => void; onClient: (id: string) => void }) {
  if (entity.source !== "virtec") {
    return <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">Growth measures appear once {entity.name} has clients and revenue recorded.</p>;
  }

  const growth = buildGrowth(data, entity);

  return (
    <div className="grid gap-8">
      <PaperSection label="This week">
        {growth.checklist.length === 0 ? (
          <p className="text-[14px] text-paper-char">Nothing is waiting. Spend the time on Traction.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {growth.checklist.map((check: GrowthCheck) => (
              <li key={check.id}>
                <button type="button" onClick={() => onTab(check.tab)} className={cn("flex w-full cursor-pointer items-center justify-between gap-3 px-1 py-3 text-left text-[14px] hover:bg-paper-cream", PAPER_FOCUS)}>
                  {check.label}
                  <Tag tone="marigold">{check.count}</Tag>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PaperSection>

      <PaperCard>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Measure label="Recurring per month" value={formatRand(growth.recurringMonthly)} note="From live retainer schedules" />
          <Measure label="Active clients on a retainer" value={percent(growth.retainerShare)} note="Built to Sell: recurring revenue is what the business is worth" />
          <Measure
            label="Largest client's share of revenue"
            value={percent(growth.largestClient?.share)}
            note={growth.largestClient ? growth.largestClient.client.companyName ?? growth.largestClient.client.name : undefined}
            warn={(growth.largestClient?.share ?? 0) > CONCENTRATION_LIMIT}
          />
          <Measure
            label="Largest retainer's share of recurring"
            value={percent(growth.largestRetainer?.share)}
            note={growth.largestRetainer?.clientName}
            warn={(growth.largestRetainer?.share ?? 0) > CONCENTRATION_LIMIT}
          />
        </dl>
        {growth.averageAcceptedQuote !== undefined ? <p className="mt-4 text-[13px] text-paper-sage">Average accepted quote: {formatRand(growth.averageAcceptedQuote)}.</p> : null}
      </PaperCard>

      <PaperSection label="Offer a care plan" count={growth.upsell.length}>
        {growth.upsell.length === 0 ? (
          <p className="text-[14px] text-paper-char">Every finished client is already on a retainer.</p>
        ) : (
          <ul className="divide-y divide-paper-mist border-y border-paper-mist">
            {growth.upsell.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button type="button" onClick={() => onClient(client.id)} className={cn("cursor-pointer text-left text-[14.5px] font-semibold hover:underline", PAPER_FOCUS)}>
                  {client.companyName ?? client.name}
                </button>
                <span className="text-[13px] text-paper-sage">{formatRand(client.totalSpent)} spent</span>
              </li>
            ))}
          </ul>
        )}
      </PaperSection>
    </div>
  );
}

import { useState } from "react";
import type { OperationsData, Subscription, UsageRange } from "@shared/usage-types";
import { cn } from "@/lib/utils";
import {
  coverageNote,
  formatCost,
  measuredCost,
  measuredTokens,
  paperTone,
  successWord,
} from "./operations-model";
import { Meter, PaperButton, PaperCard, PaperSection, RadialMeter, SegmentedControl, Sparkline, StackedMeter, Tag } from "./paper";

/**
 * The top of Operations: what this range cost, what the month's bill looks
 * like, and whether the work is landing — then the plans behind it all.
 *
 * Three cards of different weights rather than three equal ones: spend leads,
 * because it is the question the page exists for.
 */
export function Glance({ data }: { data: OperationsData }) {
  return (
    <div className="grid gap-3 md:grid-cols-[1.45fr_1fr_1fr]">
      <SpendCard data={data} />
      <BillCard data={data} />
      <SuccessCard data={data} />
    </div>
  );
}

function SpendCard({ data }: { data: OperationsData }) {
  const note = coverageNote(data.period);

  // Spend when anything in the range was priced; tokens when nothing was, with
  // the card retitled to match — a token chart under a dollar figure would be
  // one measure drawn under another. A bucket with nothing priced plots as zero:
  // that is what was spent on priced runs in it.
  const priced = data.period.costUsd !== undefined;
  const values = data.series.map((bucket) => (priced ? (bucket.costUsd ?? 0) : bucket.tokens));
  const headline = priced ? measuredCost(data.period) : measuredTokens(data.period);

  return (
    <PaperCard className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-paper-moss">{priced ? "Spent on AI" : "Used by AI"}</h3>
        <span className="text-[12.5px] text-paper-sage">{data.window.label}</span>
      </div>

      <p className={cn("mt-2 font-paper-display text-[36px] leading-none font-extrabold tracking-[-0.02em] tabular-nums", paperTone(headline.measurement))}>
        {headline.text}
        {!priced && headline.measurement !== "unknown" ? <span className="ml-2 text-[16px] font-semibold tracking-normal text-paper-sage">tokens</span> : null}
      </p>
      <p className="mt-2 text-[13px] text-paper-char tabular-nums">
        {priced ? `${measuredTokens(data.period).text} tokens · ` : "No run in this window reported a price · "}
        {data.jobs} {data.jobs === 1 ? "job" : "jobs"}
      </p>
      {note ? <p className="mt-0.5 text-[12.5px] text-paper-sage">{note}</p> : null}

      <div className="mt-auto pt-4">
        <Sparkline values={values} label={`${priced ? "Spend" : "Tokens"} across ${data.window.label.toLowerCase()}`} />
        <div className="mt-1.5 flex justify-between text-[11.5px] text-paper-sage tabular-nums">
          <span>{bucketLabel(data.series[0]?.from, data.range)}</span>
          <span>{priced ? "Spend" : "Tokens"}</span>
          <span>{data.range === "today" ? "Now" : "Today"}</span>
        </div>
      </div>
    </PaperCard>
  );
}

function bucketLabel(iso: string | undefined, range: UsageRange): string {
  if (!iso) return "";
  const date = new Date(iso);
  return range === "today"
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The month's bill, split into what is flat and what is metered.
 *
 * Always the calendar month, whatever the range: plans are billed monthly, and
 * a "7-day bill" would be a number nobody is ever sent. The pace line is an
 * estimate and says so with its tilde — metered spend so far, extended over the
 * whole month, plus the plans, which do not grow.
 */
function BillCard({ data }: { data: OperationsData }) {
  const { cost } = data;
  const metered = cost.usageUsd ?? 0;
  const pace = monthPace(data);
  const bothParts = cost.recurringUsd > 0 && metered > 0;

  return (
    <PaperCard className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-paper-moss">This month's bill</h3>
        <span className="text-[12.5px] text-paper-sage">{monthName(data)}</span>
      </div>

      <p className={cn("mt-2 font-paper-display text-[28px] leading-none font-extrabold tracking-[-0.02em] tabular-nums", cost.totalUsd === undefined ? "text-paper-sage" : "text-paper-moss")}>
        {formatCost(cost.totalUsd)}
      </p>

      <dl className="mt-3 space-y-1 text-[13px] tabular-nums">
        <div className="flex justify-between gap-3">
          <dt className="text-paper-char">Plans</dt>
          <dd className="text-paper-moss">{formatCost(cost.recurringUsd)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-paper-char">Metered</dt>
          <dd className="text-paper-moss">{formatCost(cost.usageUsd)}</dd>
        </div>
      </dl>

      {bothParts ? (
        <div className="mt-3">
          <StackedMeter
            label="Flat plans against metered spend"
            format={(value) => formatCost(value)}
            segments={[
              { key: "plans", label: "Plans", value: cost.recurringUsd },
              { key: "metered", label: "Metered", value: metered },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-auto space-y-0.5 border-t border-paper-stone pt-3 text-[12.5px] leading-5">
        {pace !== undefined ? (
          <p className="text-paper-char">
            <span className="font-medium text-paper-moss tabular-nums">~{formatCost(pace)}</span> by month end at this pace
          </p>
        ) : null}
        <p className="text-paper-sage">{cost.incomplete ? "A floor — some runs reported no price." : "Every run this month was priced."}</p>
      </div>
    </PaperCard>
  );
}

/** Metered spend so far, extended over the whole month, plus the flat plans. */
function monthPace(data: OperationsData): number | undefined {
  if (data.cost.usageUsd === undefined) return undefined;

  const now = new Date(data.generatedAt);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsed = (now.getTime() - start) / (end - start);
  if (elapsed <= 0) return undefined;

  return data.cost.recurringUsd + data.cost.usageUsd / elapsed;
}

function monthName(data: OperationsData): string {
  return new Date(data.generatedAt).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}

function SuccessCard({ data }: { data: OperationsData }) {
  const word = successWord(data.successRate);
  const tone = data.successRate === undefined ? "ink" : data.successRate >= 0.8 ? "green" : data.successRate >= 0.5 ? "amber" : "flame";

  return (
    <PaperCard className="flex flex-col items-center">
      <div className="flex w-full items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-paper-moss">Jobs landing</h3>
        <span className="text-[12.5px] text-paper-sage">{data.window.label}</span>
      </div>

      <div className="my-auto pt-3">
        <RadialMeter value={data.successRate} word={word ?? "No finished jobs"} label="Share of finished jobs that completed" tone={tone} />
      </div>

      <p className="mt-2 text-center text-[12.5px] leading-5 text-paper-sage">
        {data.successRate === undefined ? "Rate appears once a job finishes." : "Of jobs that finished, how many completed."}
      </p>
    </PaperCard>
  );
}

const GLYPH_TINT = ["bg-paper-marigold/35", "bg-paper-green/25", "bg-paper-blue/15", "bg-paper-flame/15", "bg-paper-stone"];

/**
 * What is paid for regardless of use, one card per plan — and, one switch
 * away, what was metered on top of them.
 */
export function PlansPanel({ data, onManage }: { data: OperationsData; onManage: () => void }) {
  const [view, setView] = useState<"plans" | "metered">("plans");
  const plans = data.subscriptions.filter((subscription) => subscription.active);
  const metered = data.cost.usage;
  const meteredTotal = data.cost.usageUsd ?? 0;

  return (
    <PaperSection
      label={view === "plans" ? "Plans" : `Metered · ${monthName(data)}`}
      count={view === "plans" ? plans.length : metered.length}
      action={
        <SegmentedControl
          label="Plans or metered spend"
          value={view}
          onChange={setView}
          options={[
            { value: "plans", label: "Plans" },
            { value: "metered", label: "Metered" },
          ]}
        />
      }
    >
      <p className="-mt-1 mb-4 text-[13px] text-paper-char tabular-nums">
        Flat <span className="font-medium text-paper-moss">{formatCost(data.cost.recurringUsd)}</span> / month
        <span className="text-paper-ash"> · </span>
        Metered <span className="font-medium text-paper-moss">{formatCost(data.cost.usageUsd)}</span> in {monthName(data)}
      </p>

      {view === "plans" ? (
        plans.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-dashed border-paper-mist bg-paper-cream px-4 py-5">
            <p className="max-w-[56ch] text-[14px] leading-6 text-paper-char">
              No plans recorded. Add what you pay flat each month — Claude, ChatGPT, Gemini — and it shows here beside what was metered.
            </p>
            <PaperButton variant="amber" onClick={onManage}>
              Add a plan
            </PaperButton>
          </div>
        ) : (
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
            {plans.map((plan, index) => (
              <li key={plan.id}>
                <PlanCard plan={plan} tint={GLYPH_TINT[index % GLYPH_TINT.length]} />
              </li>
            ))}
          </ul>
        )
      ) : metered.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-sage">Nothing metered has reported a price this month.</p>
      ) : (
        <ul className="divide-y divide-paper-stone border-y border-paper-stone">
          {metered.map((row) => (
            <li key={row.key} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[14.5px] text-paper-moss">{row.label}</span>
                <span className="text-[13.5px] text-paper-moss tabular-nums">{formatCost(row.total.costUsd)}</span>
              </div>
              <div className="mt-2">
                <Meter
                  value={meteredTotal > 0 && row.total.costUsd !== undefined ? row.total.costUsd / meteredTotal : undefined}
                  label={`${row.label}, share of metered spend`}
                  tone="amber"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function PlanCard({ plan, tint }: { plan: Subscription; tint: string }) {
  const price =
    plan.type === "prepaid"
      ? plan.balanceUsd === undefined
        ? undefined
        : { amount: formatCost(plan.balanceUsd), unit: "left" }
      : plan.price === undefined
        ? undefined
        : { amount: formatCost(plan.price), unit: plan.billingCycle === "annual" ? "/ year" : "/ month" };

  return (
    <div className="flex h-full flex-col rounded-[4px] border border-paper-mist bg-paper-white p-3.5 transition-colors duration-150 hover:bg-paper-cream">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-[4px] font-paper-display text-[14px] font-bold text-paper-moss", tint)} aria-hidden="true">
          {plan.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-paper-moss">{plan.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {plan.provider ? <span className="truncate text-[12px] text-paper-sage">{plan.provider}</span> : null}
            <Tag tone={plan.type === "subscription" ? "marigold" : "muted"}>{plan.type.replace(/-/g, " ")}</Tag>
          </span>
        </span>
      </div>

      <p className="mt-4 flex items-baseline justify-between gap-2">
        <span className="font-paper-display text-[20px] font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">{price?.amount ?? "—"}</span>
        {price ? <span className="text-[12px] text-paper-sage">{price.unit}</span> : null}
      </p>
    </div>
  );
}

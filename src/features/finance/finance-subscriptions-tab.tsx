import { useState } from "react";
import type { FinanceData, Subscription } from "@shared/finance-types";
import { PaperButton, PaperCard, PaperSection, Tag, PAPER_INPUT } from "@/components/paper";
import { useAssessSubscriptions, useSaveDecision } from "@/lib/agentos/finance";
import { Figure, Line, MutationError } from "./finance-kit";
import { PayBadge } from "./finance-badges";
import { FoldCard, FoldControls } from "./finance-fold";
import { subscriptionPayState, TIER_LABEL, money } from "./finance-model";
import { useFold } from "./finance-ui-hooks";

const TIERS: readonly Subscription["tier"][] = ["high", "medium", "low", "unassessed"];

/**
 * Subscription intelligence.
 *
 * Finance finds the recurring payments and adds them up. Jev, when asked,
 * says which deserve a second look. It suggests what is worth reviewing and
 * never what to cancel: you may use something heavily that looks expensive,
 * and "Keep" is stored so Finance stops raising it.
 */
export function FinanceSubscriptionsTab({ data }: { data: FinanceData }) {
  const assess = useAssessSubscriptions();
  const unassessed = data.subscriptions.filter((subscription) => !subscription.assessment).length;
  const sample = data.source.kind === "sample";

  // What needs a look starts open: a subscription not seen this month, or one worth reviewing. The rest start folded.
  const states = new Map(data.subscriptions.map((subscription) => [subscription.merchant, subscriptionPayState(subscription, data.today)]));
  const fold = useFold(
    data.subscriptions.map((subscription) => subscription.merchant),
    (id) => {
      const subscription = data.subscriptions.find((entry) => entry.merchant === id);
      return states.get(id)?.state === "late" || subscription?.tier === "high" || data.subscriptions.length <= 3;
    },
  );
  const tally = { paid: 0, due: 0, late: 0 };
  for (const entry of states.values()) if (entry.state === "paid" || entry.state === "due" || entry.state === "late") tally[entry.state] += 1;

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        {data.subscriptions.length === 0 ? (
          <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
            No recurring payments found yet. Finance needs at least two payments about a month apart to see a rhythm.
          </p>
        ) : null}

        {TIERS.map((tier) => {
          const group = data.subscriptions.filter((subscription) => subscription.tier === tier);
          if (group.length === 0) return null;
          return (
            <PaperSection
              key={tier}
              label={TIER_LABEL[tier]}
              count={group.length}
              action={<FoldControls count={group.length} allOpen={group.every((entry) => fold.isOpen(entry.merchant))} onSetAll={(open) => fold.setAll(open, group.map((entry) => entry.merchant))} />}
            >
              <ul className="space-y-3">
                {group.map((subscription) => (
                  <li key={subscription.merchant}>
                    <SubscriptionCard
                      subscription={subscription}
                      pay={states.get(subscription.merchant) ?? { state: "unknown", label: "" }}
                      open={fold.isOpen(subscription.merchant)}
                      onToggle={() => fold.toggle(subscription.merchant)}
                      readOnly={sample}
                    />
                  </li>
                ))}
              </ul>
            </PaperSection>
          );
        })}
      </div>

      <div className="min-w-0 space-y-12">
        <PaperCard className="bg-paper-cream p-5">
          <Figure label="Subscriptions" value={`${money(data.subscriptionMonthly)} / month`} note={`${money(data.subscriptionAnnual)} a year`} />
          {data.subscriptions.length > 0 ? (
            <div className="mt-4 border-t border-paper-stone pt-4" role="group" aria-label="This month's payments">
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">This month</p>
              <p className="mt-2 flex flex-wrap gap-2">
                <PayBadge state="paid">{tally.paid} paid</PayBadge>
                <PayBadge state="due">{tally.due} due</PayBadge>
                {tally.late > 0 ? <PayBadge state="late">{tally.late} not seen</PayBadge> : null}
              </p>
            </div>
          ) : null}
        </PaperCard>

        <PaperSection label="If you cancelled the review candidates">
          {data.subscriptionReview.count === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">
              {data.subscriptions.length > 0 && unassessed === data.subscriptions.length
                ? "Nothing is ranked yet, so there is nothing to total. Ask Jev to rank them."
                : "No review candidates right now."}
            </p>
          ) : (
            <dl className="divide-y divide-paper-stone">
              <Line label="Candidates" value={data.subscriptionReview.count} />
              <Line strong label="Monthly saving" value={money(data.subscriptionReview.monthly)} />
              <Line strong label="Annual saving" value={money(data.subscriptionReview.annual)} />
            </dl>
          )}
          <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">Candidates are what Jev ranked high or medium, excluding anything you marked Keep.</p>
        </PaperSection>

        <PaperSection label="Jev's second opinion">
          <p className="text-[14px] leading-6 text-paper-char">
            Jev sees the merchant, what it charges, how often, and how the price moved. It never sees account numbers, balances or dates. It ranks what deserves a review; the decision stays yours.
          </p>
          {data.jev.configured ? (
            <>
              <PaperButton variant="amber" className="mt-4" disabled={assess.isPending || sample || data.subscriptions.length === 0} onClick={() => assess.mutate()}>
                {assess.isPending ? "Asking Jev…" : unassessed > 0 ? `Rank ${unassessed} ${unassessed === 1 ? "subscription" : "subscriptions"}` : "Ask again"}
              </PaperButton>
              {sample ? <p className="mt-2 text-[12.5px] text-paper-sage">Not available on sample data.</p> : null}
              {assess.data?.error ? <p className="mt-2 text-[13px] text-paper-flame-deep">Stopped early: {assess.data.error}</p> : null}
              {assess.data && !assess.data.error ? (
                <p className="mt-2 text-[13px] text-paper-char">
                  {assess.data.assessed} assessed, {assess.data.skipped} unchanged.
                </p>
              ) : null}
              <MutationError error={assess.error} />
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-5 text-paper-sage">Set JEV_API_KEY on the server to enable it.</p>
          )}
        </PaperSection>
      </div>
    </div>
  );
}

function SubscriptionCard({
  subscription,
  pay,
  open,
  onToggle,
  readOnly,
}: {
  subscription: Subscription;
  pay: { state: "paid" | "due" | "late" | "unknown"; label: string };
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
}) {
  const save = useSaveDecision();
  const [note, setNote] = useState(subscription.decisionNote ?? "");
  const { assessment } = subscription;
  const rise = subscription.previousAmount === undefined ? undefined : subscription.monthly - (subscription.frequency === "annual" ? subscription.previousAmount / 12 : subscription.previousAmount);

  const decide = (decision: "keep" | "reviewing" | "cancelled" | null) =>
    save.mutate({ merchant: subscription.merchant, decision, note: decision === "keep" && note.trim() ? note.trim() : undefined });

  return (
    <FoldCard
      open={open}
      onToggle={onToggle}
      accent={pay.state === "paid" ? "green" : pay.state === "late" ? "flame" : "amber"}
      title={subscription.merchant}
      meta={
        <>
          <PayBadge state={pay.state}>{pay.label}</PayBadge>
          <Tag>{assessment?.kind ?? subscription.kind}</Tag>
          {subscription.frequency === "annual" ? <Tag>Yearly</Tag> : null}
          {rise !== undefined && rise > 0 ? <Tag tone="flame">Up {money(rise)}</Tag> : null}
          {subscription.decision === "keep" ? <Tag tone="green">Kept</Tag> : null}
          {subscription.decision === "reviewing" ? <Tag tone="marigold">Reviewing</Tag> : null}
        </>
      }
      figure={
        <>
          <span className="block font-paper-display text-[20px] leading-6 font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">{money(subscription.monthly)}</span>
          <span className="block text-[12px] text-paper-sage tabular-nums">{money(subscription.annual)} a year</span>
        </>
      }
    >
      {assessment ? (
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Line label="Likely essential" value={`${assessment.essential} / 5`} />
          <Line label="Likely underused" value={`${assessment.underused} / 5`} />
          <Line label="Overlaps another service" value={assessment.duplicate ? "Yes" : "No"} />
          <Line label="Review priority" value={`${assessment.priority} / 5`} />
          <Line label="Jev's confidence" value={`${Math.round(assessment.confidence * 100)}%`} />
        </dl>
      ) : (
        <p className="text-[13.5px] leading-6 text-paper-sage">Not ranked yet. Ask Jev on the right to say whether this deserves a review.</p>
      )}

      {subscription.decisionNote ? <p className="mt-3 text-[13.5px] leading-6 text-paper-char">Your note: {subscription.decisionNote}</p> : null}

      {!readOnly ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            aria-label={`Why keep ${subscription.merchant} (optional)`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why keep it? (optional)"
            className={`${PAPER_INPUT} min-w-0 flex-1 sm:max-w-[16rem]`}
            maxLength={200}
          />
          <PaperButton variant="ghost" disabled={save.isPending} onClick={() => decide("keep")}>
            Keep
          </PaperButton>
          <PaperButton variant="ghost" disabled={save.isPending} onClick={() => decide("reviewing")}>
            Review
          </PaperButton>
          <PaperButton disabled={save.isPending} onClick={() => decide("cancelled")} title="Marks it cancelled here. Cancel it with the provider yourself.">
            Cancelled
          </PaperButton>
          {subscription.decision ? (
            <PaperButton disabled={save.isPending} onClick={() => decide(null)}>
              Undo
            </PaperButton>
          ) : null}
        </div>
      ) : null}
      <MutationError error={save.error} />
    </FoldCard>
  );
}

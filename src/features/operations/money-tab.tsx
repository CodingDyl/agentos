import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BudgetState, CostSummary, OperationsData, Subscription } from "@shared/usage-types";
import {
  useDeleteSubscription,
  useDesignLibrary,
  useHiggsfieldAccount,
  useSaveBudget,
  useSaveSubscription,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { budgetLabel, formatCost, formatPercent } from "./operations-model";
import { FieldLabel, Meter, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";

/**
 * What the AI stack actually costs.
 *
 * The tab exists because API tokens are not the bill. A month of $4.82 in
 * metered spend sitting on top of $40 of plans is a $44.82 month, and an
 * operations screen that reported the first number would be answering a
 * question nobody asked.
 *
 * The two kinds of money never merge silently. Recurring commitments and
 * metered usage are listed apart, added only at the end, and the total says
 * out loud when the metered half is incomplete. Always the calendar month:
 * nobody is billed by the week.
 */
export function MoneyTab({ data }: { data: OperationsData }) {
  const month = new Date(data.generatedAt).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-12">
      <CostBreakdown cost={data.cost} month={month} />
      {/* Image and video generation is paid in credits rather than in dollars,
          so it does not appear in the ledger above at all. Shown here because
          it is the same question — what is this costing — asked in the other
          currency the workspace spends. */}
      <Higgsfield />
      <Budgets budgets={data.budgets} />
      <Subscriptions subscriptions={data.subscriptions} />
    </div>
  );
}

function CostColumn({ title, rows, empty }: { title: string; rows: CostSummary["recurring"]; empty: string }) {
  return (
    <div>
      <h3 className="text-[13.5px] font-semibold text-paper-moss">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[14px] leading-6 text-paper-sage">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-paper-stone">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-4 py-2 text-[14.5px] leading-6">
              <span className="min-w-0 truncate text-paper-char">{row.label}</span>
              <span className="shrink-0 text-paper-moss tabular-nums">{formatCost(row.total.costUsd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CostBreakdown({ cost, month }: { cost: CostSummary; month: string }) {
  return (
    <PaperSection label={`AI cost · ${month}`}>
      <PaperCard>
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
          <CostColumn title="Recurring" rows={cost.recurring} empty="No subscriptions recorded." />
          <CostColumn title="Usage based" rows={cost.usage} empty="Nothing metered has reported a cost." />
        </div>

        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4 border-t border-paper-mist pt-4">
          <span className="text-[13.5px] font-semibold text-paper-moss">Total</span>
          <span className="font-paper-display text-[26px] leading-none font-extrabold tracking-[-0.03em] text-paper-moss tabular-nums">
            {formatCost(cost.totalUsd)}
          </span>
        </div>

        {/* Said plainly rather than as a footnote: a total that quietly omitted
            every unpriced run is the most misleading thing this page could show. */}
        {cost.incomplete ? (
          <p className="mt-3 flex max-w-[72ch] items-start gap-2 text-[13px] leading-5 text-paper-char">
            <Tag tone="flame" className="mt-px shrink-0">
              Floor
            </Tag>
            Some runs reported no cost, so this is a floor rather than a bill. Workers that count tokens without pricing them (Grok among them) are absent
            from the usage-based column.
          </p>
        ) : null}
      </PaperCard>
    </PaperSection>
  );
}

const BUDGET_TONE: Record<BudgetState["state"], "green" | "amber" | "flame"> = {
  ok: "green",
  warning: "amber",
  exceeded: "flame",
};

/**
 * Budgets.
 *
 * Advisory, and the copy says so. Crossing one warns; it never stops a job.
 * A worker killed halfway through an implementation because a counter crossed
 * a threshold loses the work, orphans the worktree, and costs far more than
 * the dollar it saved.
 */
function Budgets({ budgets }: { budgets: readonly BudgetState[] }) {
  const save = useSaveBudget();
  const [draft, setDraft] = useState("");

  const global = budgets.find((state) => state.budget.scope === "global");

  return (
    <PaperSection label="Budget">
      <PaperCard>
        {global ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <span className="text-[14px] text-paper-char">{budgetLabel(global.budget)}</span>
              <span className="font-paper-display text-[20px] font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">
                {formatCost(global.spentUsd)} <span className="text-[14px] font-medium text-paper-sage">of {formatCost(global.budget.monthlyUsd)}</span>
              </span>
            </div>

            <div className="mt-3">
              <Meter value={global.fraction} label="Share of the monthly budget spent" tone={BUDGET_TONE[global.state]} size="md" />
            </div>

            <p className="mt-2.5 text-[12.5px] leading-5 text-paper-sage">
              {formatPercent(global.fraction)} used · warns at {global.budget.warningPercent}% · never stops a running job
            </p>
          </div>
        ) : (
          <p className="max-w-[70ch] text-[14px] leading-6 text-paper-char">No budget set. A budget here warns you; it does not stop work.</p>
        )}

        <form
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-paper-stone pt-4"
          onSubmit={(event) => {
            event.preventDefault();

            const monthlyUsd = Number.parseFloat(draft);
            if (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0) return;

            save.mutate({ scope: "global", monthlyUsd, warningPercent: 80 });
            setDraft("");
          }}
        >
          <label>
            <FieldLabel>Monthly ceiling (USD)</FieldLabel>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              inputMode="decimal"
              placeholder={global ? String(global.budget.monthlyUsd) : "50"}
              className={cn(PAPER_INPUT, "w-28")}
            />
          </label>

          <PaperButton type="submit" variant="ghost" disabled={save.isPending}>
            {save.isPending ? "Saving…" : global ? "Update" : "Set budget"}
          </PaperButton>
        </form>
      </PaperCard>
    </PaperSection>
  );
}

const TYPES: readonly Subscription["type"][] = ["subscription", "prepaid", "pay-as-you-go"];

/**
 * What is paid for regardless of usage.
 *
 * Typed in, on purpose. Six billing integrations is days of work to learn five
 * numbers already known, they break whenever a provider changes a dashboard,
 * and a wrong-but-automatic figure is far harder to notice than a stale one
 * somebody wrote. Where a balance genuinely is one authenticated request —
 * OpenRouter — AgentOS asks, and shows what it got.
 */
function Subscriptions({ subscriptions }: { subscriptions: readonly Subscription[] }) {
  const [adding, setAdding] = useState(false);
  const save = useSaveSubscription();
  const remove = useDeleteSubscription();

  return (
    <PaperSection
      label="Subscriptions"
      count={subscriptions.length}
      action={
        <PaperButton variant={subscriptions.length === 0 ? "amber" : "ghost"} onClick={() => setAdding((open) => !open)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add subscription
        </PaperButton>
      }
    >
      {adding ? (
        <SubscriptionForm
          busy={save.isPending}
          onCancel={() => setAdding(false)}
          onSave={(subscription) => {
            save.mutate(subscription);
            setAdding(false);
          }}
        />
      ) : null}

      {subscriptions.length === 0 ? (
        <p className="max-w-[70ch] text-[14px] leading-6 text-paper-char">
          Nothing recorded. AgentOS never assumes a subscription exists because it saw traffic: a pay-as-you-go key and a monthly plan look identical from
          the inside.
        </p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {subscriptions.map((subscription) => (
            <li key={subscription.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate text-[14.5px] font-medium text-paper-moss">{subscription.name}</span>
                <Tag tone={subscription.active ? "green" : "muted"}>{subscription.active ? "Active" : "Inactive"}</Tag>
              </div>

              <div className="flex shrink-0 items-center gap-5">
                <span className="text-[13px] text-paper-char tabular-nums">
                  {subscription.type === "prepaid"
                    ? subscription.balanceUsd === undefined
                      ? "Prepaid"
                      : `${formatCost(subscription.balanceUsd)} remaining`
                    : subscription.price === undefined
                      ? subscription.type
                      : `${formatCost(subscription.price)} / ${subscription.billingCycle === "annual" ? "year" : "month"}`}
                </span>

                <button
                  type="button"
                  aria-label={`Remove ${subscription.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(subscription.id)}
                  className={cn(
                    "grid size-8 cursor-pointer place-items-center rounded-[4px] text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-flame disabled:cursor-not-allowed",
                    PAPER_FOCUS,
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function SubscriptionForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (subscription: Omit<Subscription, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [type, setType] = useState<Subscription["type"]>("subscription");
  const [price, setPrice] = useState("");

  return (
    <PaperCard className="mb-4 bg-paper-cream">
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length === 0) return;

          const parsed = Number.parseFloat(price);

          onSave({
            name: name.trim(),
            provider: provider.trim() || undefined,
            type,
            price: Number.isFinite(parsed) ? parsed : undefined,
            currency: "USD",
            billingCycle: type === "subscription" ? "monthly" : undefined,
            active: true,
          });
        }}
      >
        <label>
          <FieldLabel>Name</FieldLabel>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude Max" className={cn(PAPER_INPUT, "w-44")} />
        </label>

        <label>
          <FieldLabel>Provider</FieldLabel>
          <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="anthropic" className={cn(PAPER_INPUT, "w-36")} />
        </label>

        <label>
          <FieldLabel>Type</FieldLabel>
          <select value={type} onChange={(event) => setType(event.target.value as Subscription["type"])} className={cn(PAPER_INPUT, "cursor-pointer pr-8")}>
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/-/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label>
          <FieldLabel>{type === "prepaid" ? "Balance (USD)" : "Price (USD)"}</FieldLabel>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="20" className={cn(PAPER_INPUT, "w-24")} />
        </label>

        <div className="flex items-center gap-2">
          <PaperButton type="submit" variant="amber" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </PaperButton>
          <PaperButton onClick={onCancel}>Cancel</PaperButton>
        </div>
      </form>
    </PaperCard>
  );
}

/**
 * The Higgsfield plan and what is left of it.
 *
 * Credits are spent by generating through the CLI at standard rates, even for
 * models that are unlimited on the website — so the balance is worth a line on
 * the page that answers "what is this costing me".
 */
function Higgsfield() {
  const { data: account } = useHiggsfieldAccount();
  const { data: library } = useDesignLibrary();

  if (!account) return null;

  const generated = (library?.assets ?? []).filter((asset) => asset.source === "higgsfield");

  const byProject = [
    ...generated.reduce((counts, asset) => {
      const key = asset.project ?? "Unassigned";
      return counts.set(key, (counts.get(key) ?? 0) + 1);
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  return (
    <PaperSection label="Higgsfield">
      <PaperCard>
        {!account.connected ? (
          <p className="max-w-[62ch] text-[14px] leading-6 text-paper-char">{account.reason ?? "Not connected."}</p>
        ) : (
          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
            <div>
              <h3 className="text-[13.5px] font-semibold text-paper-moss">Plan</h3>
              <p className="mt-1 text-[14.5px] text-paper-moss capitalize">{account.plan ?? "connected"}</p>
              <p className="text-[12.5px] text-paper-sage">{account.email}</p>

              <h3 className="mt-5 text-[13.5px] font-semibold text-paper-moss">Credits remaining</h3>
              <p className="mt-1 font-paper-display text-[28px] leading-8 font-extrabold tracking-[-0.03em] text-paper-moss tabular-nums">{account.credits ?? "-"}</p>
            </div>

            <div>
              <h3 className="text-[13.5px] font-semibold text-paper-moss">Generated visuals</h3>
              {byProject.length === 0 ? (
                <p className="mt-2 text-[14px] leading-6 text-paper-sage">Nothing has been generated through AgentOS yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-paper-stone">
                  {byProject.map(([project, count]) => (
                    <li key={project} className="flex items-baseline justify-between gap-6 py-2">
                      <span className="text-[14.5px] text-paper-char">{project}</span>
                      <span className="text-[13.5px] text-paper-moss tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </PaperCard>
    </PaperSection>
  );
}

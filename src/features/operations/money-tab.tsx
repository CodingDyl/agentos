import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  BudgetState,
  CostSummary,
  OperationsData,
  Subscription,
} from "@shared/usage-types";
import {
  CommandButton,
  HairlineCard,
  SectionLabel,
  StatusPill,
} from "@/components/os";
import {
  useDeleteSubscription,
  useSaveBudget,
  useSaveSubscription,
} from "@/lib/agentos/queries";
import { useDesignLibrary, useHiggsfieldAccount } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { budgetLabel, budgetTone, formatCost, formatPercent } from "./operations-model";

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
 * out loud when the metered half is incomplete — which it will be for as long
 * as any worker reports tokens without a price.
 */
export function MoneyTab({ data }: { data: OperationsData }) {
  return (
    <div className="space-y-12">
      <CostBreakdown cost={data.cost} month={data.window.label} />
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

function CostBreakdown({
  cost,
  month,
}: {
  cost: CostSummary;
  month: string;
}) {
  return (
    <section>
      <SectionLabel>AI cost — {month}</SectionLabel>

      <div className="mt-4 grid gap-x-16 gap-y-8 lg:grid-cols-2">
        <div>
          <p className="os-meta text-os-subtle">Recurring</p>
          {cost.recurring.length === 0 ? (
            <p className="mt-3 text-[15px] leading-6 text-os-muted">
              No subscriptions recorded.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {cost.recurring.map((row) => (
                <li
                  key={row.key}
                  className="flex items-baseline justify-between gap-4 text-[15px] leading-6"
                >
                  <span className="min-w-0 truncate text-os-muted">
                    {row.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {formatCost(row.total.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="os-meta text-os-subtle">Usage based</p>
          {cost.usage.length === 0 ? (
            <p className="mt-3 text-[15px] leading-6 text-os-muted">
              Nothing metered has reported a cost.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {cost.usage.map((row) => (
                <li
                  key={row.key}
                  className="flex items-baseline justify-between gap-4 text-[15px] leading-6"
                >
                  <span className="min-w-0 truncate text-os-muted">
                    {row.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {formatCost(row.total.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-4 border-t border-os-border pt-5">
        <span className="os-meta text-os-subtle">Total</span>
        <span className="tabular-nums text-[22px] leading-[1.15] text-foreground">
          {formatCost(cost.totalUsd)}
        </span>
      </div>

      {/* Said plainly rather than as a footnote: a total that quietly omitted
          every unpriced run is the most misleading thing this page could show. */}
      {cost.incomplete ? (
        <p className="mt-3 max-w-[70ch] text-[13px] leading-5 text-os-warning">
          Some runs reported no cost, so this is a floor rather than a bill.
          Workers that count tokens without pricing them — Grok among them —
          are absent from the usage-based column.
        </p>
      ) : null}
    </section>
  );
}

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
    <section>
      <SectionLabel>Budgets</SectionLabel>

      {global ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <span className="text-[15px] leading-6 text-os-muted">
              {budgetLabel(global.budget)}
            </span>
            <span className="tabular-nums text-[18px] text-foreground">
              {formatCost(global.spentUsd)}{" "}
              <span className="text-os-subtle">
                / {formatCost(global.budget.monthlyUsd)}
              </span>
            </span>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-os-border">
            <div
              className={cn("h-full", budgetTone(global.state))}
              style={{ width: `${Math.min(global.fraction * 100, 100)}%` }}
              aria-hidden="true"
            />
          </div>

          <p className="mt-2.5 text-[13px] leading-5 text-os-subtle">
            {formatPercent(global.fraction)} used · warns at{" "}
            {global.budget.warningPercent}% · never stops a running job
          </p>
        </div>
      ) : (
        <p className="mt-4 max-w-[70ch] text-[15px] leading-6 text-os-muted">
          No budget set. A budget here warns you; it does not stop work.
        </p>
      )}

      <form
        className="mt-5 flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();

          const monthlyUsd = Number.parseFloat(draft);
          if (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0) return;

          save.mutate({ scope: "global", monthlyUsd, warningPercent: 80 });
          setDraft("");
        }}
      >
        <label className="os-meta text-os-subtle">
          Monthly ceiling
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            inputMode="decimal"
            placeholder={global ? String(global.budget.monthlyUsd) : "50"}
            className="os-focus-ring ml-3 w-24 rounded-md border border-os-border bg-transparent px-3 py-2 text-[15px] text-foreground placeholder:text-os-subtle"
          />
        </label>

        <CommandButton
          type="submit"
          variant="secondary"
          loading={save.isPending}
          loadingLabel="Saving"
        >
          {global ? "Update" : "Set budget"}
        </CommandButton>
      </form>
    </section>
  );
}

const TYPES: readonly Subscription["type"][] = [
  "subscription",
  "prepaid",
  "pay-as-you-go",
];

/**
 * What is paid for regardless of usage.
 *
 * Typed in, on purpose. Six billing integrations is days of work to learn five
 * numbers already known, they break whenever a provider changes a dashboard,
 * and a wrong-but-automatic figure is far harder to notice than a stale one
 * somebody wrote. Where a balance genuinely is one authenticated request —
 * OpenRouter — AgentOS asks, and shows what it got.
 */
function Subscriptions({
  subscriptions,
}: {
  subscriptions: readonly Subscription[];
}) {
  const [adding, setAdding] = useState(false);
  const save = useSaveSubscription();
  const remove = useDeleteSubscription();

  return (
    <section>
      <SectionLabel
        action={
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-2 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add subscription
          </button>
        }
      >
        Subscriptions
      </SectionLabel>

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
        <p className="mt-4 max-w-[70ch] text-[15px] leading-6 text-os-muted">
          Nothing recorded. AgentOS never assumes a subscription exists because
          it saw traffic — a pay-as-you-go key and a monthly plan look identical
          from the inside.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {subscriptions.map((subscription) => (
            <li
              key={subscription.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-os-border/60 py-3.5"
            >
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="truncate text-[15px] leading-6 text-foreground">
                  {subscription.name}
                </span>
                <StatusPill
                  status={subscription.active ? "healthy" : "paused"}
                  label={subscription.active ? "Active" : "Inactive"}
                />
              </div>

              <div className="flex shrink-0 items-baseline gap-6">
                <span className="os-meta text-os-subtle">
                  {subscription.type === "prepaid"
                    ? subscription.balanceUsd === undefined
                      ? "Prepaid"
                      : `${formatCost(subscription.balanceUsd)} remaining`
                    : subscription.price === undefined
                      ? subscription.type
                      : `${formatCost(subscription.price)} / ${
                          subscription.billingCycle === "annual"
                            ? "year"
                            : "month"
                        }`}
                </span>

                <button
                  type="button"
                  aria-label={`Remove ${subscription.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(subscription.id)}
                  className="os-focus-ring cursor-pointer rounded-md p-1 text-os-subtle transition-colors duration-150 hover:text-os-danger disabled:cursor-not-allowed"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <HairlineCard className="mt-4 p-5">
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
        <label className="os-meta text-os-subtle">
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude"
            className="os-focus-ring mt-2 block w-40 rounded-md border border-os-border bg-transparent px-3 py-2 text-[15px] text-foreground placeholder:text-os-subtle"
          />
        </label>

        <label className="os-meta text-os-subtle">
          Provider
          <input
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="anthropic"
            className="os-focus-ring mt-2 block w-36 rounded-md border border-os-border bg-transparent px-3 py-2 text-[15px] text-foreground placeholder:text-os-subtle"
          />
        </label>

        <label className="os-meta text-os-subtle">
          Type
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as Subscription["type"])
            }
            className="os-focus-ring mt-2 block rounded-md border border-os-border bg-os-surface px-3 py-2 text-[15px] text-foreground"
          >
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="os-meta text-os-subtle">
          {type === "prepaid" ? "Balance" : "Price"}
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="20"
            className="os-focus-ring mt-2 block w-24 rounded-md border border-os-border bg-transparent px-3 py-2 text-[15px] text-foreground placeholder:text-os-subtle"
          />
        </label>

        <div className="flex items-center gap-2">
          <CommandButton
            type="submit"
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
          >
            Save
          </CommandButton>
          <CommandButton variant="quiet" onClick={onCancel}>
            Cancel
          </CommandButton>
        </div>
      </form>
    </HairlineCard>
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

  const byProject = [...generated.reduce((counts, asset) => {
    const key = asset.project ?? "Unassigned";
    return counts.set(key, (counts.get(key) ?? 0) + 1);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <section>
      <SectionLabel>Higgsfield</SectionLabel>

      {!account.connected ? (
        <p className="mt-4 max-w-[62ch] text-[15px] leading-6 text-os-muted">
          {account.reason ?? "Not connected."}
        </p>
      ) : (
        <div className="mt-4 grid gap-x-16 gap-y-8 lg:grid-cols-2">
          <div>
            <p className="os-meta text-os-subtle">Plan</p>
            <p className="mt-3 text-[15px] leading-6 text-foreground capitalize">
              {account.plan ?? "connected"}
            </p>
            <p className="os-meta mt-1 text-os-subtle">{account.email}</p>

            <p className="os-meta mt-6 text-os-subtle">Credits remaining</p>
            <p className="mt-2 text-[28px] leading-8 tabular-nums text-foreground">
              {account.credits ?? "—"}
            </p>
          </div>

          <div>
            <p className="os-meta text-os-subtle">Generated visuals</p>
            {byProject.length === 0 ? (
              <p className="mt-3 text-[15px] leading-6 text-os-muted">
                Nothing has been generated through AgentOS yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {byProject.map(([project, count]) => (
                  <li key={project} className="flex items-baseline justify-between gap-6">
                    <span className="text-[15px] leading-6 text-os-muted">{project}</span>
                    <span className="os-meta text-foreground tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

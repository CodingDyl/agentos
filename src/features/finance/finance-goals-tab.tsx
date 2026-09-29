import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { GOAL_TYPES, type FinanceData, type GoalInput, type GoalProgress } from "@shared/finance-types";
import { FieldLabel, Meter, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useCreateGoal, useDeleteGoal, useUpdateGoal } from "@/lib/agentos/finance";
import { Line, MutationError } from "./finance-kit";
import { formatDay, goalStatusLabel, money } from "./finance-model";

const TYPE_LABEL: Record<(typeof GOAL_TYPES)[number], string> = {
  travel: "Travel",
  emergency: "Emergency fund",
  purchase: "Purchase",
  investment: "Investment",
  other: "Other",
};

/**
 * Goals and sinking funds.
 *
 * A goal is a milestone (a trip, a buffer). A sinking fund is money set aside
 * for an expense you know is coming (car maintenance, Christmas, annual
 * insurance), so that it stops arriving as a surprise. The required monthly
 * amount is arithmetic: what remains, over the months left.
 */
export function FinanceGoalsTab({ data }: { data: FinanceData }) {
  const [adding, setAdding] = useState(false);
  const goals = data.goals.filter((goal) => goal.kind === "goal");
  const funds = data.goals.filter((goal) => goal.kind === "sinking");
  const sample = data.source.kind === "sample";

  return (
    <div className="space-y-12">
      {adding ? (
        <PaperCard className="max-w-2xl p-5">
          <h2 className="mb-4 font-paper-display text-[17px] font-bold text-paper-moss">New savings goal</h2>
          <GoalForm onDone={() => setAdding(false)} />
        </PaperCard>
      ) : (
        <PaperButton variant="amber" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Savings goal
        </PaperButton>
      )}

      {data.goals.length === 0 && !adding ? (
        <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
          No goals yet. Add a target, a date and what you have saved so far, and Finance works out the monthly contribution and whether your recent cash flow gets you there.
        </p>
      ) : null}

      {goals.length > 0 ? (
        <PaperSection label="Goals" count={goals.length}>
          <div className="grid gap-4 xl:grid-cols-2">
            {goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} data={data} readOnly={sample && goal.id.startsWith("sample-")} />
            ))}
          </div>
        </PaperSection>
      ) : null}

      {funds.length > 0 ? (
        <PaperSection label="Sinking funds" count={funds.length}>
          <div className="grid gap-4 xl:grid-cols-2">
            {funds.map((goal) => (
              <GoalCard key={goal.id} goal={goal} data={data} readOnly={sample && goal.id.startsWith("sample-")} />
            ))}
          </div>
        </PaperSection>
      ) : null}

      {data.goals.some((goal) => goal.paceMonthly !== undefined) ? (
        <p className="max-w-[70ch] text-[12.5px] leading-5 text-paper-sage">
          Projections assume your free cash flow ({data.freeCashFlow === undefined ? "-" : money(data.freeCashFlow)} a month, the last three complete months) is shared evenly between the goals that have a date. It is an estimate, not a forecast.
        </p>
      ) : null}
    </div>
  );
}

function GoalCard({ goal, data, readOnly }: { goal: GoalProgress; data: FinanceData; readOnly: boolean }) {
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const [saved, setSaved] = useState(String(goal.currentAmount));
  const [finding, setFinding] = useState(false);

  const opportunityTotal = data.opportunities.reduce((total, entry) => total + entry.monthly, 0);
  const behind = goal.status === "behind" && (goal.extraMonthlyNeeded ?? 0) > 0;
  const savedValue = Number(saved);
  const savedChanged = saved.trim() !== "" && Number.isFinite(savedValue) && savedValue >= 0 && savedValue !== goal.currentAmount;

  return (
    <PaperCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-paper-display text-[19px] font-bold tracking-[-0.01em] text-paper-moss">{goal.name}</h3>
          <p className="text-[12.5px] text-paper-sage">{goal.kind === "sinking" ? "Sinking fund" : TYPE_LABEL[goal.type]}</p>
        </div>
        <Tag tone={goal.status === "behind" || goal.status === "overdue" ? "marigold" : goal.status === "no-date" ? "muted" : "green"}>{goalStatusLabel(goal)}</Tag>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Meter value={goal.progress} label={`${goal.name} funded`} tone={goal.status === "behind" || goal.status === "overdue" ? "amber" : "green"} size="md" />
        <span className="shrink-0 text-[13px] font-medium text-paper-char tabular-nums">{Math.round(goal.progress * 100)}%</span>
      </div>

      <dl className="mt-3 divide-y divide-paper-stone">
        <Line label="Target" value={money(goal.targetAmount)} />
        {goal.targetDate ? <Line label="Date" value={formatDay(goal.targetDate)} /> : null}
        <Line label="Saved" value={money(goal.currentAmount)} />
        <Line label="Remaining" value={money(goal.remaining)} />
        {goal.requiredMonthly !== undefined ? <Line strong label={goal.kind === "sinking" ? "Reserve each month" : "Required monthly contribution"} value={money(goal.requiredMonthly)} /> : null}
        {goal.projected !== undefined && goal.paceMonthly !== undefined ? <Line label="Projected at current pace" value={money(goal.projected)} /> : null}
        {goal.shortfall !== undefined && goal.paceMonthly !== undefined && goal.shortfall > 0 ? <Line strong label="Shortfall" value={money(goal.shortfall)} /> : null}
      </dl>

      {behind ? (
        <div className="mt-4">
          <PaperButton variant="ghost" onClick={() => setFinding((open) => !open)} aria-expanded={finding}>
            Find {money(goal.shortfall ?? 0)} →
          </PaperButton>
          {finding ? (
            <div className="mt-3 rounded-[4px] bg-paper-cream p-4">
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Savings opportunities</p>
              {data.opportunities.length === 0 ? (
                <p className="mt-2 text-[14px] leading-6 text-paper-char">Nothing obvious to trim yet. Rank your subscriptions and check Spending for categories running high.</p>
              ) : (
                <dl className="mt-2 divide-y divide-paper-stone">
                  {data.opportunities.map((entry) => (
                    <Line key={entry.id} label={entry.label} value={`+${money(entry.monthly)} / month`} />
                  ))}
                  <Line strong label="Potential" value={`${money(opportunityTotal)} / month`} />
                </dl>
              )}
              <p className="mt-2 text-[13px] leading-5 text-paper-char">
                This goal needs about {money(goal.extraMonthlyNeeded ?? 0)} a month more than its share of your cash flow.
                {opportunityTotal >= (goal.extraMonthlyNeeded ?? 0) && opportunityTotal > 0 ? " The opportunities above would cover it." : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <FieldLabel>Saved so far (R)</FieldLabel>
            <input type="number" min={0} step="any" inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} className={`${PAPER_INPUT} w-36`} />
          </label>
          <PaperButton variant="ghost" disabled={!savedChanged || update.isPending} onClick={() => update.mutate({ goalId: goal.id, patch: { currentAmount: savedValue } })}>
            Update
          </PaperButton>
          <PaperButton
            aria-label={`Remove ${goal.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove “${goal.name}”?`)) remove.mutate(goal.id);
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </PaperButton>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-paper-sage">A sample goal. Add your own to track real money.</p>
      )}
      <MutationError error={update.error ?? remove.error} />
    </PaperCard>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const create = useCreateGoal();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("0");
  const [date, setDate] = useState("");
  const [type, setType] = useState<GoalInput["type"]>("travel");
  const [kind, setKind] = useState<GoalInput["kind"]>("goal");

  const targetAmount = Number(target);
  const valid = name.trim().length > 0 && Number.isFinite(targetAmount) && targetAmount > 0 && Number.isFinite(Number(saved)) && Number(saved) >= 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        create.mutate(
          { name: name.trim(), targetAmount, currentAmount: Number(saved), targetDate: date || undefined, type, kind },
          { onSuccess: onDone },
        );
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <label className="block sm:col-span-2">
        <FieldLabel>Name</FieldLabel>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="UK trip" className={`${PAPER_INPUT} w-full`} maxLength={80} />
      </label>
      <label className="block">
        <FieldLabel>Target (R)</FieldLabel>
        <input required type="number" min={1} step="any" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      <label className="block">
        <FieldLabel>Saved so far (R)</FieldLabel>
        <input type="number" min={0} step="any" inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      <label className="block">
        <FieldLabel>Date</FieldLabel>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      <label className="block">
        <FieldLabel>Type</FieldLabel>
        <select value={type} onChange={(event) => setType(event.target.value as GoalInput["type"])} className={`${PAPER_INPUT} w-full`}>
          {GOAL_TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {TYPE_LABEL[entry]}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <FieldLabel>What is it?</FieldLabel>
        <select value={kind} onChange={(event) => setKind(event.target.value as GoalInput["kind"])} className={`${PAPER_INPUT} w-full`}>
          <option value="goal">A goal: a milestone I am saving toward</option>
          <option value="sinking">A sinking fund: money for an expense I know is coming</option>
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <PaperButton variant="amber" type="submit" disabled={!valid || create.isPending}>
          {create.isPending ? "Adding…" : "Add goal"}
        </PaperButton>
        <PaperButton onClick={onDone}>Cancel</PaperButton>
      </div>
      <div className="sm:col-span-2">
        <MutationError error={create.error} />
      </div>
    </form>
  );
}

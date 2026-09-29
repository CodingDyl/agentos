import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { RISK_PROFILE_INFO } from "@shared/finance-profiler";
import { GOAL_TYPES, type FinanceData, type GoalInput, type GoalProgress } from "@shared/finance-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useCreateGoal, useDeleteGoal, useUpdateGoal } from "@/lib/agentos/finance";
import { MiniBar } from "./finance-badges";
import { CloseButton, FoldCard, FoldControls } from "./finance-fold";
import { GoalProfiler } from "./finance-goal-profiler";
import { Line, MutationError } from "./finance-kit";
import { formatDay, goalStatusLabel, money } from "./finance-model";
import { useDismiss, useFold } from "./finance-ui-hooks";

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
  const [profiling, setProfiling] = useState(false);
  const goals = data.goals.filter((goal) => goal.kind === "goal");
  const funds = data.goals.filter((goal) => goal.kind === "sinking");
  const sample = data.source.kind === "sample";
  // A goal that is behind or past its date starts open. The rest fold away once there are more than three.
  const fold = useFold(
    data.goals.map((goal) => goal.id),
    (id) => {
      const goal = data.goals.find((entry) => entry.id === id);
      return goal?.status === "behind" || goal?.status === "overdue" || data.goals.length <= 3;
    },
  );

  return (
    <div className="space-y-12">
      {/* Both buttons stay put while a panel is open, so closing it can hand focus back to the one that opened it. */}
      <div className="flex flex-wrap gap-2">
        <PaperButton variant="amber" onClick={() => setAdding(true)} aria-expanded={adding} disabled={adding}>
          <Plus className="size-3.5" aria-hidden="true" />
          Savings goal
        </PaperButton>
        <PaperButton variant="ghost" onClick={() => setProfiling((open) => !open)} aria-expanded={profiling}>
          Goal profiler
        </PaperButton>
      </div>

      {adding ? (
        <PaperCard className="max-w-2xl p-5">
          <GoalForm onDone={() => setAdding(false)} />
        </PaperCard>
      ) : null}

      {profiling ? <NewGoalProfiler today={data.today} onClose={() => setProfiling(false)} /> : null}

      {data.goals.length === 0 && !adding ? (
        <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
          No goals yet. Add a target, a date and what you have saved so far, and Finance works out the monthly contribution and whether your recent cash flow gets you there.
        </p>
      ) : null}

      {goals.length > 0 ? (
        <PaperSection
          label="Goals"
          count={goals.length}
          action={<FoldControls count={goals.length} allOpen={goals.every((goal) => fold.isOpen(goal.id))} onSetAll={(open) => fold.setAll(open, goals.map((goal) => goal.id))} />}
        >
          <ul className="space-y-3">
            {goals.map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} data={data} open={fold.isOpen(goal.id)} onToggle={() => fold.toggle(goal.id)} readOnly={sample && goal.id.startsWith("sample-")} />
              </li>
            ))}
          </ul>
        </PaperSection>
      ) : null}

      {funds.length > 0 ? (
        <PaperSection
          label="Sinking funds"
          count={funds.length}
          action={<FoldControls count={funds.length} allOpen={funds.every((goal) => fold.isOpen(goal.id))} onSetAll={(open) => fold.setAll(open, funds.map((goal) => goal.id))} />}
        >
          <ul className="space-y-3">
            {funds.map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} data={data} open={fold.isOpen(goal.id)} onToggle={() => fold.toggle(goal.id)} readOnly={sample && goal.id.startsWith("sample-")} />
              </li>
            ))}
          </ul>
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

function GoalCard({ goal, data, open, onToggle, readOnly }: { goal: GoalProgress; data: FinanceData; open: boolean; onToggle: () => void; readOnly: boolean }) {
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const [saved, setSaved] = useState(String(goal.currentAmount));
  const [finding, setFinding] = useState(false);
  const [profiling, setProfiling] = useState(false);

  const opportunityTotal = data.opportunities.reduce((total, entry) => total + entry.monthly, 0);
  const behind = goal.status === "behind" && (goal.extraMonthlyNeeded ?? 0) > 0;
  const savedValue = Number(saved);
  const savedChanged = saved.trim() !== "" && Number.isFinite(savedValue) && savedValue >= 0 && savedValue !== goal.currentAmount;

  const worry = goal.status === "behind" || goal.status === "overdue";

  return (
    <FoldCard
      open={open}
      onToggle={onToggle}
      accent={worry ? "amber" : goal.status === "done" || goal.status === "on-track" ? "green" : "none"}
      title={goal.name}
      meta={
        <>
          <Tag tone={worry ? "marigold" : goal.status === "no-date" ? "muted" : "green"}>{goalStatusLabel(goal)}</Tag>
          <span>{goal.kind === "sinking" ? "Sinking fund" : TYPE_LABEL[goal.type]}</span>
          <MiniBar value={goal.progress} label={`${goal.name} is ${Math.round(goal.progress * 100)}% funded`} tone={worry ? "amber" : "green"} />
        </>
      }
      figure={
        <>
          <span className="block font-paper-display text-[20px] leading-6 font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">{Math.round(goal.progress * 100)}%</span>
          <span className="block text-[12px] text-paper-sage tabular-nums">
            {money(goal.currentAmount)} of {money(goal.targetAmount)}
          </span>
        </>
      }
    >
      <dl className="divide-y divide-paper-stone">
        <Line label="Target" value={money(goal.targetAmount)} />
        {goal.targetDate ? <Line label="Date" value={formatDay(goal.targetDate)} /> : null}
        <Line label="Saved" value={money(goal.currentAmount)} />
        <Line label="Remaining" value={money(goal.remaining)} />
        {goal.riskProfile ? (
          <Line label="Held as" value={`${RISK_PROFILE_INFO[goal.riskProfile].label} · ${((goal.assumedReturn ?? 0) * 100).toFixed(1).replace(/\.0$/, "")}% assumed`} />
        ) : null}
        {goal.requiredMonthly !== undefined ? <Line strong label={goal.kind === "sinking" ? "Reserve each month" : "Required monthly contribution"} value={money(goal.requiredMonthly)} /> : null}
        {goal.requiredMonthlyNoGrowth !== undefined && (goal.assumedReturn ?? 0) > 0 ? <Line label="With no growth at all" value={money(goal.requiredMonthlyNoGrowth)} /> : null}
        {goal.projected !== undefined && goal.paceMonthly !== undefined ? <Line label="Projected at current pace" value={money(goal.projected)} /> : null}
        {goal.shortfall !== undefined && goal.paceMonthly !== undefined && goal.shortfall > 0 ? <Line strong label="Shortfall" value={money(goal.shortfall)} /> : null}
      </dl>

      {behind ? (
        <div className="mt-4">
          <PaperButton variant="ghost" onClick={() => setFinding((open) => !open)} aria-expanded={finding}>
            Find {money(goal.shortfall ?? 0)} →
          </PaperButton>
          {finding ? (
            <div className="mt-3 rounded-none bg-paper-cream p-4">
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

      {goal.status !== "done" && goal.status !== "no-date" && goal.status !== "overdue" && goal.targetDate ? (
        <div className="mt-4">
          <PaperButton variant="ghost" onClick={() => setProfiling((open) => !open)} aria-expanded={profiling}>
            {goal.riskProfile ? "Change profile" : "Profile this goal"}
          </PaperButton>
        </div>
      ) : null}
      {profiling && goal.targetDate ? (
        <div className="mt-4">
          <GoalProfiler
            today={data.today}
            start={{ name: goal.name, target: goal.targetAmount, saved: goal.currentAmount, date: goal.targetDate, type: goal.type, riskProfile: goal.riskProfile, annualReturn: goal.annualReturn }}
            applyLabel={readOnly ? "Sample goal" : "Use this for the goal"}
            applyDisabled={readOnly || update.isPending}
            onApply={(applied) =>
              update.mutate(
                { goalId: goal.id, patch: { riskProfile: applied.profile, annualReturn: applied.annualReturn ?? null } },
                { onSuccess: () => setProfiling(false) },
              )
            }
            onClose={() => setProfiling(false)}
          />
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
    </FoldCard>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const create = useCreateGoal();
  useDismiss(onDone);
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
      aria-label="New savings goal"
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <h2 className="font-paper-display text-[17px] font-bold text-paper-moss">New savings goal</h2>
        <CloseButton label="Close the new goal form" onClick={onDone} showLabel />
      </div>
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

/** The profiler on its own: try a goal, then keep it as a goal if it looks right. */
function NewGoalProfiler({ today, onClose }: { today: string; onClose: () => void }) {
  const create = useCreateGoal();
  const [name, setName] = useState("");

  return (
    <div>
      <label className="mb-4 block max-w-md">
        <FieldLabel>Name (needed to save it as a goal)</FieldLabel>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="House deposit" className={`${PAPER_INPUT} w-full`} maxLength={80} />
      </label>
      <GoalProfiler
        today={today}
        applyLabel={create.isPending ? "Saving…" : "Save as a goal"}
        applyDisabled={name.trim().length === 0 || create.isPending}
        onApply={(applied) =>
          create.mutate(
            { name: name.trim(), targetAmount: applied.target, currentAmount: applied.saved, targetDate: applied.date, type: applied.type, kind: "goal", riskProfile: applied.profile, annualReturn: applied.annualReturn },
            { onSuccess: onClose },
          )
        }
        onClose={onClose}
      />
      <MutationError error={create.error} />
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  ASSUMED_INFLATION,
  compareProfiles,
  inflateTarget,
  monthsBetween,
  recommendProfile,
  RISK_PROFILE_INFO,
  type ProfilerAnswers,
  type RiskProfile,
} from "@shared/finance-profiler";
import { GOAL_TYPES, type GoalType } from "@shared/finance-types";
import { FieldLabel, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { cn } from "@/lib/utils";
import { CloseButton } from "./finance-fold";
import { useDismiss } from "./finance-ui-hooks";
import { money } from "./finance-model";

/**
 * The goal profiler.
 *
 * Three questions (how long, how you would react to a fall, how firm the date
 * is) suggest how the goal's money could be held. Each profile then shows what
 * it would ask of you each month, with the growth it assumes.
 *
 * The suggested returns are illustrative assumptions and are editable: nobody
 * knows what markets will do. It describes how money could be held ("mostly
 * cash", "mostly growth assets") and never names a fund, a share or a product,
 * because which one suits you depends on things AgentOS does not know. It
 * cannot buy or move anything.
 */

export interface ProfilerStart {
  name?: string;
  target?: number;
  saved?: number;
  /** `YYYY-MM-DD`. */
  date?: string;
  type?: GoalType;
  riskProfile?: RiskProfile;
  annualReturn?: number;
}

export interface ProfilerApplied {
  profile: RiskProfile;
  /** Set only when you changed the assumed return from the profile's default. */
  annualReturn?: number;
  /** What the profiler was looking at, for creating a goal from it. */
  target: number;
  saved: number;
  date: string;
  type: GoalType;
}

const TYPE_LABEL: Record<GoalType, string> = { travel: "Travel", emergency: "Emergency fund", purchase: "Purchase", investment: "Investment", other: "Other" };

const REACTIONS: readonly { value: ProfilerAnswers["reaction"]; label: string }[] = [
  { value: "sell", label: "Sell, to stop the fall" },
  { value: "hold", label: "Sit tight" },
  { value: "add", label: "Buy more" },
];

const pct = (value: number) => `${(value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1)}%`;

export function GoalProfiler({
  today,
  start,
  applyLabel,
  applyDisabled,
  onApply,
  onClose,
}: {
  today: string;
  start?: ProfilerStart;
  applyLabel: string;
  applyDisabled?: boolean;
  onApply: (applied: ProfilerApplied) => void;
  onClose: () => void;
}) {
  useDismiss(onClose);

  const initialDate = start?.date ?? (() => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString().slice(0, 10);
  })();

  const [target, setTarget] = useState(start?.target === undefined ? "" : String(start.target));
  const [saved, setSaved] = useState(String(start?.saved ?? 0));
  const [date, setDate] = useState(initialDate);
  const [type, setType] = useState<GoalType>(start?.type ?? "other");
  const [reaction, setReaction] = useState<ProfilerAnswers["reaction"]>("hold");
  const [firm, setFirm] = useState<ProfilerAnswers["date"]>("flexible");
  const [inflation, setInflation] = useState(false);
  const [picked, setPicked] = useState<RiskProfile | undefined>(start?.riskProfile);
  const [returnDraft, setReturnDraft] = useState(start?.annualReturn === undefined ? "" : String(+(start.annualReturn * 100).toFixed(2)));

  const targetValue = Number(target);
  const savedValue = Number(saved);
  const valid = Number.isFinite(targetValue) && targetValue > 0 && Number.isFinite(savedValue) && savedValue >= 0 && date > today;
  const months = valid ? monthsBetween(today, date) : 0;

  const recommendation = useMemo(() => (valid ? recommendProfile({ months, goalType: type, reaction, date: firm }) : undefined), [valid, months, type, reaction, firm]);
  const chosen = picked ?? recommendation?.profile;

  const effectiveTarget = valid && inflation ? inflateTarget(targetValue, ASSUMED_INFLATION, months) : targetValue;

  // An override of the return applies to the chosen profile only.
  const overrideValue = returnDraft.trim() === "" ? undefined : Number(returnDraft) / 100;
  const overrideValid = overrideValue !== undefined && Number.isFinite(overrideValue) && overrideValue >= 0 && overrideValue <= 0.3;
  const rows = useMemo(
    () => (valid ? compareProfiles({ target: effectiveTarget, saved: savedValue, months, returns: chosen && overrideValid ? { [chosen]: overrideValue } : undefined }) : []),
    [valid, effectiveTarget, savedValue, months, chosen, overrideValid, overrideValue],
  );

  const years = months / 12;
  const horizon = years >= 2 ? `${years.toFixed(years % 1 === 0 ? 0 : 1)} years` : `${months} ${months === 1 ? "month" : "months"}`;

  return (
    <div className="rounded-none border border-paper-mist bg-paper-cream p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-paper-display text-[18px] font-bold tracking-[-0.01em] text-paper-moss">Goal profiler</h3>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-6 text-paper-char">
            Work out how much to put aside each month, and how the money could be held to get there. Returns are assumptions you can change, not forecasts.
          </p>
        </div>
        <CloseButton label="Close the profiler" onClick={onClose} showLabel />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <FieldLabel>Target (R)</FieldLabel>
          <input type="number" min={1} step="any" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} className={`${PAPER_INPUT} w-full`} />
        </label>
        <label className="block">
          <FieldLabel>Saved so far (R)</FieldLabel>
          <input type="number" min={0} step="any" inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} className={`${PAPER_INPUT} w-full`} />
        </label>
        <label className="block">
          <FieldLabel>Date you need it</FieldLabel>
          <input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} className={`${PAPER_INPUT} w-full`} />
        </label>
        <label className="block">
          <FieldLabel>What is it for?</FieldLabel>
          <select value={type} onChange={(event) => setType(event.target.value as GoalType)} className={`${PAPER_INPUT} w-full`}>
            {GOAL_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {TYPE_LABEL[entry]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">If the money fell 20% a year before you needed it, you would</legend>
          <div className="flex flex-wrap gap-2">
            {REACTIONS.map((option) => (
              <label key={option.value} className={cn("cursor-pointer rounded-none border px-3 py-1.5 text-[13.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-paper-blue", reaction === option.value ? "border-paper-moss bg-paper-white font-semibold text-paper-moss" : "border-paper-mist text-paper-char hover:bg-paper-white")}>
                <input type="radio" name="reaction" value={option.value} checked={reaction === option.value} onChange={() => setReaction(option.value)} className="sr-only" />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">The date</legend>
          <div className="flex flex-wrap gap-2">
            {(["firm", "flexible"] as const).map((option) => (
              <label key={option} className={cn("cursor-pointer rounded-none border px-3 py-1.5 text-[13.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-paper-blue", firm === option ? "border-paper-moss bg-paper-white font-semibold text-paper-moss" : "border-paper-mist text-paper-char hover:bg-paper-white")}>
                <input type="radio" name="firmness" value={option} checked={firm === option} onChange={() => setFirm(option)} className="sr-only" />
                {option === "firm" ? "Cannot move" : "Can wait a year or two"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13.5px] text-paper-char">
        <input type="checkbox" checked={inflation} onChange={(event) => setInflation(event.target.checked)} className="size-4" />
        Treat the target as today's money and adjust it for {pct(ASSUMED_INFLATION)} a year inflation
        {valid && inflation ? <span className="text-paper-sage"> (target becomes {money(effectiveTarget)})</span> : null}
      </label>

      {!valid ? (
        <p className="mt-6 text-[13.5px] leading-6 text-paper-char">Enter a target and a date in the future to see what each way of holding the money would ask of you.</p>
      ) : (
        <>
          {recommendation ? (
            <div className="mt-6 rounded-none bg-paper-white p-4">
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Suggested for {horizon}</p>
              <p className="mt-1 font-paper-display text-[20px] font-bold text-paper-moss">{RISK_PROFILE_INFO[recommendation.profile].label}</p>
              <p className="text-[13.5px] text-paper-char">{RISK_PROFILE_INFO[recommendation.profile].holds}</p>
              <ul className="mt-2 space-y-1">
                {recommendation.reasons.map((reason) => (
                  <li key={reason} className="text-[13.5px] leading-6 text-paper-char">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-none border border-paper-mist bg-paper-white">
            <table className="w-full min-w-[40rem] text-left text-[14px]">
              <thead className="bg-paper-linen text-[12.5px] text-paper-char">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Held as</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Assumed return</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Save each month</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">If returns disappoint</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">You pay in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-stone tabular-nums">
                {rows.map((row) => {
                  const info = RISK_PROFILE_INFO[row.profile];
                  const selected = chosen === row.profile;
                  return (
                    <tr key={row.profile} className={cn(selected && "bg-paper-cream")}>
                      <th scope="row" className="px-4 py-3 align-top">
                        <label className="flex cursor-pointer items-start gap-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-paper-blue">
                          <input type="radio" name="profile" checked={selected} onChange={() => { setPicked(row.profile); setReturnDraft(""); }} className="mt-1 size-4" />
                          <span>
                            <span className="flex flex-wrap items-center gap-2 font-semibold text-paper-moss">
                              {info.label}
                              {recommendation?.profile === row.profile ? <Tag tone="green">Suggested</Tag> : null}
                            </span>
                            <span className="block text-[12.5px] font-normal text-paper-sage">{info.swings}</span>
                          </span>
                        </label>
                      </th>
                      <td className="px-4 py-3 text-right align-top text-paper-char">{pct(row.annualReturn)}</td>
                      <td className="px-4 py-3 text-right align-top font-semibold text-paper-moss">{money(row.monthly)}</td>
                      <td className="px-4 py-3 text-right align-top text-paper-char">{money(row.monthlyIfLower)}</td>
                      <td className="px-4 py-3 text-right align-top text-paper-char">
                        {money(row.totalPaidIn)}
                        <span className="block text-[12.5px] text-paper-sage">{Math.round(row.growthShare * 100)}% from growth</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {chosen ? (
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="block">
                <FieldLabel>Assumed return for {RISK_PROFILE_INFO[chosen].label} (% a year)</FieldLabel>
                <input type="number" min={0} max={30} step="0.1" inputMode="decimal" value={returnDraft} onChange={(event) => setReturnDraft(event.target.value)} placeholder={String(+(RISK_PROFILE_INFO[chosen].annualReturn * 100).toFixed(2))} className={`${PAPER_INPUT} w-40`} />
              </label>
              <PaperButton
                variant="ghost"
                disabled={applyDisabled || (returnDraft.trim() !== "" && !overrideValid)}
                onClick={() => onApply({ profile: chosen, annualReturn: overrideValid ? overrideValue : undefined, target: targetValue, saved: savedValue, date, type })}
              >
                {applyLabel}
              </PaperButton>
            </div>
          ) : null}

          <ul className="mt-5 max-w-[80ch] space-y-1.5 text-[12.5px] leading-5 text-paper-sage">
            <li>The returns are illustrative assumptions, not forecasts, and real returns can be lower, or negative in a bad year. "If returns disappoint" shows the monthly amount if the return comes in {`${Math.round(RISK_PROFILE_INFO[chosen ?? "balanced"].downside * 100)}`} points lower.</li>
            <li>This describes how money could be held. It does not name a fund, a share or a product, and it is not financial advice. Which one suits you depends on your other savings, tax and needs.</li>
            <li>Nothing here can buy or move money. Contributions are amounts to put aside, and you make the transfer yourself.</li>
          </ul>
        </>
      )}
    </div>
  );
}

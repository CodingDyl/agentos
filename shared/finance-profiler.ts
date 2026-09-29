/**
 * The goal profiler: how much to put aside each month to reach a goal, given
 * how the money is held.
 *
 * Pure arithmetic, shared by the server (which stores a goal's profile and
 * reports its progress) and the page (which lets you try profiles live). No
 * clock, no network, no model.
 *
 * The returns below are ASSUMPTIONS, and they are illustrative rather than
 * forecasts: nobody knows what markets will do. They are deliberately editable
 * per goal, and the page says so. What the profiler will not do is name a
 * fund, a share or a product. It describes how a goal's money could be held
 * ("mostly cash", "mostly growth assets"), because which product suits you
 * depends on things AgentOS does not know.
 */

export const RISK_PROFILES = ["cash", "conservative", "balanced", "growth"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export interface RiskProfileInfo {
  label: string;
  /** How the money would be held, in words, never a product. */
  holds: string;
  /** Assumed annual return, as a fraction. Illustrative. */
  annualReturn: number;
  /** How much worse than assumed a bad stretch could plausibly be, in return points. */
  downside: number;
  /** How far the value can fall in a bad year, as a plain-words warning. */
  swings: string;
}

export const RISK_PROFILE_INFO: Record<RiskProfile, RiskProfileInfo> = {
  cash: {
    label: "Cash",
    holds: "Savings, notice deposits and money-market style holdings",
    annualReturn: 0.065,
    downside: 0.01,
    swings: "Almost never loses value",
  },
  conservative: {
    label: "Conservative",
    holds: "Mostly cash and bonds with a small share of shares",
    annualReturn: 0.08,
    downside: 0.03,
    swings: "Can dip a few percent in a bad year",
  },
  balanced: {
    label: "Balanced",
    holds: "A mix of shares, bonds and cash",
    annualReturn: 0.095,
    downside: 0.04,
    swings: "Can fall 10-15% in a bad year",
  },
  growth: {
    label: "Growth",
    holds: "Mostly shares, local and global",
    annualReturn: 0.11,
    downside: 0.06,
    swings: "Can fall 25% or more in a bad year",
  },
};

export const isRiskProfile = (value: unknown): value is RiskProfile => typeof value === "string" && (RISK_PROFILES as readonly string[]).includes(value);

const round = (value: number) => Math.round(value);

/** Months from `from` to `to` (both `YYYY-MM-DD`), never less than one. */
export function monthsBetween(from: string, to: string): number {
  const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.ceil(days / 30.4375));
}

/** What `amount` grows to over `months` at an annual rate, compounded monthly. */
export function futureValueOfLump(amount: number, annualReturn: number, months: number): number {
  return amount * (1 + annualReturn / 12) ** months;
}

/** What a monthly contribution grows to over `months`, paid at each month's end. */
export function futureValueOfContributions(monthly: number, annualReturn: number, months: number): number {
  const rate = annualReturn / 12;
  if (rate === 0) return monthly * months;
  return (monthly * ((1 + rate) ** months - 1)) / rate;
}

/**
 * The monthly contribution that turns what you have saved into the target by
 * the date, at an assumed return. Zero when what is saved already grows there
 * by itself.
 */
export function requiredMonthly(input: { target: number; saved: number; annualReturn: number; months: number }): number {
  const { target, saved, annualReturn, months } = input;
  const needed = target - futureValueOfLump(saved, annualReturn, months);
  if (needed <= 0) return 0;

  const rate = annualReturn / 12;
  const factor = rate === 0 ? months : ((1 + rate) ** months - 1) / rate;
  return needed / factor;
}

export interface ProfilerAnswers {
  /** Months to the goal date. */
  months: number;
  goalType: "travel" | "emergency" | "purchase" | "investment" | "other";
  /**
   * What you would do if the money fell 20% a year before you needed it.
   * `sell`: sell to stop the fall. `hold`: sit tight. `add`: buy more.
   */
  reaction: "sell" | "hold" | "add";
  /** `firm`: the date cannot move. `flexible`: it can wait a year or two. */
  date: "firm" | "flexible";
}

export interface ProfileRecommendation {
  profile: RiskProfile;
  reasons: string[];
}

const STEP = (profile: RiskProfile, by: number): RiskProfile => RISK_PROFILES[Math.max(0, Math.min(RISK_PROFILES.length - 1, RISK_PROFILES.indexOf(profile) + by))];

/**
 * Which profile fits, and why, in order.
 *
 * Time is the main driver, because a fall needs time to recover: under two
 * years there is none, over ten there is plenty. Your reaction and the firmness
 * of the date can only pull the answer down (or, if you would hold or buy more
 * on a long horizon, up one step): the profiler is meant to stop you taking a
 * risk you would abandon at the worst moment, not to talk you into one.
 */
export function recommendProfile(answers: ProfilerAnswers): ProfileRecommendation {
  const reasons: string[] = [];

  if (answers.goalType === "emergency") {
    return { profile: "cash", reasons: ["An emergency fund has to be there the day you need it, so it belongs in cash whatever the horizon."] };
  }

  let profile: RiskProfile;
  if (answers.months < 24) {
    profile = "cash";
    reasons.push("Under two years there is no time to recover from a fall, so the money stays in cash.");
  } else if (answers.months < 60) {
    profile = "conservative";
    reasons.push("Two to five years is short for shares: a bad year near the date could leave you short.");
  } else if (answers.months < 120) {
    profile = "balanced";
    reasons.push("Five to ten years leaves room for some growth assets and time to ride out a fall.");
  } else {
    profile = "growth";
    reasons.push("Ten years or more is long enough for growth assets to recover from a bad year.");
  }

  if (answers.reaction === "sell") {
    const lower = STEP(profile, -1);
    if (lower !== profile) reasons.push("You would sell after a 20% fall. That locks the loss in, so a calmer profile is safer for you.");
    profile = lower;
  } else if (answers.reaction === "add" && answers.months >= 60 && profile !== "growth") {
    profile = STEP(profile, 1);
    reasons.push("You would hold or buy more after a fall, and there is time, so one step more growth is reasonable.");
  }

  if (answers.date === "firm") {
    const lower = STEP(profile, -1);
    if (lower !== profile) reasons.push("The date cannot move, so a fall close to it matters more. One step calmer.");
    profile = lower;
  }

  return { profile, reasons };
}

export interface ProfileProjection {
  profile: RiskProfile;
  annualReturn: number;
  /** Monthly contribution at the assumed return. */
  monthly: number;
  /** Monthly contribution if the return comes in lower (a bad stretch). */
  monthlyIfLower: number;
  /** The total you would pay in, before growth. */
  totalPaidIn: number;
  /** What growth is doing of the target, at the assumed return. */
  growthShare: number;
}

/** What each profile would ask of you, side by side. */
export function compareProfiles(input: { target: number; saved: number; months: number; returns?: Partial<Record<RiskProfile, number>> }): ProfileProjection[] {
  return RISK_PROFILES.map((profile) => {
    const info = RISK_PROFILE_INFO[profile];
    const annualReturn = input.returns?.[profile] ?? info.annualReturn;
    const monthly = requiredMonthly({ target: input.target, saved: input.saved, annualReturn, months: input.months });
    const lower = requiredMonthly({ target: input.target, saved: input.saved, annualReturn: Math.max(0, annualReturn - info.downside), months: input.months });
    const totalPaidIn = monthly * input.months;
    const growth = input.target - input.saved - totalPaidIn;

    return {
      profile,
      annualReturn,
      monthly: round(monthly),
      monthlyIfLower: round(lower),
      totalPaidIn: round(totalPaidIn),
      growthShare: input.target > 0 ? Math.max(0, growth) / input.target : 0,
    };
  });
}

/** A target in tomorrow's rand: what today's amount will cost after inflation. */
export function inflateTarget(target: number, annualInflation: number, months: number): number {
  return target * (1 + annualInflation) ** (months / 12);
}

/** Assumed inflation, offered as an option and never applied silently. */
export const ASSUMED_INFLATION = 0.05;

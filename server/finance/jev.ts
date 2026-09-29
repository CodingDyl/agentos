import { createHash } from "node:crypto";
import type { Category, JevSubscriptionAssessment, Subscription } from "../../shared/finance-types";
import { CATEGORIES, SUBSCRIPTION_KINDS } from "../../shared/finance-types";
import { answerAs, isJevConfigured, JEV_MODEL, JevError, sendToJev, type JevRequestBody, type JevText } from "../mail/jev-client";
import { merchantKey } from "./categorise";
import { readAssessments, saveAssessment } from "./store";

/**
 * Jev's part of Finance: a second opinion on a subscription, never a decision.
 *
 * Jev is asked narrow questions about facts Finance already calculated. It is
 * never asked "how much did I save" (that is a subtraction) and never given
 * anything it does not need. What crosses to it is a merchant name, an amount,
 * a rhythm and a price history. Not an account number, a login, a balance, a
 * transaction id or a date more precise than a month.
 *
 * Its answer says what deserves a review. Whether the money stays is yours: a
 * "keep" from you is stored and Finance stops raising that subscription.
 */

/**
 * Removes anything that looks like an identifier from text bound for a model.
 * Merchant strings are already cleaned, so this is the last line of defence
 * rather than the first: long digit runs (card and account numbers), emails,
 * and IBAN-shaped strings do not leave this process.
 */
export function stripIdentifiers(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "")
    .replace(/\d[\d\s-]{5,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The facts about one subscription that a model may see. */
export function subscriptionFacts(subscription: Subscription, others: readonly Subscription[]) {
  return {
    merchant: stripIdentifiers(subscription.merchant),
    charge_per_period: Math.round(subscription.frequency === "annual" ? subscription.annual : subscription.monthly),
    frequency: subscription.frequency,
    currency: "ZAR",
    payments_seen: subscription.payments,
    ...(subscription.previousAmount === undefined ? {} : { previous_charge: Math.round(subscription.previousAmount) }),
    other_recurring_services: others.filter((other) => other.merchant !== subscription.merchant).map((other) => stripIdentifiers(other.merchant)),
  };
}

/** The signature of a subscription's facts: when it changes, the old assessment is stale. */
export function assessmentSignature(subscription: Subscription): string {
  return createHash("sha256")
    .update(`${merchantKey(subscription.merchant)}|${subscription.frequency}|${Math.round(subscription.monthly)}|${subscription.previousAmount ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

const SCALE = (low: string, high: string): JevText[] => [low, "Unlikely", "Uncertain", "Likely", high];

const clampScale = (value: number) => Math.max(1, Math.min(5, Math.round(value)));

export function buildAssessmentRequest(subscription: Subscription, others: readonly Subscription[]): JevRequestBody {
  return {
    model: JEV_MODEL,
    state: {
      subscription: subscriptionFacts(subscription, others),
      owner: { role: "A person watching their own spending, in South African rand" },
    },
    questions: {
      recurring: {
        type: "noul",
        instructions: "Is `subscription` a genuine recurring service the owner pays for, rather than a repeat purchase at a shop?",
        criteria: { true: "A service billed on a schedule (software, streaming, membership, hosting)", false: "Repeat purchases that only happen to look regular" },
      },
      kind: {
        type: "choice",
        instructions: "Which kind of service is `subscription`?",
        criteria: {
          software: "Apps and creative or productivity software",
          entertainment: "Streaming, music, games",
          business: "Hosting, infrastructure, business tools",
          fitness: "Gym or health memberships",
          finance: "Financial products and services",
          other: "None of the above",
        },
      },
      essential: {
        type: "score",
        instructions: "How likely is `subscription` to be essential to the owner's work or household?",
        criteria: SCALE("Certainly optional", "Certainly essential"),
      },
      underused: {
        type: "score",
        instructions: "How likely is it that a typical person paying this much for `subscription` is underusing it, so that it is worth reviewing?",
        criteria: SCALE("Certainly well used", "Certainly underused"),
      },
      duplicate: {
        type: "noul",
        instructions: "Does `subscription` largely overlap another service in `other_recurring_services`?",
        criteria: { true: "Another listed service does much the same job", false: "No listed service overlaps it" },
      },
      priority: {
        type: "score",
        instructions: "How much does `subscription` deserve a cancellation review, weighing its cost against how discretionary it looks?",
        criteria: ["No review needed", "Low priority", "Worth a glance", "Worth reviewing soon", "Review first"],
      },
    },
  };
}

export async function assessSubscription(subscription: Subscription, others: readonly Subscription[]): Promise<JevSubscriptionAssessment> {
  const response = await sendToJev(buildAssessmentRequest(subscription, others));

  const recurring = answerAs(response.answers, "recurring", "noul");
  const kind = answerAs(response.answers, "kind", "choice");
  const essential = answerAs(response.answers, "essential", "score");
  const underused = answerAs(response.answers, "underused", "score");
  const duplicate = answerAs(response.answers, "duplicate", "noul");
  const priority = answerAs(response.answers, "priority", "score");

  return {
    recurring: recurring.noul >= 0.5,
    kind: (SUBSCRIPTION_KINDS as readonly string[]).includes(kind.choice) ? (kind.choice as JevSubscriptionAssessment["kind"]) : "other",
    essential: clampScale(essential.score),
    underused: clampScale(underused.score),
    duplicate: duplicate.noul >= 0.5,
    priority: clampScale(priority.score),
    confidence: Math.max(0, Math.min(1, priority.confidence)),
    assessedAt: new Date().toISOString(),
  };
}

export interface AssessmentRun {
  assessed: number;
  skipped: number;
  error?: string;
}

/**
 * Assesses every subscription whose facts have changed since Jev last looked.
 * A failure part-way keeps what was already saved and reports the reason,
 * because half an answer is still an answer and the next run finishes the rest.
 */
export async function assessSubscriptions(subscriptions: readonly Subscription[]): Promise<AssessmentRun> {
  if (!isJevConfigured()) return { assessed: 0, skipped: subscriptions.length, error: "JEV_API_KEY is not set." };

  const cached = readAssessments();
  let assessed = 0;
  let skipped = 0;

  for (const subscription of subscriptions) {
    const signature = assessmentSignature(subscription);
    if (cached.get(merchantKey(subscription.merchant))?.signature === signature) {
      skipped += 1;
      continue;
    }

    try {
      saveAssessment(subscription.merchant, signature, await assessSubscription(subscription, subscriptions));
      assessed += 1;
    } catch (error) {
      return { assessed, skipped, error: error instanceof JevError ? error.message : "Jev could not be reached." };
    }
  }

  return { assessed, skipped };
}

// ------------------------------------------------------- classification

export interface CategorySuggestion {
  category: Category;
  /** 0–1. */
  confidence: number;
  alternatives: { category: Category; confidence: number }[];
  discretionary: number;
  unusual: number;
}

const CATEGORY_MEANINGS: Record<Category, string> = {
  Income: "Money arriving: salary, client payments, refunds",
  Transfer: "Money moving between the owner's own accounts or into investments",
  Reimbursement: "Money a partner or friend sends back for a cost the owner paid for both",
  Housing: "Rent, bond or home loan, levies, rates",
  Utilities: "Electricity, water, phone, internet and other household services",
  Groceries: "Food and household shopping",
  Dining: "Restaurants, takeaways, coffee, food delivery",
  Transport: "Fuel, ride-hailing, parking, tolls, vehicle running costs",
  Debt: "Repayments on vehicle finance, personal loans and credit cards",
  Health: "Medical aid, pharmacy, doctors, dentists, gym",
  Insurance: "Car, home and life insurance premiums",
  Education: "Tuition, courses, books",
  Subscriptions: "Recurring digital services and memberships",
  Entertainment: "Cinema, events, games, betting, nights out",
  Shopping: "Clothing, electronics, online retail, general goods",
  "Personal care": "Hair, beauty, spa",
  Travel: "Flights, accommodation, car hire, trip costs",
  Giving: "Donations, gifts, tithes",
  Business: "Costs of running the owner's business: hosting, tools, tax, registration",
  Fees: "Bank fees and interest",
  Other: "Does not fit any other category",
};

/**
 * A suggested category for an ambiguous description. A suggestion only: it is
 * shown with its confidence and applied when you say so, and your correction
 * (not Jev's guess) is what Finance remembers.
 */
export async function suggestCategory(merchant: string, amount: number): Promise<CategorySuggestion> {
  const criteria: Record<string, JevText> = {};
  for (const category of CATEGORIES.filter((entry) => (amount < 0 ? entry !== "Income" : true))) criteria[category] = CATEGORY_MEANINGS[category];

  const response = await sendToJev({
    model: JEV_MODEL,
    state: {
      payment: { merchant: stripIdentifiers(merchant), amount_rand: Math.round(Math.abs(amount)), direction: amount < 0 ? "paid out" : "received" },
    },
    questions: {
      category: { type: "choice", instructions: "Which category best describes `payment`?", criteria },
      discretionary: {
        type: "noul",
        instructions: "Is `payment` discretionary, something the owner could have chosen not to spend?",
        criteria: { true: "A want rather than a need", false: "A need, a bill, or a commitment" },
      },
      unusual: {
        type: "noul",
        instructions: "Would `payment` be unusual for a typical household or small business?",
        criteria: { true: "Large or unexpected for this kind of merchant", false: "An ordinary payment to this kind of merchant" },
      },
    },
  });

  const category = answerAs(response.answers, "category", "choice");
  const discretionary = answerAs(response.answers, "discretionary", "noul");
  const unusual = answerAs(response.answers, "unusual", "noul");

  const isCategory = (value: string): value is Category => (CATEGORIES as readonly string[]).includes(value);
  const ranked = Object.entries(category.probabilities ?? {})
    .filter((entry): entry is [Category, number] => isCategory(entry[0]))
    .sort((a, b) => b[1] - a[1]);

  return {
    category: isCategory(category.choice) ? category.choice : "Other",
    confidence: Math.max(0, Math.min(1, category.confidence)),
    alternatives: ranked.slice(0, 3).map(([name, confidence]) => ({ category: name, confidence })),
    discretionary: discretionary.noul,
    unusual: unusual.noul,
  };
}

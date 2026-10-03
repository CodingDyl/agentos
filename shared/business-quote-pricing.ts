import { z } from "zod";

/**
 * Quote pricing — the same maths Virtec's quote generator uses, so a price
 * worked out here matches one worked out there.
 *
 * A project quote:
 *
 *     hours × rate × complexity × urgency × Π(feature multipliers)
 *     − discount
 *     + hosting + maintenance (once-off add-ons, not multiplied)
 *
 * A maintenance quote is a recurring charge: a locked service SKU (Care,
 * SEO, Bundle), or custom hours × rate per cycle.
 *
 * Every number is in Rand. Rounding to cents happens once, at the end.
 */

export const DEFAULT_HOURLY_RATE = 300;

export const COMPLEXITY_MULTIPLIERS = { Low: 1, Medium: 1.5, High: 2 } as const;
export const URGENCY_MULTIPLIERS = { Standard: 1, Rush: 1.2, "Extreme Rush": 1.4 } as const;

export type Complexity = keyof typeof COMPLEXITY_MULTIPLIERS;
export type Urgency = keyof typeof URGENCY_MULTIPLIERS;

/** Features that change the price. Everything else Virtec lists is a line on the quote, priced at ×1. */
export const PRICED_FEATURES = [
  { name: "Payment Gateways", multiplier: 1.5, description: "Stripe, PayPal, Yoco or similar." },
  { name: "Booking System", multiplier: 1.0, description: "Online appointment scheduling." },
  { name: "E-Commerce", multiplier: 1.8, description: "Catalogue, cart and checkout." },
  { name: "Backend Development", multiplier: 1.6, description: "Custom server logic, APIs and database." },
  { name: "Backend Integration", multiplier: 1.4, description: "Existing systems and third-party APIs." },
] as const;

export const STANDARD_FEATURES = [
  "Responsive Design",
  "Customizable",
  "SEO Friendly",
  "Analytics",
  "Security",
  "Support",
  "Maintenance",
  "Updates",
  "Backup",
  "Performance",
  "Scalability",
  "Custom Domain",
  "SSL Certificate",
  "CDN",
  "Firewall",
  "Dedicated Hosting",
  "Cloud Hosting",
  "Shared Hosting",
] as const;

/** Virtara's locked recurring SKUs, monthly, as Virtec defines them. */
export const SERVICE_SKUS = [
  { id: "care", name: "Care", monthly: 1990, includes: "Hosting, updates, backups, uptime monitoring, 2h small fixes" },
  { id: "seo", name: "SEO", monthly: 3990, includes: "Local + target keywords, Google Business Profile, monthly report" },
  { id: "bundle", name: "Bundle", monthly: 5490, includes: "Care + SEO combined retainer" },
] as const;

export type ServiceSkuId = (typeof SERVICE_SKUS)[number]["id"];

export const ISSUING_COMPANIES = ["Virtara", "Three Sixty Development", "Dylan Petzer"] as const;

export const MAINTENANCE_FREQUENCIES = ["monthly", "quarterly", "biannual", "annual"] as const;
const MONTHS: Record<(typeof MAINTENANCE_FREQUENCIES)[number], number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };
export const CYCLE: Record<(typeof MAINTENANCE_FREQUENCIES)[number], string> = { monthly: "month", quarterly: "quarter", biannual: "6 months", annual: "year" };

const money = z.number().finite().min(0).max(10_000_000);

export const ProjectQuoteInputSchema = z.object({
  kind: z.literal("project"),
  projectType: z.string().trim().min(1).max(120),
  complexity: z.enum(["Low", "Medium", "High"]).default("Medium"),
  urgency: z.enum(["Standard", "Rush", "Extreme Rush"]).default("Standard"),
  estimatedHours: z.number().finite().min(0).max(10_000),
  hourlyRate: money.default(DEFAULT_HOURLY_RATE),
  features: z.array(z.string().max(80)).max(40).default([]),
  discountType: z.enum(["none", "percentage", "hourly", "hours"]).default("none"),
  discountValue: z.number().finite().min(0).max(10_000_000).default(0),
  hostingCost: money.default(0),
  maintenanceCost: money.default(0),
});

export const MaintenanceQuoteInputSchema = z.object({
  kind: z.literal("maintenance"),
  projectType: z.string().trim().min(1).max(120).default("Website maintenance"),
  frequency: z.enum(MAINTENANCE_FREQUENCIES).default("monthly"),
  /** A locked SKU wins over custom hours. */
  serviceSku: z.enum(["care", "seo", "bundle"]).optional(),
  hoursPerCycle: z.number().finite().min(0).max(1_000).default(0),
  hourlyRate: money.default(DEFAULT_HOURLY_RATE),
  features: z.array(z.string().max(80)).max(40).default([]),
});

export const QuoteInputSchema = z.discriminatedUnion("kind", [ProjectQuoteInputSchema, MaintenanceQuoteInputSchema]);
export type ProjectQuoteInput = z.infer<typeof ProjectQuoteInputSchema>;
export type MaintenanceQuoteInput = z.infer<typeof MaintenanceQuoteInputSchema>;
export type QuoteInput = z.infer<typeof QuoteInputSchema>;

export interface QuoteLine {
  label: string;
  /** Rand for an amount; a factor for a multiplier. */
  value: number;
  type: "amount" | "multiplier" | "discount";
}

export interface QuotePrice {
  kind: QuoteInput["kind"];
  lines: QuoteLine[];
  /** Project: the once-off total. Maintenance: the charge per cycle. */
  total: number;
  /** Maintenance only: what the cycle is worth per month. */
  monthly?: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function featureMultiplier(features: readonly string[]): number {
  return PRICED_FEATURES.filter((feature) => features.includes(feature.name)).reduce((product, feature) => product * feature.multiplier, 1);
}

export function priceProjectQuote(input: ProjectQuoteInput): QuotePrice {
  const complexity = COMPLEXITY_MULTIPLIERS[input.complexity];
  const urgency = URGENCY_MULTIPLIERS[input.urgency];
  const features = featureMultiplier(input.features);
  const factor = complexity * urgency * features;

  // A discount can never take the build below zero; Virtec's maths could.
  let hours = input.estimatedHours;
  let rate = input.hourlyRate;
  if (input.discountType === "hourly") rate = Math.max(0, rate - input.discountValue);
  if (input.discountType === "hours") hours = Math.max(0, hours - input.discountValue);

  const undiscounted = input.estimatedHours * input.hourlyRate * factor;
  let build = hours * rate * factor;
  if (input.discountType === "percentage") build *= 1 - Math.min(100, input.discountValue) / 100;

  const lines: QuoteLine[] = [
    { label: `${input.estimatedHours}h × R${input.hourlyRate}`, value: cents(input.estimatedHours * input.hourlyRate), type: "amount" },
    { label: `Complexity: ${input.complexity}`, value: complexity, type: "multiplier" },
    { label: `Urgency: ${input.urgency}`, value: urgency, type: "multiplier" },
  ];
  for (const feature of PRICED_FEATURES) {
    if (input.features.includes(feature.name) && feature.multiplier !== 1) lines.push({ label: feature.name, value: feature.multiplier, type: "multiplier" });
  }
  if (input.discountType !== "none" && undiscounted > build) lines.push({ label: "Discount", value: -cents(undiscounted - build), type: "discount" });
  if (input.hostingCost > 0) lines.push({ label: "Hosting", value: cents(input.hostingCost), type: "amount" });
  if (input.maintenanceCost > 0) lines.push({ label: "Maintenance", value: cents(input.maintenanceCost), type: "amount" });

  return { kind: "project", lines, total: cents(build + input.hostingCost + input.maintenanceCost) };
}

export function priceMaintenanceQuote(input: MaintenanceQuoteInput): QuotePrice {
  const months = MONTHS[input.frequency];
  const sku = SERVICE_SKUS.find((entry) => entry.id === input.serviceSku);

  if (sku) {
    const total = cents(sku.monthly * months);
    return {
      kind: "maintenance",
      lines: [{ label: `${sku.name} at R${sku.monthly}/month × ${months}`, value: total, type: "amount" }],
      total,
      monthly: sku.monthly,
    };
  }

  const total = cents(input.hoursPerCycle * input.hourlyRate);
  return {
    kind: "maintenance",
    lines: [{ label: `${input.hoursPerCycle}h × R${input.hourlyRate} per ${CYCLE[input.frequency]}`, value: total, type: "amount" }],
    total,
    monthly: cents(total / months),
  };
}

export function priceQuote(input: QuoteInput): QuotePrice {
  return input.kind === "project" ? priceProjectQuote(input) : priceMaintenanceQuote(input);
}

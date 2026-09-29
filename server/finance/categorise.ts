import type { Category, SubscriptionKind } from "../../shared/finance-types";

/**
 * Merchant cleaning and first-pass categories.
 *
 * Bank descriptions are noise around a name: `WOOLWORTHS 00329 CAPE TOWN ZA`,
 * `CHECKERS HYPER 4451`, `APPLE.COM/BILL`. Everything downstream (recurring
 * detection, corrections, Jev) works on the merchant key, so the same shop on
 * two receipts has to reduce to the same key.
 *
 * Rules here are a starting point, in order, first match wins. They are not
 * meant to know every South African merchant: a correction beats them, and a
 * description nothing matches stays uncategorised (`Other`) rather than being
 * guessed at.
 */

const NOISE_WORDS = new Set([
  "za",
  "zaf",
  "pty",
  "ltd",
  "cpt",
  "jhb",
  "pta",
  "dbn",
  "cape",
  "town",
  "sandton",
  "pos",
  "purchase",
  "card",
  "payment",
  "debit",
  "order",
  "online",
  "www",
  "com",
  "co",
  "the",
]);

/** The merchant a bank description is about, as words: `Woolworths`, `Apple.com/bill`. */
export function cleanMerchant(description: string): string {
  const words = description
    .replace(/\.(com|co\.za|net|org|io)\b/gi, " ")
    .replace(/[*#_/]+/g, " ")
    .replace(/\b\d[\d/.-]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !NOISE_WORDS.has(word.toLowerCase()));

  // The first two words carry the name; what follows is a branch or a city.
  const kept = words.slice(0, 2).join(" ");
  if (!kept) return description.trim().slice(0, 40) || "Unknown";

  return kept
    .toLowerCase()
    .replace(/(^|[\s.])([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** The stable key for a merchant: lower-case letters only, so `Woolworths` and `WOOLWORTHS 00329` meet. */
export function merchantKey(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z]+/g, "");
}

interface Rule {
  category: Category;
  /** Matched against the lower-cased description. */
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  { category: "Transfer", pattern: /\b(discovery (bank|card|credit)|payment (received|thank you)|thank you for your payment|transfer|own account|savings? (account|pocket)|internal|pocket|easyequities|etf|unit trust|tfsa|satrix|ashburton)\b/ },
  { category: "Income", pattern: /\b(salary|payroll|wages|invoice paid|dividend|interest received|refund)\b/ },
  { category: "Housing", pattern: /\b(rent|bond|levy|levies|rates|body corporate|property|home loan|bond repayment)\b/ },
  // Debt repayments are spending (interest and capital both leave), so they sit
  // ahead of the merchant rules a lender's name could otherwise match. A home
  // loan or bond is Housing, matched just above; a car, a card or a personal
  // loan is Debt.
  { category: "Debt", pattern: /\b(wesbank|mfc|vehicle (finance|instalment|installment)|car (finance|instalment|installment|payment)|instal{1,2}ment|loan (repayment|instalment|payment)|personal loan|study loan|credit card (payment|repayment)|card repayment|tymebank loan|capitec loan|african bank|direct axis|finbond|dialdirect finance)\b/ },
  { category: "Utilities", pattern: /\b(eskom|electricity|prepaid elec|city of|municipal|water|vodacom|mtn|telkom|cell c|rain|afrihost|vumatel|openserve|fibre|webafrica|internet|airtime|data bundle|dstv|multichoice)\b/ },
  // Medical aid is Health. It has to come before Insurance, whose pattern
  // would otherwise take "Discovery Health" for a car premium.
  { category: "Health", pattern: /\b(discovery health|medical aid|momentum health|bonitas|gems|medshield|fedhealth|profmed|bestmed|medihelp|clicks|dis-?chem|pharmacy|doctor|dr |dentist|optometr|hospital|medi|virgin active|planet fitness|gym|wellness|physio|pathcare|lancet)\b/ },
  { category: "Insurance", pattern: /\b(discovery insure|discovery|outsurance|sanlam|old mutual|hollard|santam|insurance|assurance|momentum|king price|miway|budget insurance|dial ?direct)\b/ },
  { category: "Education", pattern: /\b(university|unisa|varsity|college|school fees|tuition|udemy|coursera|skillshare|masterclass|textbook|exam fee|school)\b/ },
  { category: "Groceries", pattern: /\b(woolworths food|woolworths|checkers|shoprite|pick n pay|pnp|spar|food lover|makro|fruit & veg|butchery|cambridge food|boxer)\b/ },
  { category: "Dining", pattern: /\b(restaurant|uber ?eats|mr d|mrd|kfc|nando'?s?|steers|wimpy|mcdonald'?s?|burger|sushi|pizza|cafe|coffee|starbucks|vida|bistro|grill|takeaway|deli|roman'?s|debonairs)\b/ },
  { category: "Transport", pattern: /\b(engen|shell|bp |sasol|caltex|total|petrol|fuel|uber|bolt|gautrain|e-?toll|parking|toll|taxi|lyft|tracker|car wash|tyre|tyres|auto|service plan)\b/ },
  // Recurring digital services. Streaming is here, not under Entertainment:
  // it is a subscription first, and the Subscriptions tab is where you decide about it.
  { category: "Subscriptions", pattern: /\b(netflix|spotify|showmax|disney|apple\.com\/bill|apple\.com|apple bill|google (one|storage|workspace)|youtube|adobe|microsoft|office 365|dropbox|notion|github|openai|anthropic|chatgpt|canva|figma|playstation|xbox|amazon prime|icloud|1password|zoom|slack|vercel|linear|audible|kindle unlimited)\b/ },
  { category: "Entertainment", pattern: /\b(ster-?kinekor|nu metro|cinema|movies?|computicket|ticketpro|webtickets|quicket|concert|theatre|theater|festival|bowling|arcade|casino|hollywoodbets|betway|sportingbet|steam|epic games|nintendo|club|pub|tavern|museum|zoo|escape room|golf|topgolf|sun international)\b/ },
  { category: "Personal care", pattern: /\b(salon|barber|hair|spa|nails|beauty|sorbet|lash|massage|cosmetic|the body shop|mac cosmetics|clinique)\b/ },
  { category: "Giving", pattern: /\b(donation|donate|charity|church|tithe|gift|sanparks conservation|givengain|rise against hunger|spca|unicef|wwf)\b/ },
  { category: "Travel", pattern: /\b(airline|flysafair|british airways|emirates|kulula|lift|airbnb|booking\.com|hotel|lodge|travelstart|expedia|hostel|virgin atlantic|car hire|avis|budget rent|europcar|hertz|visa fee|vfs)\b/ },
  { category: "Business", pattern: /\b(aws|amazon web|digitalocean|cloudflare|namecheap|godaddy|hetzner|sars|cipc|accounting|domain|hosting|xero|quickbooks|stripe|paystack|payfast)\b/ },
  { category: "Fees", pattern: /\b(interest|fee|charge|service charge|monthly account|admin fee|cash handling|overdraft|interest charged)\b/ },
  { category: "Shopping", pattern: /\b(takealot|amazon|superbalist|zara|h&m|mr price|cotton on|game|builders|incredible connection|onedayonly|temu|shein|loot|pep|ackermans|edgars|decathlon|ikea|hifi corp|jet|foschini|tfg|sportscene)\b/ },
];

/** The built-in category for a description, or undefined when no rule recognises it. */
export function ruleCategory(description: string, amount: number): Category | undefined {
  const text = description.toLowerCase();

  // Money arriving is income unless it is plainly a transfer or a refund from a shop.
  if (amount > 0) {
    const match = RULES.find((rule) => (rule.category === "Transfer" || rule.category === "Income") && rule.pattern.test(text));
    return match ? match.category : "Income";
  }

  const match = RULES.find((rule) => rule.category !== "Income" && rule.pattern.test(text));
  return match?.category;
}

const KIND_RULES: readonly { kind: SubscriptionKind; pattern: RegExp }[] = [
  { kind: "entertainment", pattern: /netflix|spotify|showmax|disney|youtube|playstation|xbox|dstv|prime|apple tv|twitch/i },
  { kind: "fitness", pattern: /virgin|planet fitness|gym|fitness|wellness|strava|whoop/i },
  { kind: "finance", pattern: /easyequities|investec|ynab|bank|insurance|outsurance/i },
  { kind: "business", pattern: /aws|amazon web|digitalocean|cloudflare|hetzner|vercel|domain|hosting|slack|zoom|xero|quickbooks|linear/i },
  { kind: "software", pattern: /adobe|microsoft|office|dropbox|notion|github|openai|anthropic|chatgpt|canva|figma|icloud|google|1password|apple|jetbrains/i },
];

/** A first guess at what a subscription is. Jev's answer replaces it once asked. */
export function guessSubscriptionKind(merchant: string): SubscriptionKind {
  return KIND_RULES.find((rule) => rule.pattern.test(merchant))?.kind ?? "other";
}

/** Money moved into investments: not spending, and counted as the monthly contribution. */
export function isInvestmentTransfer(description: string): boolean {
  return /\b(easyequities|etf|unit trust|tfsa|satrix|ashburton|invest(ment)? (account|contribution))\b/i.test(description);
}

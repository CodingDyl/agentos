/**
 * Where a page loses the visitors a business already paid to bring there.
 *
 * Not "is the site modern" but "can someone who arrives ready to buy call or
 * book without hunting, and do they see why to trust them". Read from the
 * HTML alone, so each is a reason to look, never a verdict: a page built by
 * scripts can hide a button the markup does not show.
 */

export interface GoogleReviews {
  rating: number;
  count: number;
}

export interface ConversionLeaks {
  /** What leaks, in plain words an owner can check on their phone, worst first. */
  leaks: string[];
  /** The ad networks whose tracking is on the page: a sign they pay for the traffic. */
  advertising: string[];
}

/** Below this, showing the rating would not help them, so its absence is no leak. */
const RATING_WORTH_SHOWING = 4.3;
const REVIEWS_WORTH_SHOWING = 20;
/** A call or book button only reached after this much of the page's words is too far down. */
const FAR_DOWN_SHARE = 0.6;
const FAR_DOWN_MIN_CHARS = 800;

const BOOKING_PLATFORMS = /(calendly\.com|setmore\.com|booksy\.com|fresha\.com|simplybook\.|vagaro\.com|timely\.|acuityscheduling\.com|squareup\.com\/appointments|youcanbook\.me|cal\.com|zocdoc\.com|healthbridge|dentally|gettimely)/i;
const BOOKING_WORDS = /\b(book(?:\s+(?:now|online|an?\s+appointment|a\s+consult(?:ation)?|a\s+visit))?|booking|appointment|schedule|get\s+a\s+quote|request\s+a\s+quote|free\s+quote|quote\s+now|enquire\s+now|consultation|reserve)\b/i;
const REVIEW_PROOF = /(google\s+reviews?|\breviews?\b|★|⭐|&#9733;|\b[1-5][.,]\d\s*(?:stars?|\/\s*5|out\s+of\s+5)|trustindex|elfsight|reviewsonmywebsite|trustpilot|hellopeter|testimonials?)/i;

const ADS: readonly [string, RegExp][] = [
  ["Google Ads", /(googleadservices\.com|gtag\(\s*['"]config['"]\s*,\s*['"]AW-|['"]AW-\d{6,}|google_conversion_id)/i],
  ["Meta", /(connect\.facebook\.net\/[^"']*fbevents|fbq\(\s*['"]init['"])/i],
  ["TikTok", /analytics\.tiktok\.com/i],
  ["LinkedIn", /snap\.licdn\.com/i],
];

const textOf = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");

/** Every link and button, in page order, with where it sits in the page's words. */
function actions(body: string): { at: number; href: string; label: string }[] {
  const out: { at: number; href: string; label: string }[] = [];
  let words = 0;
  let last = 0;
  for (const match of body.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    words += body.slice(last, match.index).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").length;
    last = match.index;
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match[2])?.[1] ?? "";
    const label = `${match[3].replace(/<[^>]*>/g, " ")} ${/\b(?:aria-label|title|value)\s*=\s*["']([^"']*)["']/i.exec(match[2])?.[1] ?? ""}`.replace(/\s+/g, " ").trim();
    out.push({ at: words, href, label });
  }
  return out;
}

const isCall = (action: { href: string }) => /^(tel:|https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(action.href);
const isBook = (action: { href: string; label: string }) => BOOKING_PLATFORMS.test(action.href) || BOOKING_WORDS.test(action.label);

export function conversionLeaks(html: string, reviews?: GoogleReviews): ConversionLeaks {
  const body = textOf(html);
  const total = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").length;
  const found = actions(body);
  const hasForm = /<form\b/i.test(body);
  const bookable = found.some(isBook) || BOOKING_PLATFORMS.test(html);
  const leaks: string[] = [];

  if (!bookable && !hasForm) leaks.push("No way to book or ask for a quote online: a visitor ready to buy has to phone");
  else if (!bookable) leaks.push("No Book or Get a quote button: visitors have to find the contact form themselves");

  const first = found.find((action) => isCall(action) || isBook(action));
  if (first && total >= FAR_DOWN_MIN_CHARS && first.at / total >= FAR_DOWN_SHARE) {
    leaks.push("The first call or book button is far down the page, after most of the content");
  }

  if (reviews && reviews.rating >= RATING_WORTH_SHOWING && reviews.count >= REVIEWS_WORTH_SHOWING && !REVIEW_PROOF.test(body)) {
    leaks.push(`Hides its ${reviews.rating}-star rating from ${reviews.count} Google reviews: the site never mentions them`);
  }

  return { leaks, advertising: ADS.filter(([, pattern]) => pattern.test(html)).map(([name]) => name) };
}

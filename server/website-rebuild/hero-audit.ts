import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { HeroMetrics } from "./compositions";
import type { ConceptId, DesignFingerprint, DirectionAssignment } from "./design-fingerprints";

/**
 * Measures the heroes in a real browser, because the critique used to read their
 * source. It scored concepts on fonts that never loaded and layouts it never saw.
 *
 * Everything here that fails a concept is a fact from the page: whether its fonts
 * loaded, whether it delivered the composition and navigation it was assigned,
 * whether it is the same skeleton as another concept or an earlier run, and
 * whether Impeccable's anti-pattern detector flags it as AI slop.
 */

const execute = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DETECTOR = path.join(APP_ROOT, "node_modules/impeccable/cli/bin/cli.js");

export const AUDIT_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const SKELETON_COLUMNS = 24;
const SKELETON_ROWS = 15;
/** At or above this share of matching cells, two heroes are the same page in different clothes. Calibrated on twelve real law-firm heroes. */
export const SAME_SKELETON = 0.45;
/** At or above this share of shared words, two headlines say the same thing. */
export const SAME_HEADLINE = 0.6;
/** Letters can touch an image on purpose. Past this share of the headline hidden, it stops being readable. */
export const HEADLINE_COVERED = 0.2;

/** Runs in the page, as a string so the compiler adds no helpers of its own to it. */
const COLLECT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const toRect = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
  const inView = (r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const shown = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.02; };
  const familyOf = (el) => getComputedStyle(el).fontFamily.split(",")[0].trim().replace(/["']/g, "").toLowerCase();
  const loaded = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "").toLowerCase()))];
  const h1El = document.querySelector("h1");
  const h1 = h1El ? { text: h1El.innerText.trim().replace(/\\s+/g, " "), words: h1El.innerText.trim().split(/\\s+/).filter(Boolean).length, px: parseFloat(getComputedStyle(h1El).fontSize), family: familyOf(h1El), rect: toRect(h1El.getBoundingClientRect()) } : undefined;
  const bodyEl = [...document.querySelectorAll("p, li")].find((el) => el.innerText && el.innerText.trim().length > 20) || document.body;
  const all = [...document.querySelectorAll("body *")].slice(0, 2500);
  const media = [];
  for (const el of all) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inView(r)) continue;
    const big = r.width * r.height >= vw * vh * 0.04;
    const tag = el.tagName.toLowerCase();
    if (el.closest("[data-hero-logo]")) continue;
    if (el.hasAttribute("data-hero-media") || (big && ["img", "video", "canvas", "picture"].includes(tag)) || (big && tag === "svg") || (big && /url\\(/.test(getComputedStyle(el).backgroundImage))) media.push({ ...toRect(r), kind: tag });
  }
  const cell = { w: vw / 48, h: vh / 30 };
  const covered = (rects) => { let hits = 0; for (let y = 0; y < 30; y++) for (let x = 0; x < 48; x++) { const cx = (x + 0.5) * cell.w, cy = (y + 0.5) * cell.h; if (rects.some((r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height)) hits++; } return hits / (48 * 30); };
  const textRects = [];
  for (const el of all) {
    if (!shown(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) if (inView(r)) textRects.push(toRect(r));
  }
  const grid = [];
  for (let y = 0; y < ${SKELETON_ROWS}; y++) {
    let row = "";
    for (let x = 0; x < ${SKELETON_COLUMNS}; x++) {
      const cx = ((x + 0.5) * vw) / ${SKELETON_COLUMNS}, cy = ((y + 0.5) * vh) / ${SKELETON_ROWS};
      const within = (r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
      row += textRects.some(within) ? "t" : media.some(within) ? "m" : ".";
    }
    grid.push(row);
  }
  const rectOf = (selector) => { const el = document.querySelector(selector); if (!el || !shown(el)) return undefined; const r = el.getBoundingClientRect(); return inView(r) ? toRect(r) : undefined; };
  const logo = rectOf("[data-hero-logo]") || rectOf("header img") || rectOf("nav img");
  const seen = new Set();
  const navLinks = [...document.querySelectorAll("nav a, nav button")].filter((el) => { if (!shown(el) || el.closest("[data-hero-row]") || el.closest("[data-hero-logo]") || el.querySelector("img")) return false; const r = el.getBoundingClientRect(); return inView(r); }).map((el) => toRect(el.getBoundingClientRect())).filter((r) => { const k = Math.round(r.x) + ":" + Math.round(r.y); if (seen.has(k)) return false; seen.add(k); return true; });
  const rows = [...document.querySelectorAll("[data-hero-row]")].filter(shown).map((el) => el.getBoundingClientRect()).filter(inView).map(toRect);
  const intakeEl = document.querySelector("[data-intake]");
  const intake = intakeEl && shown(intakeEl) ? { choices: intakeEl.querySelectorAll("button, a[href], input[type=radio], option, [role=option], [role=radio]").length, rect: toRect(intakeEl.getBoundingClientRect()) } : undefined;
  const wideBand = all.some((el) => { if (!el.innerText || el.innerText.trim().length < 3) return false; const r = el.getBoundingClientRect(); return r.width > vw * 1.2 && r.top < vh && r.bottom > 0 && parseFloat(getComputedStyle(el).fontSize) >= 48; });
  let headlineCovered = 0;
  if (h1El) {
    const range = document.createRange();
    range.selectNodeContents(h1El);
    const boxes = [...range.getClientRects()].filter(inView);
    const points = boxes.flatMap((r) => [0.15, 0.4, 0.65, 0.9].map((share) => [r.left + r.width * share, r.top + r.height / 2]));
    const hidden = points.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !(h1El === hit || h1El.contains(hit) || hit.contains(h1El)); }).length;
    headlineCovered = points.length === 0 ? 0 : hidden / points.length;
  }
  return {
    viewport: { width: vw, height: vh },
    headlineCovered,
    h1,
    fonts: { loaded, headlineLoaded: Boolean(h1) && loaded.includes(h1.family), bodyLoaded: loaded.includes(familyOf(bodyEl)) },
    overflowX: document.documentElement.scrollWidth > vw + 2 && getComputedStyle(document.documentElement).overflowX !== "hidden" && getComputedStyle(document.body).overflowX !== "hidden",
    mediaCoverage: covered(media),
    media,
    canvasCoverage: covered(media.filter((m) => m.kind === "canvas")),
    rows,
    intake,
    wideBand,
    logo,
    navLinks,
    cta: rectOf("[data-hero-cta]"),
    skeleton: grid.join("\\n"),
  };
})()`;

const MOTION_PROBE = `(document.getAnimations().length > 0 || Boolean(window.gsap && window.gsap.globalTimeline && window.gsap.globalTimeline.getChildren().length > 0))`;

/** One hero at one size, as a visitor's browser would see it once it has settled. */
async function measure(browser: import("@playwright/test").Browser, file: string, size: { width: number; height: number }): Promise<HeroMetrics> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (/^(https?|wss?):/.test(request.url())) remoteRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 45_000 });
    const early = Boolean(await page.evaluate(MOTION_PROBE));
    await page.evaluate("document.fonts.ready.then(() => true)");
    await page.waitForTimeout(1_800);
    const late = Boolean(await page.evaluate(MOTION_PROBE));
    const metrics = (await page.evaluate(COLLECT)) as Omit<HeroMetrics, "remoteRequests" | "errors" | "motionSeen">;
    return { ...metrics, remoteRequests, errors, motionSeen: early || late };
  } finally {
    await context.close();
  }
}

export interface DetectorFinding {
  id: string;
  name: string;
  slop: boolean;
  snippet: string;
}

/** Impeccable's detector: deterministic, no model involved. Its exit code 2 only means it found something. */
export async function detectSlop(file: string): Promise<DetectorFinding[]> {
  let stdout: string;
  try {
    ({ stdout } = await execute(process.execPath, [DETECTOR, "detect", "--json", "--no-config", "--no-advisory", file], { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? "");
    if (!stdout.trim()) return [];
  }
  try {
    const parsed = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf("[")))) as { antipattern?: string; name?: string; category?: string; snippet?: string }[];
    return parsed.map((entry) => ({ id: entry.antipattern ?? "unknown", name: entry.name ?? entry.antipattern ?? "Finding", slop: entry.category === "slop", snippet: entry.snippet ?? "" }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ judging

/** How much two heroes occupy the same cells with the same kind of thing. */
export function skeletonSimilarity(a: string, b: string): number {
  const cells = (text: string) => text.replace(/\n/g, "");
  const first = cells(a);
  const second = cells(b);
  let same = 0;
  let either = 0;
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    if (first[index] === "." && second[index] === ".") continue;
    either += 1;
    if (first[index] === second[index]) same += 1;
  }
  return either === 0 ? 0 : same / either;
}

const STOP_WORDS = new Set(["a", "an", "and", "the", "of", "in", "for", "to", "with", "your", "you", "we", "our", "at", "on", "is", "by"]);
const wordsOf = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word && !STOP_WORDS.has(word)));

/** The share of words two headlines have in common. */
export function headlineOverlap(a: string, b: string): number {
  const first = wordsOf(a);
  const second = wordsOf(b);
  if (first.size === 0 || second.size === 0) return 0;
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / Math.min(first.size, second.size);
}

export interface MeasuredConcept {
  concept: ConceptId;
  desktop?: HeroMetrics;
  mobile?: HeroMetrics;
  findings: DetectorFinding[];
  /** The hero could not be opened at all. */
  error?: string;
}

export interface ConceptAudit {
  concept: ConceptId;
  /** Facts that send the concept back. */
  failures: string[];
  /** Worth the critic's and the person's attention, but not a failure. */
  warnings: string[];
  skeleton?: string;
  headline?: string;
  headlineFont?: string;
}

/** What the measurements mean for each concept. Pure, so it is tested without a browser. */
export function judgeConcepts(measured: readonly MeasuredConcept[], assignments: readonly DirectionAssignment[], prior: readonly Pick<DesignFingerprint, "skeleton" | "runId" | "concept">[] = []): ConceptAudit[] {
  const audits: ConceptAudit[] = [];
  for (const entry of measured) {
    const failures: string[] = [];
    const warnings: string[] = [];
    const assignment = assignments.find((item) => item.concept === entry.concept);
    const { desktop, mobile } = entry;
    if (entry.error || !desktop) {
      audits.push({ concept: entry.concept, failures: [`The hero could not be opened in a browser${entry.error ? `: ${entry.error}` : ""}.`], warnings });
      continue;
    }
    if (desktop.headlineCovered >= HEADLINE_COVERED) failures.push(`Something covers ${Math.round(desktop.headlineCovered * 100)}% of the headline at 1440px wide, so it cannot be read.`);
    if (mobile && mobile.headlineCovered >= HEADLINE_COVERED) failures.push(`Something covers ${Math.round(mobile.headlineCovered * 100)}% of the headline at 390px wide, so it cannot be read.`);
    if (!desktop.h1) failures.push("The page has no h1.");
    else if (!desktop.fonts.headlineLoaded) failures.push(`The headline renders in "${desktop.h1.family}", which the page did not load. Load the assigned face through fonts.css.`);
    if (!desktop.fonts.bodyLoaded) warnings.push("The body text renders in a face the page did not load.");
    if (desktop.remoteRequests.length > 0) failures.push(`It asks the internet for files: ${[...new Set(desktop.remoteRequests)].slice(0, 3).join(", ")}. Use the kit's local files.`);
    if (desktop.errors.length > 0) failures.push(`Its script throws: ${desktop.errors[0]}`);
    if (!desktop.cta) failures.push("Nothing is marked data-hero-cta, or the call to action is not on the first screen.");
    if (mobile?.overflowX) failures.push("It scrolls sideways at 390px wide.");
    if (mobile && !mobile.cta) warnings.push("The call to action is not on the first screen at 390px wide.");
    if (mobile?.h1 && !mobile.fonts.headlineLoaded) failures.push("The headline's face does not load at 390px wide.");
    if (assignment) {
      const composition = assignment.composition.check(desktop);
      if (composition) failures.push(`Not the assigned composition (${assignment.composition.name}): ${composition}.`);
      const nav = assignment.nav.check(desktop);
      if (nav) failures.push(`Not the assigned navigation (${assignment.nav.name}): ${nav}.`);
      if (assignment.motion.id !== "still-with-grain" && !desktop.motionSeen && desktop.canvasCoverage === 0) warnings.push(`No motion was seen, and ${assignment.motion.name} was assigned.`);
    }
    // The detector reads source for this one, and a headline sized by script reads as body size. The browser knows better.
    const realFindings = entry.findings.filter((finding) => !(finding.id === "flat-type-hierarchy" && (desktop.h1?.px ?? 0) >= 40));
    for (const finding of realFindings.filter((item) => item.slop)) failures.push(`Slop detector: ${finding.name}${finding.snippet ? ` (${finding.snippet.slice(0, 120)})` : ""}.`);
    // One line per kind, however many elements have it: twelve identical warnings hide the one that matters.
    const others = new Map<string, DetectorFinding[]>();
    for (const finding of realFindings.filter((item) => !item.slop)) others.set(finding.name, [...(others.get(finding.name) ?? []), finding]);
    for (const [name, group] of others) warnings.push(`Detector: ${name}${group.length > 1 ? ` (${group.length} places)` : ""}${group[0].snippet ? `, such as ${group[0].snippet.slice(0, 100)}` : ""}.`);

    // Each concept answers for what came before it, so one failure is not reported twice.
    for (const other of audits) {
      if (other.skeleton && skeletonSimilarity(desktop.skeleton, other.skeleton) >= SAME_SKELETON) failures.push(`The same page layout as ${other.concept}: the two occupy the screen in the same way.`);
      if (other.headline && desktop.h1 && headlineOverlap(desktop.h1.text, other.headline) >= SAME_HEADLINE) failures.push(`The same headline angle as ${other.concept} ("${other.headline}").`);
    }
    const repeated = prior.find((old) => old.skeleton && skeletonSimilarity(desktop.skeleton, old.skeleton) >= SAME_SKELETON);
    if (repeated) failures.push(`The same page layout as an earlier concept in this niche (${repeated.concept} of another run).`);

    audits.push({ concept: entry.concept, failures, warnings, skeleton: desktop.skeleton, headline: desktop.h1?.text, headlineFont: desktop.h1?.family });
  }
  return audits;
}

/** Opens each hero in Chromium at both widths and runs the detector over it. */
export async function measureConcepts(repo: string, concepts: readonly ConceptId[]): Promise<MeasuredConcept[]> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const measured: MeasuredConcept[] = [];
    for (const concept of concepts) {
      const file = path.join(repo, "design", concept, "hero.html");
      try {
        const desktop = await measure(browser, file, AUDIT_VIEWPORTS.desktop);
        const mobile = await measure(browser, file, AUDIT_VIEWPORTS.mobile);
        measured.push({ concept, desktop, mobile, findings: await detectSlop(file) });
      } catch (error) {
        measured.push({ concept, findings: [], error: error instanceof Error ? error.message.split("\n")[0] : "unknown error" });
      }
    }
    return measured;
  } finally {
    await browser.close();
  }
}

export function auditReport(audits: readonly ConceptAudit[]): string {
  return [
    "# Rendered audit of the hero concepts",
    "",
    "Measured by AgentOS in Chromium at 1440px and 390px, and by Impeccable's anti-pattern detector. These are facts about the page, not opinions.",
    "",
    ...audits.flatMap((audit) => [
      `## ${audit.concept}`,
      "",
      ...(audit.headline ? [`Headline: ${audit.headline}`, `Headline face: ${audit.headlineFont ?? "unknown"}`, ""] : []),
      audit.failures.length > 0 ? "Failures:" : "Failures: none",
      ...audit.failures.map((failure) => `- ${failure}`),
      ...(audit.warnings.length > 0 ? ["", "Warnings:", ...audit.warnings.map((warning) => `- ${warning}`)] : []),
      "",
    ]),
  ].join("\n");
}

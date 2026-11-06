import { createHash } from "node:crypto";
import { HERO_CONCEPTS, type RebuildRun } from "../../shared/website-rebuild-types";
import { COMPOSITIONS, COMPOSITION_BY_ID, MOTION_BY_ID, MOTION_SIGNATURES, NAV_BY_ID, NAV_PATTERNS, type Composition, type CompositionFamily, type MotionSignature, type NavPattern } from "./compositions";
import { DESIGN_DIRECTIONS, DIRECTION_BY_ID, RUBRIC_PASS, directionPairs, type DesignDirection, type NicheCliches } from "./design-directions";
import { decide, rebuildDatabase } from "./store";

/**
 * What each run's hero concepts looked like: direction, fonts, dominant
 * palette and hero layout. Kept in `website-rebuild.db` so the next run in
 * the same niche or market is assigned something else, and the critique can
 * reject a concept that repeats an earlier one.
 */

export type ConceptId = (typeof HERO_CONCEPTS)[number];

export interface DirectionAssignment {
  concept: ConceptId;
  direction: DesignDirection;
  /** Far from the niche on purpose. Concept C always is. */
  wildcard: boolean;
  /** The faces AgentOS seeds for this concept. */
  pair: { display: string; text: string };
  composition: Composition;
  nav: NavPattern;
  motion: MotionSignature;
}

export interface DesignFingerprint {
  runId: string;
  concept: ConceptId;
  niche: string;
  market: string;
  direction: string;
  wildcard: boolean;
  paletteFamily: string;
  displayFont?: string;
  textFont?: string;
  palette: string[];
  heroLayout?: string;
  composition?: string;
  nav?: string;
  motion?: string;
  pairDisplay?: string;
  pairText?: string;
  generation: number;
  /** The occupancy map the audit measured on the rendered hero. */
  skeleton?: string;
  headline?: string;
  score?: number;
  passed?: boolean;
  autoRevised: boolean;
  escalated: boolean;
  reason?: string;
}

/** The target market as a key: "Homeowners in Cape Town!" and "homeowners in cape town" are the same market. */
export const marketKey = (market: string) => market.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const fontKey = (font: string | undefined) => (font ?? "").toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ").trim();
const pairKey = (display: string | undefined, text: string | undefined) => `${fontKey(display)}|${fontKey(text)}`;

/** The pair a fingerprint used: what its DESIGN.md said, or its direction's when it said nothing. */
function fingerprintPair(fingerprint: Pick<DesignFingerprint, "direction" | "displayFont" | "textFont">): string {
  const direction = DIRECTION_BY_ID.get(fingerprint.direction);
  return pairKey(fingerprint.displayFont ?? direction?.type.display, fingerprint.textFont ?? direction?.type.text);
}

/** A stable number per run and direction, so assignment is the same on every retry. */
function seeded(runId: string, salt: string): number {
  return createHash("sha256").update(`${runId}:${salt}`).digest().readUInt32BE(0);
}

/**
 * How much a direction repeats what earlier runs in the niche used. Zero means
 * nothing in common. Same direction weighs most, then the font pair, then the
 * dominant palette family.
 */
export function repetition(direction: DesignDirection, prior: readonly Pick<DesignFingerprint, "direction" | "displayFont" | "textFont" | "paletteFamily">[]): number {
  const pair = pairKey(direction.type.display, direction.type.text);
  let score = 0;
  for (const entry of prior) {
    if (entry.direction === direction.id) score += 4;
    if (fingerprintPair(entry) === pair) score += 2;
    if (entry.paletteFamily === direction.palette.family) score += 1;
  }
  return score;
}

/** Rank by how much an option has been used, then by the run's seed, so nothing is a favourite. */
function ranked<T extends { id: string }>(pool: readonly T[], seed: string, used: (id: string) => number): T[] {
  return [...pool].sort((a, b) => used(a.id) - used(b.id) || seeded(seed, a.id) - seeded(seed, b.id) || a.id.localeCompare(b.id));
}

export interface AssignOptions {
  /** Each "new concepts" is a new generation of the run, with its own picks. */
  generation?: number;
  /** The latest concepts in any niche: what the person last saw, whatever the business. */
  recent?: readonly Pick<DesignFingerprint, "composition" | "nav" | "motion">[];
}

/**
 * Three different concepts for a run, from the run id. Directions, font pairs and
 * palette families already used by earlier runs in the same niche or market are
 * excluded while anything unused is left; after that the least used come first.
 * Concept C is always a wildcard: a direction whose reference is far from the niche.
 *
 * Composition, navigation and motion are picked separately from the direction, one
 * composition from each family (image, type, interaction), so the three are
 * different pages rather than three colourings of one.
 */
export function assignDirections(runId: string, niche: NicheCliches, prior: readonly DesignFingerprint[], options: AssignOptions = {}): DirectionAssignment[] {
  const generation = options.generation ?? 1;
  const seed = generation === 1 ? runId : `${runId}:${generation}`;
  const recent = options.recent ?? [];
  const avoid = new Set(niche.avoid ?? []);
  const allowed = DESIGN_DIRECTIONS.filter((direction) => !avoid.has(direction.id));
  const rank = (pool: readonly DesignDirection[]) => [...pool].sort((a, b) => repetition(a, prior) - repetition(b, prior) || seeded(seed, a.id) - seeded(seed, b.id) || a.id.localeCompare(b.id));
  const wildcardPool = allowed.filter((direction) => niche.wildcards.includes(direction.id));
  const wildcard = rank(wildcardPool)[0] ?? rank(allowed)[0];
  const chosen: DesignDirection[] = [];
  for (const direction of rank(allowed.filter((entry) => entry.id !== wildcard.id))) {
    // Within a run too: no two concepts share a font pair or palette family.
    const clash = [wildcard, ...chosen].some((other) => other.palette.family === direction.palette.family || pairKey(other.type.display, other.type.text) === pairKey(direction.type.display, direction.type.text));
    if (clash) continue;
    chosen.push(direction);
    if (chosen.length === 2) break;
  }

  // The niche counts most; what the person saw lately counts too, whatever the business was.
  const usage = (field: "composition" | "nav" | "motion") => (id: string) => prior.filter((entry) => entry[field] === id).length * 3 + recent.filter((entry) => entry[field] === id).length;
  const families: CompositionFamily[] = ["image", "type", "interaction"];
  const compositions = families.map((family) => ranked(COMPOSITIONS.filter((entry) => entry.family === family), seed, usage("composition"))[0]);
  const order = [...compositions].sort((a, b) => seeded(seed, `order-${a.id}`) - seeded(seed, `order-${b.id}`));
  const navs = ranked(NAV_PATTERNS, seed, usage("nav"));
  const motions = ranked(MOTION_SIGNATURES, seed, usage("motion"));

  const usedPairs = prior.map((entry) => fingerprintPair(entry));
  const pairFor = (direction: DesignDirection) => [...directionPairs(direction)].sort((a, b) => usedPairs.filter((pair) => pair === pairKey(a.display, a.text)).length - usedPairs.filter((pair) => pair === pairKey(b.display, b.text)).length || seeded(seed, a.display) - seeded(seed, b.display))[0];
  const concept = (id: ConceptId, direction: DesignDirection, isWildcard: boolean, index: number): DirectionAssignment => ({ concept: id, direction, wildcard: isWildcard, pair: pairFor(direction), composition: order[index], nav: navs[index], motion: motions[index] });
  return [concept("concept-a", chosen[0], false, 0), concept("concept-b", chosen[1], false, 1), concept("concept-c", wildcard, true, 2)];
}

interface Row {
  run_id: string;
  concept: string;
  niche: string;
  market: string;
  direction: string;
  wildcard: number;
  palette_family: string;
  display_font: string | null;
  text_font: string | null;
  palette: string;
  hero_layout: string | null;
  score: number | null;
  passed: number | null;
  auto_revised: number;
  escalated: number;
  reason: string | null;
  composition: string | null;
  nav: string | null;
  motion: string | null;
  pair_display: string | null;
  pair_text: string | null;
  generation: number | null;
  skeleton: string | null;
  headline: string | null;
}

function toFingerprint(row: Row): DesignFingerprint {
  let palette: string[];
  try {
    const parsed: unknown = JSON.parse(row.palette);
    palette = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    palette = [];
  }
  return {
    runId: row.run_id,
    concept: row.concept as ConceptId,
    niche: row.niche,
    market: row.market,
    direction: row.direction,
    wildcard: row.wildcard === 1,
    paletteFamily: row.palette_family,
    displayFont: row.display_font ?? undefined,
    textFont: row.text_font ?? undefined,
    palette,
    heroLayout: row.hero_layout ?? undefined,
    composition: row.composition ?? undefined,
    nav: row.nav ?? undefined,
    motion: row.motion ?? undefined,
    pairDisplay: row.pair_display ?? undefined,
    pairText: row.pair_text ?? undefined,
    generation: row.generation ?? 1,
    skeleton: row.skeleton ?? undefined,
    headline: row.headline ?? undefined,
    score: row.score ?? undefined,
    passed: row.passed === null ? undefined : row.passed === 1,
    autoRevised: row.auto_revised === 1,
    escalated: row.escalated === 1,
    reason: row.reason ?? undefined,
  };
}

export function runFingerprints(runId: string): DesignFingerprint[] {
  return (rebuildDatabase().prepare("SELECT * FROM design_fingerprints WHERE run_id = ? ORDER BY concept").all(runId) as unknown as Row[]).map(toFingerprint);
}

/**
 * Earlier concepts in the same niche (unless the niche is unknown) or the same
 * target market, and concepts this run itself threw away with "new concepts".
 */
export function priorFingerprints(runId: string, niche: string, market: string): DesignFingerprint[] {
  const rows = rebuildDatabase()
    .prepare(
      `SELECT * FROM design_fingerprints WHERE run_id != ? AND ((niche = ? AND niche != 'general') OR market = ?)
       UNION ALL SELECT * FROM design_fingerprint_history WHERE run_id = ? OR (niche = ? AND niche != 'general') OR market = ?
       ORDER BY created_at`,
    )
    .all(runId, niche, marketKey(market), runId, niche, marketKey(market)) as unknown as Row[];
  return rows.map(toFingerprint);
}

/** The latest concepts in any niche, for composition, navigation and motion: what the person last looked at. */
function recentFingerprints(runId: string, limit = 12): DesignFingerprint[] {
  const rows = rebuildDatabase()
    .prepare("SELECT * FROM (SELECT * FROM design_fingerprints UNION ALL SELECT * FROM design_fingerprint_history) WHERE run_id != ? ORDER BY updated_at DESC LIMIT ?")
    .all(runId, limit) as unknown as Row[];
  return rows.map(toFingerprint);
}

/**
 * The run's assignment: the stored one if there is one, so a retry or a change
 * request keeps its directions, otherwise a new one, recorded at once so a
 * run started in parallel in the same niche sees it.
 */
export function ensureAssignments(run: Pick<RebuildRun, "id" | "targetMarket">, niche: NicheCliches, now = new Date()): DirectionAssignment[] {
  const stored = runFingerprints(run.id);
  const prior = priorFingerprints(run.id, niche.id, run.targetMarket);
  const recent = recentFingerprints(run.id);
  const known = stored.map((entry) => ({ entry, direction: DIRECTION_BY_ID.get(entry.direction) })).filter((item): item is { entry: DesignFingerprint; direction: DesignDirection } => Boolean(item.direction));
  const db = rebuildDatabase();
  const at = now.toISOString();
  const axes = db.prepare("UPDATE design_fingerprints SET composition = ?, nav = ?, motion = ?, pair_display = ?, pair_text = ? WHERE run_id = ? AND concept = ?");
  if (known.length === HERO_CONCEPTS.length) {
    // A run from before these axes keeps its directions and gets the rest now.
    const generation = known[0].entry.generation;
    const fill = assignDirections(run.id, niche, prior, { generation, recent });
    return known.map(({ entry, direction }, index) => {
      const assignment: DirectionAssignment = {
        concept: entry.concept,
        direction,
        wildcard: entry.wildcard,
        pair: entry.pairDisplay && entry.pairText ? { display: entry.pairDisplay, text: entry.pairText } : { display: direction.type.display, text: direction.type.text },
        composition: COMPOSITION_BY_ID.get(entry.composition ?? "") ?? fill[index].composition,
        nav: NAV_BY_ID.get(entry.nav ?? "") ?? fill[index].nav,
        motion: MOTION_BY_ID.get(entry.motion ?? "") ?? fill[index].motion,
      };
      if (!entry.composition) axes.run(assignment.composition.id, assignment.nav.id, assignment.motion.id, assignment.pair.display, assignment.pair.text, run.id, entry.concept);
      return assignment;
    });
  }
  const archived = db.prepare("SELECT MAX(generation) AS generation FROM design_fingerprint_history WHERE run_id = ?").get(run.id) as { generation: number | null } | undefined;
  const generation = (archived?.generation ?? 0) + 1;
  const assignments = assignDirections(run.id, niche, prior, { generation, recent });
  const insert = db.prepare(
    `INSERT INTO design_fingerprints (run_id, concept, niche, market, direction, wildcard, palette_family, palette, composition, nav, motion, pair_display, pair_text, generation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, concept) DO UPDATE SET niche = excluded.niche, market = excluded.market, direction = excluded.direction, wildcard = excluded.wildcard, palette_family = excluded.palette_family, composition = excluded.composition, nav = excluded.nav, motion = excluded.motion, pair_display = excluded.pair_display, pair_text = excluded.pair_text, generation = excluded.generation, updated_at = excluded.updated_at`,
  );
  for (const assignment of assignments) {
    insert.run(run.id, assignment.concept, niche.id, marketKey(run.targetMarket), assignment.direction.id, assignment.wildcard ? 1 : 0, assignment.direction.palette.family, assignment.composition.id, assignment.nav.id, assignment.motion.id, assignment.pair.display, assignment.pair.text, generation, at, at);
  }
  return assignments;
}

/**
 * The person wants different concepts, not better versions of these. Records the
 * decision, then moves the current concepts to history: the next hero run is
 * assigned new ones and avoids these as if another run had used them.
 */
export function startFreshConcepts(runId: string, revision: number, note?: string, conceptNotes?: Record<string, string | undefined>): void {
  decide(runId, "hero", revision, "changes_requested", note?.trim() || "Start again: new art directions, new compositions and a new headline angle. Do not build on the previous concepts.", undefined, conceptNotes);
  const db = rebuildDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO design_fingerprint_history SELECT * FROM design_fingerprints WHERE run_id = ?").run(runId);
    db.prepare("DELETE FROM design_fingerprints WHERE run_id = ?").run(runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** What the audit measured on the rendered hero: compared against later concepts. */
export function recordMeasured(runId: string, concept: ConceptId, measured: { skeleton?: string; headline?: string; headlineFont?: string }, now = new Date()): void {
  rebuildDatabase()
    .prepare("UPDATE design_fingerprints SET skeleton = ?, headline = ?, updated_at = ? WHERE run_id = ? AND concept = ?")
    .run(measured.skeleton ?? null, measured.headline ?? null, now.toISOString(), runId, concept);
}

/** What a concept's DESIGN.md says it used, from its fingerprint block. */
export interface ParsedFingerprint {
  direction?: string;
  displayFont?: string;
  textFont?: string;
  palette: string[];
  heroLayout?: string;
}

/**
 * Reads the `agentos-fingerprint` comment the brief asks every DESIGN.md to
 * end with. Without one, the hex colours in the file stand in for the palette.
 */
export function parseFingerprint(design: string): ParsedFingerprint {
  const block = /<!--\s*agentos-fingerprint([\s\S]*?)-->/i.exec(design)?.[1] ?? "";
  const field = (name: string) => new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, "im").exec(block)?.[1]?.replace(/^["']|["']$/g, "");
  const hexes = (text: string) => [...new Set([...text.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toUpperCase()))];
  const palette = hexes(field("palette") ?? "");
  return {
    direction: field("direction"),
    displayFont: field("display-font"),
    textFont: field("text-font"),
    palette: (palette.length > 0 ? palette : hexes(design)).slice(0, 5),
    heroLayout: field("hero-layout"),
  };
}

/** Records what the worker actually made. */
export function recordMade(runId: string, concept: ConceptId, made: ParsedFingerprint, now = new Date()): void {
  rebuildDatabase()
    .prepare("UPDATE design_fingerprints SET display_font = ?, text_font = ?, palette = ?, hero_layout = ?, updated_at = ? WHERE run_id = ? AND concept = ?")
    .run(made.displayFont ?? null, made.textFont ?? null, JSON.stringify(made.palette), made.heroLayout ?? null, now.toISOString(), runId, concept);
}

/** Records the critique's verdict on a concept. */
export function recordCritique(runId: string, concept: ConceptId, verdict: { score?: number; passed?: boolean; autoRevised: boolean; escalated: boolean; reason?: string }, now = new Date()): void {
  rebuildDatabase()
    .prepare("UPDATE design_fingerprints SET score = ?, passed = ?, auto_revised = ?, escalated = ?, reason = ?, updated_at = ? WHERE run_id = ? AND concept = ?")
    .run(verdict.score ?? null, verdict.passed === undefined ? null : verdict.passed ? 1 : 0, verdict.autoRevised ? 1 : 0, verdict.escalated ? 1 : 0, verdict.reason ?? null, now.toISOString(), runId, concept);
}

// ------------------------------------------------------------------ critique gate

export interface ConceptCritique {
  concept: ConceptId;
  score?: number;
  /** Whether the critic would put this in front of the client. A no fails it, whatever the score. */
  present?: boolean;
  /** The critique's slop findings and fixes, for the revision brief. */
  notes: string;
}

/**
 * The critique file: one `## concept-x` section per concept, each with a
 * `Score: NN/40` line. A concept with no section or no score has no score.
 */
export function parseCritique(text: string): ConceptCritique[] {
  return HERO_CONCEPTS.map((concept) => {
    const section = new RegExp(`^##\\s*${concept}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im").exec(text)?.[1] ?? "";
    const score = /score\s*:\s*\**\s*(\d{1,2})\s*\/\s*40/i.exec(section)?.[1];
    const value = score === undefined ? undefined : Number(score);
    const present = /present\s*:\s*\**\s*(yes|no)\b/i.exec(section)?.[1]?.toLowerCase();
    return { concept, score: value !== undefined && value <= 40 ? value : undefined, present: present === undefined ? undefined : present === "yes", notes: section.trim() };
  });
}

export type GateAction = "pass" | "revise" | "escalate";

export interface GateResult {
  concept: ConceptId;
  action: GateAction;
  score?: number;
  reason?: string;
}

/** Same direction and same font pair as an earlier run: the concept repeats it. */
export function repeatsEarlier(made: Pick<DesignFingerprint, "direction" | "displayFont" | "textFont">, prior: readonly DesignFingerprint[]): DesignFingerprint | undefined {
  return prior.find((entry) => entry.direction === made.direction && fingerprintPair(entry) === fingerprintPair(made));
}

/**
 * Whether each concept passes. Below the bar, or repeating an earlier run in the
 * niche, sends it back once (`attempt` 0); after that it goes to the person with
 * its score (`escalate`). A concept the critique did not score is escalated:
 * the person judges it.
 */
export function gateConcepts(input: {
  critiques: readonly ConceptCritique[];
  made: readonly Pick<DesignFingerprint, "concept" | "direction" | "displayFont" | "textFont">[];
  prior: readonly DesignFingerprint[];
  attempt: 0 | 1;
  threshold?: number;
  /** What the rendered audit found, per concept. */
  audits?: readonly { concept: ConceptId; failures: readonly string[] }[];
}): GateResult[] {
  const threshold = input.threshold ?? RUBRIC_PASS;
  return HERO_CONCEPTS.map((concept) => {
    const critique = input.critiques.find((entry) => entry.concept === concept);
    const made = input.made.find((entry) => entry.concept === concept);
    const repeated = made ? repeatsEarlier(made, input.prior) : undefined;
    const problems = [
      critique?.score !== undefined && critique.score < threshold ? `scored ${critique.score}/40, below ${threshold}` : "",
      repeated ? `repeats an earlier ${repeated.niche} run (${DIRECTION_BY_ID.get(repeated.direction)?.name ?? repeated.direction} with the same fonts)` : "",
      critique?.present === false ? "the art director would not present it" : "",
      ...(input.audits?.find((entry) => entry.concept === concept)?.failures ?? []),
    ].filter(Boolean);
    if (problems.length === 0) {
      return critique?.score === undefined
        ? { concept, action: "escalate", reason: "The critique gave it no score." }
        : { concept, action: "pass", score: critique.score };
    }
    return { concept, action: input.attempt === 0 ? "revise" : "escalate", score: critique?.score, reason: problems.join("; ") };
  });
}

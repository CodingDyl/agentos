import { createHash } from "node:crypto";
import { HERO_CONCEPTS, type RebuildRun } from "../../shared/website-rebuild-types";
import { DESIGN_DIRECTIONS, DIRECTION_BY_ID, RUBRIC_PASS, type DesignDirection, type NicheCliches } from "./design-directions";
import { rebuildDatabase } from "./store";

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

/**
 * Three different directions for a run's concepts, from the run id. Directions,
 * font pairs and palette families already used by earlier runs in the same
 * niche or market are excluded while anything unused is left; after that the
 * least used come first. Concept C is always a wildcard: a direction whose
 * reference is far from the niche.
 */
export function assignDirections(runId: string, niche: NicheCliches, prior: readonly DesignFingerprint[]): DirectionAssignment[] {
  const rank = (pool: readonly DesignDirection[]) =>
    [...pool].sort((a, b) => repetition(a, prior) - repetition(b, prior) || seeded(runId, a.id) - seeded(runId, b.id) || a.id.localeCompare(b.id));
  const wildcardPool = DESIGN_DIRECTIONS.filter((direction) => niche.wildcards.includes(direction.id));
  const wildcard = rank(wildcardPool)[0] ?? rank(DESIGN_DIRECTIONS)[0];
  const chosen: DesignDirection[] = [];
  for (const direction of rank(DESIGN_DIRECTIONS.filter((entry) => entry.id !== wildcard.id))) {
    // Within a run too: no two concepts share a font pair or palette family.
    const clash = [wildcard, ...chosen].some((other) => other.palette.family === direction.palette.family || pairKey(other.type.display, other.type.text) === pairKey(direction.type.display, direction.type.text));
    if (clash) continue;
    chosen.push(direction);
    if (chosen.length === 2) break;
  }
  return [
    { concept: "concept-a", direction: chosen[0], wildcard: false },
    { concept: "concept-b", direction: chosen[1], wildcard: false },
    { concept: "concept-c", direction: wildcard, wildcard: true },
  ];
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

/** Earlier runs' concepts in the same niche (unless the niche is unknown) or the same target market. */
export function priorFingerprints(runId: string, niche: string, market: string): DesignFingerprint[] {
  const rows = rebuildDatabase()
    .prepare("SELECT * FROM design_fingerprints WHERE run_id != ? AND ((niche = ? AND niche != 'general') OR market = ?) ORDER BY created_at")
    .all(runId, niche, marketKey(market)) as unknown as Row[];
  return rows.map(toFingerprint);
}

/**
 * The run's assignment: the stored one if there is one, so a retry or a change
 * request keeps its directions, otherwise a new one, recorded at once so a
 * run started in parallel in the same niche sees it.
 */
export function ensureAssignments(run: Pick<RebuildRun, "id" | "targetMarket">, niche: NicheCliches, now = new Date()): DirectionAssignment[] {
  const stored = runFingerprints(run.id);
  const known = stored.map((entry) => ({ entry, direction: DIRECTION_BY_ID.get(entry.direction) })).filter((item): item is { entry: DesignFingerprint; direction: DesignDirection } => Boolean(item.direction));
  if (known.length === HERO_CONCEPTS.length) return known.map(({ entry, direction }) => ({ concept: entry.concept, direction, wildcard: entry.wildcard }));
  const assignments = assignDirections(run.id, niche, priorFingerprints(run.id, niche.id, run.targetMarket));
  const db = rebuildDatabase();
  const at = now.toISOString();
  const insert = db.prepare(
    `INSERT INTO design_fingerprints (run_id, concept, niche, market, direction, wildcard, palette_family, palette, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
     ON CONFLICT (run_id, concept) DO UPDATE SET niche = excluded.niche, market = excluded.market, direction = excluded.direction, wildcard = excluded.wildcard, palette_family = excluded.palette_family, updated_at = excluded.updated_at`,
  );
  for (const assignment of assignments) {
    insert.run(run.id, assignment.concept, niche.id, marketKey(run.targetMarket), assignment.direction.id, assignment.wildcard ? 1 : 0, assignment.direction.palette.family, at, at);
  }
  return assignments;
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
    return { concept, score: value !== undefined && value <= 40 ? value : undefined, notes: section.trim() };
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
}): GateResult[] {
  const threshold = input.threshold ?? RUBRIC_PASS;
  return HERO_CONCEPTS.map((concept) => {
    const critique = input.critiques.find((entry) => entry.concept === concept);
    const made = input.made.find((entry) => entry.concept === concept);
    const repeated = made ? repeatsEarlier(made, input.prior) : undefined;
    const problems = [
      critique?.score !== undefined && critique.score < threshold ? `scored ${critique.score}/40, below ${threshold}` : "",
      repeated ? `repeats an earlier ${repeated.niche} run (${DIRECTION_BY_ID.get(repeated.direction)?.name ?? repeated.direction} with the same fonts)` : "",
    ].filter(Boolean);
    if (problems.length === 0) {
      return critique?.score === undefined
        ? { concept, action: "escalate", reason: "The critique gave it no score." }
        : { concept, action: "pass", score: critique.score };
    }
    return { concept, action: input.attempt === 0 ? "revise" : "escalate", score: critique?.score, reason: problems.join("; ") };
  });
}

import matter from "gray-matter";
import {
  DecisionSchema,
  EDITABLE_STAGES,
  LaterItemSchema,
  MAX_PIVOTS,
  PersonaReviewSchema,
  PersonaSchema,
  STAGE_SCHEMAS,
  STARTUP_STAGES,
  ScoreAttemptSchema,
  VALIDITY_THRESHOLD,
  VentureSchema,
  type EditableStage,
  type LaterItem,
  type Persona,
  type PersonaReview,
  type ScoreAttempt,
  type StageContent,
  type Venture,
  type VentureDecision,
  type VentureDetail,
} from "../../shared/startup-types";
import { listDirectory, readOptionalFile } from "../agentos/filesystem";
import { editFile, readForEdit } from "../agentos/mutations/writer";

/**
 * Where ventures live: `saas/` in the vault.
 *
 * Every file is markdown a person can read in Obsidian, with the structured
 * content in front matter so AgentOS reads back exactly what it wrote. All
 * writes go through `editFile`, so each one is backed up and undoable.
 */

export const SAAS_DIR = "saas";
export const PERSONAS_DIR = `${SAAS_DIR}/personas`;
export const LEARNINGS_FILE = `${SAAS_DIR}/LEARNINGS.md`;

export class StartupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "StartupError";
  }
}

const STAGE_FILES: Record<EditableStage, string> = {
  idea: "01-idea.md",
  value: "02-value.md",
  validate: "03-validation.md",
  mvp: "04-mvp.md",
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertVentureSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new StartupError("That is not a venture.", 404);
  return slug;
}

export function slugify(text: string, fallback = "venture"): string {
  const cleaned = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return cleaned || fallback;
}

const ventureDir = (slug: string) => `${SAAS_DIR}/${assertVentureSlug(slug)}`;
const ventureFile = (slug: string) => `${ventureDir(slug)}/VENTURE.md`;
const stageFile = (slug: string, stage: EditableStage) => `${ventureDir(slug)}/${STAGE_FILES[stage]}`;
const reviewFile = (slug: string, persona: string) => `${ventureDir(slug)}/validation/persona-${assertVentureSlug(persona)}.md`;
const scoreFile = (slug: string) => `${ventureDir(slug)}/validation/score.md`;
const laterFile = (slug: string) => `${ventureDir(slug)}/LATER.md`;
const decisionsFile = (slug: string) => `${ventureDir(slug)}/DECISIONS.md`;
const personaFile = (persona: string) => `${PERSONAS_DIR}/${assertVentureSlug(persona)}.md`;

/** YAML can't hold `undefined`, and a hand-edited timestamp comes back as a Date. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function render(body: string, data: object): string {
  return matter.stringify(body.endsWith("\n") ? body : `${body}\n`, plain(data));
}

function frontMatter(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    // Options passed so gray-matter does not hand back a cached, shared object.
    return plain(matter(text, {}).data);
  } catch {
    return undefined;
  }
}

async function write(relativePath: string, contents: string, label: string, expectedRevision?: string): Promise<string> {
  const result = await editFile({ relativePath, apply: () => contents, label, expectedRevision, checkShape: false });
  return result.revision;
}

const now = () => new Date().toISOString();
const bullets = (items: readonly string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "_None yet._");

// ---------------------------------------------------------------------------
// Ventures
// ---------------------------------------------------------------------------

function renderVenture(venture: Venture): string {
  const stage = STARTUP_STAGES.find((entry) => entry.id === venture.stage)?.label ?? venture.stage;
  return render(
    [
      `# ${venture.name}`,
      "",
      venture.pitch || "_No pitch yet._",
      "",
      `Stage: ${stage} · Status: ${venture.status}${venture.workspace ? ` · Workspace: ${venture.workspace}` : ""}`,
      venture.outcome ? `\nOutcome: ${venture.outcome}. ${venture.outcomeReason ?? ""}` : "",
    ].join("\n"),
    venture,
  );
}

export async function readVenture(slug: string): Promise<{ venture: Venture; revision: string } | undefined> {
  const { data, revision } = await readForEdit(ventureFile(slug));
  const parsed = VentureSchema.safeParse(frontMatter(data));
  return parsed.success ? { venture: parsed.data, revision } : undefined;
}

export async function requireVenture(slug: string): Promise<{ venture: Venture; revision: string }> {
  const found = await readVenture(slug);
  if (!found) throw new StartupError("That venture does not exist.", 404);
  return found;
}

export async function listVentures(): Promise<Venture[]> {
  const entries = await listDirectory(SAAS_DIR).catch(() => [] as string[]);
  const ventures = await Promise.all(
    entries.filter((entry) => SLUG.test(entry) && entry !== "personas").map((entry) => readVenture(entry).catch(() => undefined)),
  );
  return ventures
    .filter((entry): entry is { venture: Venture; revision: string } => entry !== undefined)
    .map((entry) => entry.venture)
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function saveVenture(venture: Venture, expectedRevision?: string): Promise<string> {
  return write(ventureFile(venture.slug), renderVenture({ ...venture, updated: now() }), "startup.venture", expectedRevision);
}

export async function createVenture(input: { name: string; pitch?: string; origin?: Venture["origin"] }): Promise<Venture> {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new StartupError("A venture needs a name.");

  const existing = new Set(await listDirectory(SAAS_DIR).catch(() => [] as string[]));
  const base = slugify(name);
  let slug = base === "personas" ? "personas-venture" : base;
  for (let n = 2; existing.has(slug); n += 1) slug = `${base}-${n}`;

  const at = now();
  const venture: Venture = {
    slug,
    name,
    pitch: input.pitch?.trim().slice(0, 1000) ?? "",
    stage: "idea",
    status: "exploring",
    pivotsUsed: 0,
    origin: input.origin ?? "idea",
    created: at,
    updated: at,
  };
  await saveVenture(venture);
  await appendDecision(slug, { title: "Venture started", detail: input.origin === "brainstorm" ? "From a brainstorm." : "From an idea." });
  return venture;
}

// ---------------------------------------------------------------------------
// Stage documents
// ---------------------------------------------------------------------------

function renderStage<S extends EditableStage>(stage: S, content: StageContent[S]): string {
  const label = STARTUP_STAGES.find((entry) => entry.id === stage)?.label ?? stage;
  const lines: string[] = [`# ${label}`, ""];

  for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
    const heading = key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
    lines.push(`## ${heading}`, "");
    if (Array.isArray(value)) {
      lines.push(
        value.length === 0
          ? "_None._"
          : value.map((item) => (typeof item === "string" ? `- ${item}` : `- ${Object.values(item as object).filter(Boolean).join(" · ")}`)).join("\n"),
      );
    } else {
      lines.push(String(value ?? "") || "_Empty._");
    }
    lines.push("");
  }

  return render(lines.join("\n"), { stage, updated: now(), data: content });
}

export async function readStage<S extends EditableStage>(slug: string, stage: S): Promise<{ content: StageContent[S] | null; revision: string }> {
  const { data, revision } = await readForEdit(stageFile(slug, stage));
  const parsed = STAGE_SCHEMAS[stage].safeParse(frontMatter(data)?.data);
  return { content: parsed.success ? (parsed.data as StageContent[S]) : null, revision };
}

export async function writeStage<S extends EditableStage>(slug: string, stage: S, content: StageContent[S], expectedRevision?: string): Promise<string> {
  return write(stageFile(slug, stage), renderStage(stage, content), `startup.${stage}`, expectedRevision);
}

// ---------------------------------------------------------------------------
// Later, decisions, learnings
// ---------------------------------------------------------------------------

async function readList<T>(file: string, key: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }): Promise<T[]> {
  const data = frontMatter(await readOptionalFile(file));
  const items = Array.isArray(data?.[key]) ? (data[key] as unknown[]) : [];
  return items.map((item) => schema.safeParse(item)).filter((result) => result.success).map((result) => result.data as T);
}

export const readLater = (slug: string) => readList<LaterItem>(laterFile(slug), "items", LaterItemSchema);
export const readDecisions = (slug: string) => readList<VentureDecision>(decisionsFile(slug), "decisions", DecisionSchema);

export async function appendLater(slug: string, item: { title: string; reason?: string }): Promise<LaterItem[]> {
  const title = item.title.trim().slice(0, 300);
  if (!title) throw new StartupError("Say what to park.");
  const items = [...(await readLater(slug)), { title, reason: item.reason?.trim().slice(0, 600) ?? "", at: now() }];
  await write(
    laterFile(slug),
    render(["# Later", "", "Ideas parked outside the MVP. Each one waits until the MVP has proved itself.", "", ...items.map((entry) => `- ${entry.title}${entry.reason ? ` (${entry.reason})` : ""}`)].join("\n"), { items }),
    "startup.later",
  );
  return items;
}

export async function appendDecision(slug: string, decision: { title: string; detail?: string }): Promise<void> {
  const decisions = [...(await readDecisions(slug)), { at: now(), title: decision.title.trim().slice(0, 200), detail: decision.detail?.trim().slice(0, 2000) ?? "" }];
  await write(
    decisionsFile(slug),
    render(["# Decisions", "", ...decisions.map((entry) => `- ${entry.at.slice(0, 10)}: **${entry.title}**${entry.detail ? `. ${entry.detail}` : ""}`)].join("\n"), { decisions }),
    "startup.decision",
  );
}

export async function readLearnings(): Promise<string> {
  return (await readOptionalFile(LEARNINGS_FILE)) ?? "";
}

/** What a venture taught, appended for every later venture to read. */
export async function appendLearning(venture: Venture, lines: string[]): Promise<void> {
  const current = await readLearnings();
  const header = current.trim() ? current.trimEnd() : "# What we have learned\n\nOne entry per venture decision. Read before scoring or planning a new venture.";
  const entry = [`## ${now().slice(0, 10)} · ${venture.name} (${venture.outcome ?? venture.status})`, "", ...lines.map((line) => `- ${line}`)].join("\n");
  await editFile({ relativePath: LEARNINGS_FILE, apply: () => `${header}\n\n${entry}\n`, label: "startup.learning", checkShape: false });
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

function renderPersona(persona: Persona): string {
  return render(
    [
      `# ${persona.name}`,
      "",
      `${persona.role}${persona.seniority ? `, ${persona.seniority}` : ""}${persona.industry ? ` · ${persona.industry}` : ""}`,
      "",
      persona.summary,
      "",
      "## Day to day",
      bullets(persona.dayToDay),
      "",
      "## Tools they use now",
      bullets(persona.tools),
      "",
      "## Pains",
      bullets(persona.pains),
      "",
      "## How they buy",
      persona.buying || "_Unknown._",
      "",
      "## What makes them sceptical",
      bullets(persona.sceptical),
      "",
      "## Behaviour rules",
      bullets(persona.behaviour),
    ].join("\n"),
    persona,
  );
}

export async function listPersonas(): Promise<Persona[]> {
  const files = (await listDirectory(PERSONAS_DIR).catch(() => [] as string[])).filter((file) => file.endsWith(".md"));
  const personas = await Promise.all(files.map((file) => readPersona(file.replace(/\.md$/, "")).catch(() => undefined)));
  return personas.filter((persona): persona is Persona => persona !== undefined).sort((a, b) => a.name.localeCompare(b.name));
}

export async function readPersona(slug: string): Promise<Persona | undefined> {
  const parsed = PersonaSchema.safeParse(frontMatter(await readOptionalFile(personaFile(slug))));
  return parsed.success ? parsed.data : undefined;
}

export async function savePersona(input: Omit<Persona, "slug" | "created" | "usedBy"> & Partial<Pick<Persona, "slug" | "created" | "usedBy">>): Promise<Persona> {
  const name = input.name.trim() || input.role.trim();
  if (!name) throw new StartupError("A persona needs a name or a role.");
  const slug = input.slug ? assertVentureSlug(input.slug) : slugify(`${input.role || name}${input.industry ? `-${input.industry}` : ""}`, "persona");
  const existing = await readPersona(slug);
  const persona = PersonaSchema.parse({
    ...input,
    name,
    slug,
    created: existing?.created ?? input.created ?? now(),
    usedBy: [...new Set([...(existing?.usedBy ?? []), ...(input.usedBy ?? [])])],
  });
  await write(personaFile(slug), renderPersona(persona), "startup.persona");
  return persona;
}

export async function markPersonaUsed(slug: string, venture: string): Promise<void> {
  const persona = await readPersona(slug);
  if (!persona || persona.usedBy.includes(venture)) return;
  await savePersona({ ...persona, usedBy: [...persona.usedBy, venture] });
}

// ---------------------------------------------------------------------------
// Reviews and scores
// ---------------------------------------------------------------------------

function renderReview(review: PersonaReview): string {
  return render(
    [
      `# ${review.personaName || review.persona} reviews this idea`,
      "",
      "_Simulated: a model playing this role, not a real person._",
      "",
      `Fit: ${review.fitScore}/10 · Would pay: ${review.wouldPay}${review.price ? ` (${review.price})` : ""} · Would recommend: ${review.wouldRecommend ? "yes" : "no"}`,
      "",
      review.verdict,
      "",
      "## Through the workday",
      review.workday.length ? review.workday.map((entry) => `- ${entry.task}: ${entry.wouldUse ? "would use" : "would not use"}. ${entry.why}`).join("\n") : "_None._",
      "",
      "## Objections",
      bullets(review.objections),
      "",
      "## Deal-breakers",
      bullets(review.dealBreakers),
      "",
      "## Missing",
      bullets(review.missing),
    ].join("\n"),
    review,
  );
}

export async function saveReview(slug: string, review: PersonaReview): Promise<void> {
  await write(reviewFile(slug, review.persona), renderReview(review), "startup.review");
}

export async function readReviews(slug: string): Promise<PersonaReview[]> {
  const files = (await listDirectory(`${ventureDir(slug)}/validation`).catch(() => [] as string[])).filter((file) => file.startsWith("persona-") && file.endsWith(".md"));
  const reviews = await Promise.all(
    files.map(async (file) => PersonaReviewSchema.safeParse(frontMatter(await readOptionalFile(`${ventureDir(slug)}/validation/${file}`)))),
  );
  return reviews.filter((result) => result.success).map((result) => result.data!);
}

export async function readScores(slug: string): Promise<ScoreAttempt[]> {
  return readList<ScoreAttempt>(scoreFile(slug), "attempts", ScoreAttemptSchema);
}

export async function appendScore(slug: string, attempt: ScoreAttempt): Promise<ScoreAttempt[]> {
  const attempts = [...(await readScores(slug)), attempt];
  const body = [
    "# Validity score",
    "",
    `The bar is ${VALIDITY_THRESHOLD}/10. Below it the venture does not continue (one pivot allowed).`,
    "",
    ...attempts.flatMap((entry) => [
      `## Attempt ${entry.attempt} · ${entry.at.slice(0, 10)} · ${entry.total}/10 · ${entry.passed ? "passed" : "below the bar"}`,
      "",
      entry.summary,
      "",
      ...entry.dimensions.map((dimension) => `- ${dimension.label}: ${dimension.score}/10 (weight ${Math.round(dimension.weight * 100)}%)${dimension.evidence.length ? `. ${dimension.evidence.join("; ")}` : ""}`),
      "",
    ]),
  ].join("\n");
  await write(scoreFile(slug), render(body, { attempts }), "startup.score");
  return attempts;
}

// ---------------------------------------------------------------------------
// Gates and the whole read
// ---------------------------------------------------------------------------

/**
 * Why each stage is locked, keyed by stage. A stage with no entry is open.
 *
 * Enforced here, on the server: the page only shows what this says.
 */
export function stageLocks(input: {
  venture: Venture;
  saved: Record<EditableStage, boolean>;
  latestScore?: ScoreAttempt;
}): Record<string, string> {
  const locks: Record<string, string> = {};
  if (input.venture.status === "stopped") {
    for (const stage of EDITABLE_STAGES) locks[stage] = "This venture has stopped.";
    return locks;
  }
  if (!input.saved.idea) locks.value = "Save the idea first.";
  if (!input.saved.value) locks.validate = "Save the value first.";
  if (!input.latestScore) locks.mvp = `Score the idea first. It needs ${VALIDITY_THRESHOLD}/10 or more.`;
  else if (!input.latestScore.passed) locks.mvp = `The idea scored ${input.latestScore.total}/10. It needs ${VALIDITY_THRESHOLD} or more.`;
  return locks;
}

export function pivotsLeft(venture: Venture): number {
  return Math.max(0, MAX_PIVOTS - venture.pivotsUsed);
}

export async function readVentureDetail(slug: string): Promise<VentureDetail> {
  const { venture, revision } = await requireVenture(slug);
  const [idea, value, validate, mvp, reviews, scores, later, decisions] = await Promise.all([
    readStage(slug, "idea"),
    readStage(slug, "value"),
    readStage(slug, "validate"),
    readStage(slug, "mvp"),
    readReviews(slug),
    readScores(slug),
    readLater(slug),
    readDecisions(slug),
  ]);

  const saved = { idea: idea.content !== null, value: value.content !== null, validate: validate.content !== null, mvp: mvp.content !== null };
  // Reviews from before the latest pivot describe an idea that no longer exists.
  const attempt = venture.pivotsUsed + 1;

  return {
    venture,
    revision,
    stages: { idea: idea.content, value: value.content, validate: validate.content, mvp: mvp.content },
    revisions: { idea: idea.revision, value: value.revision, validate: validate.revision, mvp: mvp.revision },
    reviews: reviews.filter((review) => review.attempt === attempt),
    scores,
    later,
    decisions,
    locks: stageLocks({ venture, saved, latestScore: scores.at(-1) }),
  };
}

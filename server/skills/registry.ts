import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import {
  SKILL_NAME_PATTERN,
  SkillOriginSchema,
  type JobSkill,
  type SkillDraft,
  type SkillOrigin,
  type SkillParseResult,
  type SkillRequirement,
  type SkillSummary,
} from "../../shared/skill-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * AgentOS skills, read from folders. `skills/` in AgentOS ships the bundled
 * ones; `AGENTOS_SKILLS_DIR` can point at more. Each skill is a folder with a
 * `SKILL.md` whose front matter names it.
 *
 * Skills written or uploaded on the Connectors page live in the AgentOS
 * state folder (`skills/` next to `skills.json`), one folder each, and are
 * the only ones the page may edit. Skills installed from a GitHub repo live
 * beside them in `marketplace-skills/`, with where each came from in
 * `marketplace-skills.json` — see `marketplace.ts`.
 *
 * Whether a skill is enabled is stored here, apart from the files, in
 * `skills.json`: bundled skills start enabled, local ones disabled until a
 * person turns them on, and added ones enabled because a person just wrote
 * them. Enabling a skill grants nothing: the connectors it requires keep
 * their own switches and credentials.
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAME = SKILL_NAME_PATTERN;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_SKILL_BYTES = 256 * 1024;

export interface SkillSource {
  dir: string;
  source: "bundled" | "local" | "added" | "marketplace";
}

/** Where skills added on the Connectors page are kept. */
export function addedSkillsDir(): string {
  return path.join(uiStateDir(), "skills");
}

/** Where skills installed from GitHub repos are kept. */
export function marketplaceSkillsDir(): string {
  return path.join(uiStateDir(), "marketplace-skills");
}

function originsFile(): string {
  return path.join(uiStateDir(), "marketplace-skills.json");
}

/** Where each marketplace skill came from, by id. A record without its folder is ignored. */
export async function readOrigins(): Promise<Record<string, SkillOrigin & { version?: string }>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(originsFile(), "utf8"));
    const skills = parsed && typeof parsed === "object" && "skills" in parsed ? (parsed.skills as Record<string, unknown>) : {};
    const origins: Record<string, SkillOrigin & { version?: string }> = {};
    for (const [id, value] of Object.entries(skills ?? {})) {
      const origin = SkillOriginSchema.safeParse(value);
      if (!origin.success) continue;
      const version = value && typeof value === "object" && "version" in value && typeof value.version === "string" ? value.version : undefined;
      origins[id] = { ...origin.data, ...(version ? { version } : {}) };
    }
    return origins;
  } catch {
    return {};
  }
}

export async function writeOrigins(origins: Record<string, SkillOrigin & { version?: string }>): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const temporary = `${originsFile()}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ skills: origins }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, originsFile());
}

/** Off unless a person chose: local skills arrive from a folder nobody reviewed here. */
function enabledByDefault(source: SkillSource["source"]): boolean {
  return source === "bundled" || source === "added";
}

export function skillSources(): SkillSource[] {
  const sources: SkillSource[] = [{ dir: path.join(APP_ROOT, "skills"), source: "bundled" }];
  const local = process.env.AGENTOS_SKILLS_DIR?.trim();
  if (local) sources.push({ dir: path.resolve(local), source: "local" });
  sources.push({ dir: addedSkillsDir(), source: "added" });
  sources.push({ dir: marketplaceSkillsDir(), source: "marketplace" });
  return sources;
}

function stateFile(): string {
  return path.join(uiStateDir(), "skills.json");
}

export async function readEnablement(): Promise<Record<string, boolean>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(stateFile(), "utf8"));
    if (parsed && typeof parsed === "object" && "enabled" in parsed && typeof parsed.enabled === "object" && parsed.enabled) {
      return Object.fromEntries(Object.entries(parsed.enabled as Record<string, unknown>).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>;
    }
  } catch {
    // No choices made yet.
  }
  return {};
}

export async function writeEnablement(enabled: Record<string, boolean>): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const temporary = `${stateFile()}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, stateFile());
}

export interface ParsedSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  requires: string[];
  instructions: string;
  errors: string[];
}

/**
 * Reads one skill folder and says everything wrong with it. A skill whose
 * `SKILL.md` resolves outside its folder (a symlink out) is refused, as is a
 * link in the instructions to a file that is not inside the folder.
 */
export async function readSkill(folder: string): Promise<ParsedSkill | undefined> {
  const id = path.basename(folder);
  const file = path.join(folder, "SKILL.md");
  let raw: string;
  const errors: string[] = [];
  try {
    const real = await fs.realpath(file);
    const realFolder = await fs.realpath(folder);
    if (!real.startsWith(`${realFolder}${path.sep}`)) return { id, name: id, description: "", version: "0.0.0", requires: [], instructions: "", errors: ["SKILL.md points outside its folder."] };
    const stat = await fs.stat(real);
    if (stat.size > MAX_SKILL_BYTES) return { id, name: id, description: "", version: "0.0.0", requires: [], instructions: "", errors: ["SKILL.md is larger than 256 KB."] };
    raw = await fs.readFile(real, "utf8");
  } catch {
    return undefined;
  }

  let data: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    body = parsed.content;
  } catch {
    errors.push("The front matter is not valid YAML.");
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const version = typeof data.version === "string" || typeof data.version === "number" ? String(data.version).trim() : "0.0.0";
  if (!name) errors.push("The front matter has no `name`.");
  else if (!NAME.test(name)) errors.push("`name` must be lowercase letters, digits and hyphens.");
  else if (name !== id) errors.push(`\`name\` (${name}) must match the folder name (${id}).`);
  if (!description) errors.push("The front matter has no `description`.");
  if (!VERSION.test(version)) errors.push(`\`version\` must look like 1.2.3, not "${version}".`);

  const requires = Array.isArray(data.requires) ? data.requires.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()) : [];
  if (data.requires !== undefined && !Array.isArray(data.requires)) errors.push("`requires` must be a list of connector ids.");

  // Relative links in the instructions must stay inside the skill's folder and exist.
  for (const match of body.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
    const target = path.resolve(folder, match[1]);
    if (!target.startsWith(`${path.resolve(folder)}${path.sep}`)) {
      errors.push(`The instructions link outside the skill folder: ${match[1]}`);
      continue;
    }
    try {
      await fs.access(target);
    } catch {
      errors.push(`The instructions link to a missing file: ${match[1]}`);
    }
  }

  return { id, name: name || id, description, version, requires, instructions: body.trim(), errors };
}

export interface SkillDeps {
  connectors: () => Promise<{ id: string; name: string; status: string }[]>;
  activeRuns: (skillId: string) => number;
}

/** Every skill in every source. A bundled skill wins over a local one with the same folder name. */
export async function listSkills(deps: SkillDeps): Promise<SkillSummary[]> {
  const enabled = await readEnablement();
  const origins = await readOrigins();
  const connectors = await deps.connectors().catch(() => []);
  const seen = new Set<string>();
  const skills: SkillSummary[] = [];

  for (const { dir, source } of skillSources()) {
    let entries: string[];
    try {
      // Dot-folders are the editor's staging area, never skills.
      entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      const skill = await readSkill(path.join(dir, entry));
      if (!skill) continue;
      seen.add(entry);

      const requirements: SkillRequirement[] = skill.requires.map((connector) => {
        const found = connectors.find((candidate) => candidate.id === connector);
        return { connector, name: found?.name ?? connector, connected: found?.status === "connected", known: Boolean(found) };
      });
      const errors = [...skill.errors, ...requirements.filter((requirement) => !requirement.known).map((requirement) => `Requires an unknown connector: ${requirement.connector}`)];
      const chosen = enabled[skill.id];
      const origin = source === "marketplace" ? origins[skill.id] : undefined;
      skills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        // A plugin's SKILL.md often carries no version; its plugin.json does, and the install recorded it.
        version: origin?.version && skill.version === "0.0.0" ? origin.version : skill.version,
        source,
        ...(origin ? { origin: { repo: origin.repo, branch: origin.branch, commit: origin.commit, path: origin.path, plugin: origin.plugin, installedAt: origin.installedAt } } : {}),
        enabled: errors.length === 0 && (chosen ?? enabledByDefault(source)),
        requirements,
        errors,
        instructions: skill.instructions,
        activeRuns: deps.activeRuns(skill.id),
      });
    }
  }
  return skills;
}

export class SkillError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function setSkillEnabled(id: string, value: boolean, deps: SkillDeps): Promise<SkillSummary> {
  const skill = (await listSkills(deps)).find((entry) => entry.id === id);
  if (!skill) throw new SkillError("No such skill.", 404);
  if (value && skill.errors.length > 0) throw new SkillError(`Fix this skill before enabling it: ${skill.errors.join(" ")}`, 422);
  const enabled = await readEnablement();
  enabled[id] = value;
  await writeEnablement(enabled);
  return { ...skill, enabled: value };
}

/**
 * Whether a skill may run, from the stored choice and its folder's source.
 * Cheap enough to ask before every stage: one small file read.
 */
export async function isSkillEnabled(id: string): Promise<boolean> {
  for (const { dir, source } of skillSources()) {
    const skill = await readSkill(path.join(dir, id));
    if (!skill) continue;
    // A broken skill never runs, whatever was chosen before it broke.
    if (skill.errors.length > 0) return false;
    return (await readEnablement())[id] ?? enabledByDefault(source);
  }
  return false;
}

/** A SKILL.md from a draft: YAML front matter, then the instructions. */
export function skillMarkdown(draft: SkillDraft & { version: string }): string {
  const data: Record<string, unknown> = { name: draft.name, description: draft.description, version: draft.version };
  if (draft.requires.length > 0) data.requires = draft.requires;
  return matter.stringify(`\n${draft.instructions.trim()}\n`, data);
}

/**
 * Reads an uploaded SKILL.md into the form, without saving anything. The
 * person reviews it there; `errors` says what must change before Save works.
 */
export function parseSkillMarkdown(markdown: string): SkillParseResult {
  const errors: string[] = [];
  let data: Record<string, unknown> = {};
  let body = markdown;
  try {
    const parsed = matter(markdown);
    data = parsed.data;
    body = parsed.content;
  } catch {
    errors.push("The front matter is not valid YAML.");
  }
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
  const name = text(data.name);
  const description = text(data.description);
  const version = text(data.version) || undefined;
  const requires = Array.isArray(data.requires) ? data.requires.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()) : [];
  if (!name) errors.push("The front matter has no `name`.");
  if (!description) errors.push("The front matter has no `description`.");
  if (!body.trim()) errors.push("There are no instructions after the front matter.");
  return { draft: { name, description, ...(version ? { version } : {}), requires, instructions: body.trim() }, errors };
}

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

/**
 * Writes an added skill. The new SKILL.md is written to a staging folder and
 * read back with the same checks as every other skill (and its connectors
 * checked against the ones AgentOS knows); only a clean skill is moved into
 * place, so a bad save never replaces a good one.
 *
 * Editing keeps the name (it is the skill's id) and moves the version on, so
 * a job that already copied the old instructions is told apart from new ones.
 */
export async function saveAddedSkill(draft: SkillDraft, existingId: string | undefined, deps: SkillDeps): Promise<SkillSummary> {
  const skills = await listSkills(deps);
  const current = existingId ? skills.find((skill) => skill.id === existingId) : undefined;

  if (existingId) {
    if (!current) throw new SkillError("No such skill.", 404);
    if (current.source !== "added") throw new SkillError("Only skills added on this page can be edited here.", 403);
    if (draft.name !== existingId) throw new SkillError("A skill's name can't change. Add it as a new skill instead.", 422);
  } else if (skills.some((skill) => skill.id === draft.name)) {
    throw new SkillError(`There is already a skill called ${draft.name}.`, 409);
  }

  const version = current
    ? draft.version && draft.version !== current.version
      ? draft.version
      : bumpPatch(current.version)
    : (draft.version ?? "1.0.0");
  const markdown = skillMarkdown({ ...draft, version });
  if (Buffer.byteLength(markdown, "utf8") > MAX_SKILL_BYTES) throw new SkillError("The skill is larger than 256 KB.", 422);

  const root = addedSkillsDir();
  const staging = path.join(root, `.staging-${randomUUID()}`);
  const staged = path.join(staging, draft.name);
  const target = path.join(root, draft.name);
  await fs.mkdir(staged, { recursive: true });
  try {
    await fs.writeFile(path.join(staged, "SKILL.md"), markdown, "utf8");
    const checked = await readSkill(staged);
    const connectors = await deps.connectors().catch(() => []);
    const unknown = draft.requires.filter((id) => !connectors.some((connector) => connector.id === id));
    const errors = [...(checked?.errors ?? ["The skill could not be read back."]), ...unknown.map((id) => `Requires an unknown connector: ${id}`)];
    if (errors.length > 0) throw new SkillError(`Fix this before saving: ${errors.join(" ")}`, 422);

    if (current) {
      const previous = path.join(staging, ".previous");
      await fs.rename(target, previous);
      await fs.rename(staged, target);
    } else {
      if (await exists(target)) throw new SkillError(`There is already a skill folder called ${draft.name}.`, 409);
      await fs.rename(staged, target);
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }

  if (!current) {
    // Written by a person just now: on until they turn it off.
    const enabled = await readEnablement();
    enabled[draft.name] = true;
    await writeEnablement(enabled);
  }

  const saved = (await listSkills(deps)).find((skill) => skill.id === draft.name);
  if (!saved) throw new SkillError("The skill was saved but could not be read back.", 500);
  return saved;
}

/**
 * Deletes an added skill, or removes one installed from a repo. Refused while
 * a run uses it; jobs that copied its instructions keep them. Bundled and
 * local skills are never deleted here.
 */
export async function deleteAddedSkill(id: string, deps: SkillDeps): Promise<void> {
  if (!NAME.test(id)) throw new SkillError("No such skill.", 404);
  const skill = (await listSkills(deps)).find((entry) => entry.id === id);
  if (!skill) throw new SkillError("No such skill.", 404);
  if (skill.source !== "added" && skill.source !== "marketplace") throw new SkillError("Only skills added or installed on this page can be removed here.", 403);
  if (skill.activeRuns > 0) throw new SkillError("A run is using this skill. Finish or cancel it first.", 409);
  await fs.rm(path.join(skill.source === "added" ? addedSkillsDir() : marketplaceSkillsDir(), id), { recursive: true, force: true });
  if (skill.source === "marketplace") {
    const origins = await readOrigins();
    delete origins[id];
    await writeOrigins(origins);
  }
  const enabled = await readEnablement();
  delete enabled[id];
  await writeEnablement(enabled);
}

/**
 * The instructions a worker job will carry, copied now so later edits never
 * change a job that already started. Refused when the skill is disabled,
 * broken, or needs a connector that is not connected.
 */
export async function skillForJob(id: string, deps: SkillDeps): Promise<JobSkill> {
  const skill = NAME.test(id) ? (await listSkills(deps)).find((entry) => entry.id === id) : undefined;
  if (!skill) throw new SkillError(`There is no skill called ${id}.`, 404);
  if (skill.errors.length > 0) throw new SkillError(`The ${skill.name} skill has problems: ${skill.errors.join(" ")}`, 422);
  if (!skill.enabled) throw new SkillError(`The ${skill.name} skill is disabled in Connectors → Skills.`, 409);
  const missing = skill.requirements.filter((requirement) => !requirement.connected).map((requirement) => requirement.name);
  if (missing.length > 0) throw new SkillError(`The ${skill.name} skill needs ${missing.join(", ")} connected first.`, 409);
  const source = skillSources().find((entry) => entry.source === skill.source);
  const baseDir = source ? path.join(source.dir, skill.id) : undefined;
  return { id: skill.id, name: skill.name, version: skill.version, instructions: skill.instructions, ...(baseDir ? { baseDir } : {}) };
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import type { SkillRequirement, SkillSummary } from "../../shared/skill-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * AgentOS skills, read from folders. `skills/` in AgentOS ships the bundled
 * ones; `AGENTOS_SKILLS_DIR` can point at more. Each skill is a folder with a
 * `SKILL.md` whose front matter names it.
 *
 * Whether a skill is enabled is stored here, apart from the files, in
 * `skills.json`: bundled skills start enabled, local ones disabled until a
 * person turns them on. Enabling a skill grants nothing: the connectors it
 * requires keep their own switches and credentials.
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_SKILL_BYTES = 256 * 1024;

export interface SkillSource {
  dir: string;
  source: "bundled" | "local";
}

export function skillSources(): SkillSource[] {
  const sources: SkillSource[] = [{ dir: path.join(APP_ROOT, "skills"), source: "bundled" }];
  const local = process.env.AGENTOS_SKILLS_DIR?.trim();
  if (local) sources.push({ dir: path.resolve(local), source: "local" });
  return sources;
}

function stateFile(): string {
  return path.join(uiStateDir(), "skills.json");
}

async function readEnablement(): Promise<Record<string, boolean>> {
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

async function writeEnablement(enabled: Record<string, boolean>): Promise<void> {
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
  const connectors = await deps.connectors().catch(() => []);
  const seen = new Set<string>();
  const skills: SkillSummary[] = [];

  for (const { dir, source } of skillSources()) {
    let entries: string[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
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
      skills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        source,
        enabled: errors.length === 0 && (chosen ?? source === "bundled"),
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
    return (await readEnablement())[id] ?? source === "bundled";
  }
  return false;
}

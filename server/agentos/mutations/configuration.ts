import {
  DEFAULT_PROJECT_CONFIGURATION,
  ProjectConfigurationSchema,
  WorkerPreferenceSchema,
  type ProjectConfiguration,
  type ProjectConfigurationPatch,
} from "../../../shared/agentos-types";
import { parseModuleList, WORKSPACE_TYPES, type WorkspaceType } from "../../../shared/workspace";
import { findSection, readSection, setSection } from "./prose-document";

/**
 * A project's operating defaults, kept in `PROJECT.md`.
 *
 * ```markdown
 * ## Configuration
 *
 * Task prefix: PP
 * Default branch: main
 * Worker preference: auto
 * Visual verification: ui-tasks
 * Design board: Chef Board
 * Vercel project: prj_abc123
 * Vercel project name: Chef
 * Workspace type: business
 * Modules: tasks, roadmap, documents, clients, decisions, activity
 * Validation:
 * - npm test
 * - npm run lint
 * ```
 *
 * Fields, not front matter and not JSON. The section reads like the rest of
 * the file — the same `Key: value` shape `Connected Systems` already uses —
 * so a person editing it by hand needs no new syntax, and Hermes reads the
 * same defaults the console does because they are in the vault, not beside it.
 *
 * Absent section, absent key: defaults. A project that never had one behaves
 * exactly as before this section existed.
 */

export const CONFIGURATION_HEADING = "Configuration";

const FIELD = /^\s*(?:[-*+]\s+)?([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;

const KEYS = {
  taskPrefix: "Task prefix",
  defaultBranch: "Default branch",
  workerPreference: "Worker preference",
  visualVerification: "Visual verification",
  designBoard: "Design board",
  vercelProjectId: "Vercel project",
  vercelProjectName: "Vercel project name",
  workspaceType: "Workspace type",
  modules: "Modules",
  validationCommands: "Validation",
} as const;

function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z]/g, "");
}

const KEY_LOOKUP = new Map(
  Object.entries(KEYS).map(([field, label]) => [normaliseKey(label), field]),
);

/** Values a hand-edited field may hold, mapped onto the enum the code uses. */
function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const cleaned = value?.trim().toLowerCase().replace(/\s+/g, "-");

  return (allowed as readonly string[]).includes(cleaned ?? "")
    ? (cleaned as T)
    : fallback;
}

/** Reads the section, tolerating anything a person might have typed into it. */
export function parseConfiguration(markdown: string | undefined): ProjectConfiguration {
  const body = markdown ? readSection(markdown, CONFIGURATION_HEADING) : undefined;
  if (!body) return { ...DEFAULT_PROJECT_CONFIGURATION };

  const raw: Partial<Record<keyof typeof KEYS, string>> = {};
  const validation: string[] = [];
  let collectingValidation = false;

  for (const line of body.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;

    const field = FIELD.exec(line);
    const known = field ? KEY_LOOKUP.get(normaliseKey(field[1])) : undefined;

    if (field && known) {
      collectingValidation = known === "validationCommands";

      if (known === "validationCommands") {
        // `Validation: npm test` on one line is also accepted.
        if (field[2].trim()) validation.push(field[2].trim());
      } else {
        raw[known as Exclude<keyof typeof KEYS, "validationCommands">] = field[2].trim();
      }

      continue;
    }

    const bullet = BULLET.exec(line);

    if (collectingValidation && bullet) {
      validation.push(bullet[1].trim().replace(/^`(.*)`$/, "$1"));
      continue;
    }

    // Anything else ends the validation list — a stray paragraph is not a
    // command, and swallowing it as one would run prose in a shell.
    collectingValidation = false;
  }

  const prefix = raw.taskPrefix?.trim().toUpperCase();
  const workspaceType = raw.workspaceType?.trim().toLowerCase();
  const modules = parseModuleList(raw.modules);

  const parsed = ProjectConfigurationSchema.safeParse({
    taskPrefix: prefix && /^[A-Z][A-Z0-9]{0,7}$/.test(prefix) ? prefix : undefined,
    defaultBranch: raw.defaultBranch?.trim() || undefined,
    workerPreference: readEnum(
      raw.workerPreference,
      WorkerPreferenceSchema.options,
      DEFAULT_PROJECT_CONFIGURATION.workerPreference,
    ),
    visualVerification: readEnum(
      raw.visualVerification,
      ["off", "ui-tasks", "always"] as const,
      DEFAULT_PROJECT_CONFIGURATION.visualVerification,
    ),
    designBoard: raw.designBoard?.trim() || undefined,
    vercelProjectId: raw.vercelProjectId?.trim() || undefined,
    vercelProjectName: raw.vercelProjectName?.trim() || undefined,
    validationCommands: validation.filter((command) => command.length > 0),
    // An unrecognised type is ignored rather than guessed at: the workspace
    // falls back to its derived type, exactly as if the line were absent.
    workspaceType: (WORKSPACE_TYPES as readonly string[]).includes(workspaceType ?? "")
      ? (workspaceType as WorkspaceType)
      : undefined,
    modules: modules.length > 0 ? modules : undefined,
  });

  return parsed.success ? parsed.data : { ...DEFAULT_PROJECT_CONFIGURATION };
}

/** Whether a configuration says anything a default would not. */
export function isDefaultConfiguration(config: ProjectConfiguration): boolean {
  return (
    config.taskPrefix === undefined &&
    config.defaultBranch === undefined &&
    config.designBoard === undefined &&
    config.vercelProjectId === undefined &&
    config.vercelProjectName === undefined &&
    config.workspaceType === undefined &&
    (config.modules === undefined || config.modules.length === 0) &&
    config.workerPreference === DEFAULT_PROJECT_CONFIGURATION.workerPreference &&
    config.visualVerification === DEFAULT_PROJECT_CONFIGURATION.visualVerification &&
    config.validationCommands.length === 0
  );
}

/** The section body for a configuration, in the canonical field order. */
export function renderConfiguration(config: ProjectConfiguration): string {
  const lines: string[] = [];

  if (config.workspaceType) lines.push(`${KEYS.workspaceType}: ${config.workspaceType}`);
  if (config.modules && config.modules.length > 0) lines.push(`${KEYS.modules}: ${config.modules.join(", ")}`);
  if (config.taskPrefix) lines.push(`${KEYS.taskPrefix}: ${config.taskPrefix}`);
  if (config.defaultBranch) lines.push(`${KEYS.defaultBranch}: ${config.defaultBranch}`);
  lines.push(`${KEYS.workerPreference}: ${config.workerPreference}`);
  lines.push(`${KEYS.visualVerification}: ${config.visualVerification}`);
  if (config.designBoard) lines.push(`${KEYS.designBoard}: ${config.designBoard}`);
  if (config.vercelProjectId) lines.push(`${KEYS.vercelProjectId}: ${config.vercelProjectId}`);
  if (config.vercelProjectName) lines.push(`${KEYS.vercelProjectName}: ${config.vercelProjectName}`);

  if (config.validationCommands.length > 0) {
    lines.push(`${KEYS.validationCommands}:`);
    for (const command of config.validationCommands) lines.push(`- ${command}`);
  }

  return lines.join("\n");
}

/** A configuration with a patch laid over it. Empty strings clear a field. */
export function mergeConfiguration(
  current: ProjectConfiguration,
  patch: ProjectConfigurationPatch,
): ProjectConfiguration {
  const next: ProjectConfiguration = { ...current };

  if ("taskPrefix" in patch) next.taskPrefix = patch.taskPrefix || undefined;
  if ("defaultBranch" in patch) next.defaultBranch = patch.defaultBranch?.trim() || undefined;
  if ("designBoard" in patch) next.designBoard = patch.designBoard?.trim() || undefined;
  if ("vercelProjectId" in patch) next.vercelProjectId = patch.vercelProjectId?.trim() || undefined;
  if ("vercelProjectName" in patch) next.vercelProjectName = patch.vercelProjectName?.trim() || undefined;
  if ("workspaceType" in patch) next.workspaceType = patch.workspaceType || undefined;
  if (patch.modules) next.modules = patch.modules.length > 0 ? [...new Set(patch.modules)] : undefined;
  if (patch.workerPreference) next.workerPreference = patch.workerPreference;
  if (patch.visualVerification) next.visualVerification = patch.visualVerification;

  if (patch.validationCommands) {
    next.validationCommands = patch.validationCommands
      .map((command) => command.trim())
      .filter((command) => command.length > 0);
  }

  return ProjectConfigurationSchema.parse(next);
}

/**
 * Writes a configuration into `PROJECT.md`, replacing the section's body and
 * touching nothing else.
 *
 * A configuration that is entirely default is not written as a section of
 * defaults: the file stays as the operator left it, and a project that never
 * needed configuring never grows a block saying so.
 */
export function applyConfiguration(
  markdown: string,
  config: ProjectConfiguration,
): string {
  const lines = markdown.split(/\r?\n/);
  const exists = findSection(lines, CONFIGURATION_HEADING) !== undefined;

  if (isDefaultConfiguration(config) && !exists) return markdown;

  return setSection(markdown, CONFIGURATION_HEADING, renderConfiguration(config));
}

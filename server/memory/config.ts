import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentOSRoot } from "../agentos/filesystem";

/**
 * Where the memory vault is, and whether it can be read right now.
 *
 * The vault is the AgentOS workspace itself (Dylan moved `~/AgentOS` into
 * Obsidian on 2026-09-29), so the path defaults to `AGENTOS_ROOT`. A separate
 * `AGENTOS_MEMORY_VAULT_PATH` still wins when set.
 *
 * Nothing in this module creates a directory. The vault lives on an external
 * SSD, and an unplugged drive must read as *unavailable* — never be papered
 * over with an empty folder at the mount path that then looks like a vault
 * with no notes in it.
 */

export function memoryVaultPath(): string {
  return path.resolve(process.env.AGENTOS_MEMORY_VAULT_PATH ?? agentOSRoot());
}

/** Where the derived index is cached. Outside the vault: Markdown stays the source. */
export function memoryCacheDir(): string {
  const ui = process.env.AGENTOS_UI_DIR ?? path.join(os.homedir(), ".agentos-ui");
  return path.join(ui, "memory");
}

/** Folders that are never notes. */
const ALWAYS_EXCLUDED = new Set([
  ".obsidian",
  ".git",
  ".trash",
  ".venv",
  "node_modules",
  ".DS_Store",
]);

/**
 * Vault-relative paths the operator marked private (`AGENTOS_MEMORY_EXCLUDE`,
 * comma separated). Excluded from the index, the graph and agent context.
 */
export function privatePaths(): string[] {
  return (process.env.AGENTOS_MEMORY_EXCLUDE ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

/** Whether a vault-relative path (forward slashes) is left out of memory. */
export function isExcluded(relative: string): boolean {
  const segments = relative.split("/");

  if (segments.some((segment) => ALWAYS_EXCLUDED.has(segment))) return true;
  // macOS writes `._name` AppleDouble files on exFAT drives; they are not notes.
  if (segments.some((segment) => segment.startsWith("._"))) return true;

  return privatePaths().some(
    (entry) => relative === entry || relative.startsWith(`${entry}/`),
  );
}

export type Availability =
  | { available: true }
  | { available: false; reason: string; configured: boolean };

/**
 * Whether the vault can be read. Read-only: stat and access, nothing else.
 */
export async function probeVault(root = memoryVaultPath()): Promise<Availability> {
  if (!path.isAbsolute(root)) {
    return { available: false, configured: false, reason: `The vault path must be absolute: ${root}` };
  }

  // A vault on a removable drive: say the drive is missing, not the folder.
  const volume = /^\/Volumes\/([^/]+)/.exec(root);
  if (volume) {
    try {
      await fs.stat(`/Volumes/${volume[1]}`);
    } catch {
      return { available: false, configured: true, reason: `The drive "${volume[1]}" is not connected.` };
    }
  }

  try {
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) {
      return { available: false, configured: true, reason: `${root} is not a folder.` };
    }
    await fs.access(root, constants.R_OK);
    return { available: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      configured: true,
      reason:
        code === "ENOENT"
          ? `The vault folder does not exist: ${root}`
          : code === "EACCES"
            ? `AgentOS is not allowed to read ${root}.`
            : `The vault could not be read (${code ?? "unknown error"}).`,
    };
  }
}

/**
 * The real path of a vault entry, or `undefined` if it resolves outside the
 * vault — a symlink pointing elsewhere, or a traversal.
 */
export async function containedRealPath(root: string, relative: string): Promise<string | undefined> {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return undefined;

  const real = await fs.realpath(candidate);
  return real === realRoot || real.startsWith(realRoot + path.sep) ? real : undefined;
}

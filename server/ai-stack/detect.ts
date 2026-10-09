import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Looking for AIs on this machine.
 *
 * Read-only and local: file-system checks and, for local model servers, a
 * single short GET to 127.0.0.1. Nothing here runs a binary, reads a config
 * file's contents, or reports an environment variable's value — a key is
 * evidence by its name alone.
 */

const SERVER_TIMEOUT_MS = 1_500;

/**
 * Common install locations that a server process started from a GUI or an
 * editor often does not have on its PATH, even though the operator's shell does.
 */
export function extraBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".grok", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".cargo", "bin"),
    // Node version managers and npm's per-user prefix, where npm-installed CLIs
    // (Codex, Gemini CLI) land when the global prefix isn't writable.
    path.join(home, ".volta", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, "Library", "pnpm"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

export async function findOnPath(binary: string): Promise<string | undefined> {
  const dirs = new Set([...(process.env.PATH ?? "").split(path.delimiter), ...extraBinDirs()]);

  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }

  return undefined;
}

export async function findApp(name: string): Promise<string | undefined> {
  for (const root of ["/Applications", path.join(os.homedir(), "Applications")]) {
    const candidate = path.join(root, `${name}.app`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }

  return undefined;
}

/** A path under the home directory that exists, e.g. `.claude`. */
export async function findConfig(relative: string): Promise<string | undefined> {
  const candidate = path.join(os.homedir(), relative);
  try {
    await fs.access(candidate);
    return `~/${relative}`;
  } catch {
    return undefined;
  }
}

export function envKeySet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** Whether a local model server answers. Loopback only, one short request. */
export async function serverAnswers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

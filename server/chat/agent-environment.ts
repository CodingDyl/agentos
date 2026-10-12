import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extraBinDirs } from "../ai-stack/detect";

/**
 * The PATH a chat agent is found on and runs with.
 *
 * A server started from a desktop app, an editor or a launcher does not get
 * the operator's shell PATH: nvm, Volta, pipx and npm's global prefix are set
 * up by the shell's startup files, so `codex`, `hermes` or `grok` can be
 * installed and work in a terminal yet be invisible here. Worse, an agent that
 * is itself a Node script (Codex, Gemini CLI) starts with `#!/usr/bin/env
 * node`, and fails if `node` isn't on the PATH it is given.
 *
 * So the login shell is asked for its PATH once, the way editors do, and that
 * is merged with this process's own and the usual install folders, both for
 * finding an agent and for the environment it runs in.
 */

const LOGIN_SHELL_TIMEOUT_MS = 4_000;
const MARKER = "__AGENTOS_PATH__";

let loginPath: Promise<string[]> | undefined;

/** The login shell's PATH entries, asked for once. Empty if it can't be read. */
export function loginShellPath(): Promise<string[]> {
  if (process.platform === "win32" || process.env.AGENTOS_SKIP_LOGIN_SHELL === "1") return Promise.resolve([]);
  loginPath ??= new Promise((resolve) => {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    // Markers around the value: a startup file that prints a banner must not end up in PATH.
    execFile(shell, ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`], { timeout: LOGIN_SHELL_TIMEOUT_MS, env: process.env }, (error, stdout) => {
      const match = new RegExp(`${MARKER}(.*)${MARKER}`, "s").exec(String(stdout ?? ""));
      if (error && !match) {
        console.error("[agentos] chat: couldn't read the login shell's PATH:", error.message);
      }
      resolve(match ? match[1].split(path.delimiter).filter(Boolean) : []);
    });
  });
  return loginPath;
}

/** For tests: forget the cached login PATH. */
export function resetLoginShellPathForTests(): void {
  loginPath = undefined;
}

/** This process's PATH first, then the login shell's, then common install folders; no duplicates. */
export async function agentPathEntries(): Promise<string[]> {
  const own = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...new Set([...own, ...(await loginShellPath()), ...extraBinDirs()])];
}

/** Where an agent's binary is, or undefined. An absolute path is checked as-is. */
export async function findAgentBinary(binary: string): Promise<string | undefined> {
  const candidates = path.isAbsolute(binary) ? [binary] : (await agentPathEntries()).map((dir) => path.join(dir, binary));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return undefined;
}

/** The environment an agent runs in: this process's, with the merged PATH. */
export async function agentEnv(base: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  return { ...base, PATH: (await agentPathEntries()).join(path.delimiter) };
}

/** Where to say an agent was looked for, when it wasn't found. */
export async function searchedFolders(): Promise<string> {
  const home = os.homedir();
  return (await agentPathEntries()).map((dir) => (dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir)).join(", ");
}

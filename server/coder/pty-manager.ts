import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import path from "node:path";

interface Terminal {
  id: string;
  pty: IPty;
  cwd: string;
}

const terminals = new Map<string, Terminal>();

/**
 * node-pty 1.1.0 ships its `spawn-helper` without the executable bit, and npm 11
 * no longer runs install scripts unasked, so on macOS every spawn fails with
 * `posix_spawnp failed`. Setting the bit here fixes it for any install,
 * including a worktree's cloned `node_modules`.
 */
export function ensureSpawnHelperExecutable(): void {
  if (os.platform() === "win32") return;
  let root: string;
  try {
    root = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return;
  }
  for (const helper of [
    path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(root, "build", "Release", "spawn-helper"),
  ]) {
    try {
      const { mode } = statSync(helper);
      if ((mode & 0o111) !== 0o111) chmodSync(helper, mode | 0o755);
    } catch {
      // Not present for this platform, or not ours to change; spawn reports the real problem.
    }
  }
}

export function createTerminal(cwd: string): { id: string; shell: string } {
  const id = randomUUID();
  const shell = os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "bash";

  ensureSpawnHelperExecutable();
  const terminal: IPty = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 30,
    cwd,
    env: process.env as Record<string, string>,
  });

  terminals.set(id, { id, pty: terminal, cwd });

  return { id, shell };
}

export function getTerminal(id: string): Terminal | undefined {
  return terminals.get(id);
}

export function writeToTerminal(id: string, data: string): void {
  const terminal = terminals.get(id);
  if (!terminal) {
    throw new Error(`Terminal ${id} not found`);
  }
  terminal.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const terminal = terminals.get(id);
  if (!terminal) {
    throw new Error(`Terminal ${id} not found`);
  }
  terminal.pty.resize(cols, rows);
}

export function killTerminal(id: string): void {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.kill();
    terminals.delete(id);
  }
}

export function killAllTerminals(): void {
  for (const terminal of terminals.values()) {
    terminal.pty.kill();
  }
  terminals.clear();
}

export function getTerminalIds(): string[] {
  return Array.from(terminals.keys());
}

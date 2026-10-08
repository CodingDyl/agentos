import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import * as os from "node:os";

interface Terminal {
  id: string;
  pty: IPty;
  cwd: string;
}

const terminals = new Map<string, Terminal>();

export function createTerminal(cwd: string): { id: string; shell: string } {
  const id = randomUUID();
  const shell = os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "bash";

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

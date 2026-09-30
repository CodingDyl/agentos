import fs from "node:fs";
import path from "node:path";

/**
 * Writing connector settings into `.env`.
 *
 * The only code that writes the file the data adapter loads its secrets from,
 * so it is deliberately narrow:
 *
 * - it writes names it is given and nothing else. The caller checks those
 *   names against the connector's own setup list, so a request can never set
 *   `PATH`, `NODE_OPTIONS` or `AGENTOS_ROOT`;
 * - a value can't contain a newline, so it can't add a second variable;
 * - every other line (comments, other keys, blank lines) is kept as it was;
 * - the new file is written to a temporary file and renamed, with mode 0600, so
 *   a crash never leaves half a file and other users on the machine can't read it.
 *
 * Values are never logged, and never returned by any route.
 */

export class EnvWriteError extends Error {}

/** Where the adapter loads `.env` from: the working directory, as `server/index.ts` does. */
export function envFilePath(): string {
  return path.resolve(process.env.AGENTOS_ENV_FILE?.trim() || ".env");
}

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** What no connector may write, whatever its setup list says. */
const NEVER = new Set(["PATH", "HOME", "NODE_OPTIONS", "NODE_PATH", "AGENTOS_ROOT", "AGENTOS_UI_DIR", "AGENTOS_MEDIA_DIR", "AGENTOS_PORT", "AGENTOS_ENV_FILE"]);

/** A problem with a value, in words, or undefined when it can be written. */
export function valueProblem(name: string, value: string): string | undefined {
  if (!NAME.test(name) || NEVER.has(name)) return `${name} can't be set from here.`;
  if (/[\r\n\0]/.test(value)) return `${name} can't contain a line break.`;
  if (value.length > 4096) return `${name} is too long.`;
  if (value.includes("'") && value.includes('"')) return `${name} can't contain both kinds of quote.`;
  if (/_URL$/.test(name)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return `${name} must be an http(s) address.`;
    } catch {
      return `${name} must be a full address, e.g. https://example.com.`;
    }
  }
  return undefined;
}

/**
 * Quoted so Node's `.env` parser reads it back exactly: single quotes are
 * taken literally, so they are preferred; double quotes only when the value
 * itself holds a single quote (and, checked above, no double quote).
 */
export function formatEnvLine(name: string, value: string): string {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return `${name}=${value}`;
  return value.includes("'") ? `${name}="${value}"` : `${name}='${value}'`;
}

const ACTIVE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
/** `# FISH_VOICE_ID=…` in `.env.example` style: a template line that setting the value should replace. */
const COMMENTED = /^\s*#\s*([A-Z][A-Z0-9_]*)\s*=/;

/** The new file contents. Pure, so it can be tested without touching a disk. */
export function applyEnvValues(contents: string, values: Readonly<Record<string, string>>): string {
  const lines = contents.length > 0 ? contents.replace(/\r\n/g, "\n").split("\n") : [];
  const pending = new Map(Object.entries(values));
  const written = new Set<string>();

  // Active assignments first: the first one is replaced, any later duplicate
  // is dropped so the file can't disagree with itself.
  const out: string[] = [];
  for (const line of lines) {
    const name = ACTIVE.exec(line)?.[1];
    if (name && pending.has(name)) {
      if (!written.has(name)) {
        out.push(formatEnvLine(name, pending.get(name) ?? ""));
        written.add(name);
      }
      continue;
    }
    out.push(line);
  }

  // Then a commented template line, so the value lands beside its explanation.
  for (let index = 0; index < out.length; index += 1) {
    const name = COMMENTED.exec(out[index])?.[1];
    if (name && pending.has(name) && !written.has(name)) {
      out[index] = formatEnvLine(name, pending.get(name) ?? "");
      written.add(name);
    }
  }

  const remaining = [...pending.keys()].filter((name) => !written.has(name));
  if (remaining.length > 0) {
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    if (out.length > 0) out.push("");
    out.push("# Added from AgentOS → Connectors");
    for (const name of remaining) out.push(formatEnvLine(name, pending.get(name) ?? ""));
  }

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/** Writes the values into `.env` and returns the path written. */
export function writeEnvValues(values: Readonly<Record<string, string>>): string {
  for (const [name, value] of Object.entries(values)) {
    const problem = valueProblem(name, value);
    if (problem) throw new EnvWriteError(problem);
  }

  const target = envFilePath();
  let current = "";
  try {
    current = fs.readFileSync(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new EnvWriteError(".env exists but could not be read.");
  }

  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, applyEnvValues(current, values), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch {
    fs.rmSync(temporary, { force: true });
    throw new EnvWriteError(".env could not be written. Check the folder's permissions.");
  }

  return target;
}

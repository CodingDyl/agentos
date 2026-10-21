import fs from "node:fs/promises";
import path from "node:path";
import type { DevFramework } from "../../shared/dev-server-types";

/**
 * Working out how a project is served, from its own `package.json`.
 *
 * `dev` before `start`: `dev` is the script a developer runs, and `start` is
 * what a production build serves (or, in older projects, the dev server).
 * Nothing is guessed beyond that: a project with neither script gets a
 * reason, not a made-up command.
 */

export const DEV_SCRIPTS = ["dev", "start"] as const;

export interface DevProject {
  script: (typeof DEV_SCRIPTS)[number];
  framework: DevFramework;
  /** The script's own body, which decides whether port flags can be passed through. */
  body: string;
}

export type DevDetection = ({ ok: true } & DevProject) | { ok: false; reason: string };

async function readManifest(cwd: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function frameworkOf(manifest: Record<string, unknown>, body: string): DevFramework {
  const packages = { ...record(manifest.dependencies), ...record(manifest.devDependencies) };
  const has = (name: string) => name in packages;

  if (has("next") || /\bnext\b/.test(body)) return "next";
  if (has("react-scripts") || /\breact-scripts\b/.test(body)) return "cra";
  if (has("astro") || /\bastro\b/.test(body)) return "astro";
  if (has("vite") || /\bvite\b/.test(body)) return "vite";
  return "other";
}

export async function detectDevProject(cwd: string): Promise<DevDetection> {
  const manifest = await readManifest(cwd);

  if (!manifest) {
    return { ok: false, reason: "This folder has no readable package.json, so there is no script to run." };
  }

  const scripts = record(manifest.scripts);
  const script = DEV_SCRIPTS.find((name) => typeof scripts[name] === "string");

  if (!script) {
    return { ok: false, reason: 'package.json has no "dev" or "start" script, so there is nothing to start.' };
  }

  const body = String(scripts[script]);

  return { ok: true, script, framework: frameworkOf(manifest, body), body };
}

/**
 * The command and environment that serve this project on `port`, localhost only.
 *
 * The port always travels in the environment (`PORT`, `HOST`), which Next,
 * CRA and most servers honour. Flags are added only when the script is
 * visibly the framework's own binary, because arguments after `--` go to
 * whatever the script ends with, and `concurrently a b -- --port 1` would hand
 * them to the wrong thing.
 */
export function commandFor(project: DevProject, port: number): { command: string; env: Record<string, string> } {
  const base = `npm run ${project.script}`;
  const env = { PORT: String(port), HOST: "127.0.0.1", BROWSER: "none" };
  const direct = (binary: string) => new RegExp(`^\\s*${binary}(\\s|$)`).test(project.body);

  let flags = "";
  if (project.framework === "next" && direct("next")) flags = `--port ${port} --hostname 127.0.0.1`;
  if (project.framework === "vite" && direct("vite")) flags = `--port ${port} --host 127.0.0.1 --strictPort`;
  if (project.framework === "astro" && direct("astro")) flags = `--port ${port} --host 127.0.0.1`;

  return { command: flags ? `${base} -- ${flags}` : base, env };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** The port a dev server announced on, from its output, or `undefined`. */
export function portFromOutput(text: string): number | undefined {
  const match = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i.exec(stripAnsi(text));
  if (!match) return undefined;
  const port = Number(match[1]);
  return port > 0 && port < 65536 ? port : undefined;
}

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerValidation } from "../../shared/worker-types";
import { git } from "../agentos/git";

/**
 * AgentOS's own look at a web project, in one browser.
 *
 * Workers cannot install browsers, and a review with no browser evidence keeps
 * asking for it. So after validation AgentOS runs `scripts/browser-check.mjs`
 * itself: the project's own dev server, Chromium at five widths, with motion
 * and with reduced motion, scrolled down and back. The result goes into the
 * job's checks, where the reviewer reads it.
 *
 * Problems it finds (sideways scroll, console errors, links to nothing) are
 * reported, not failed on: they may predate the job, and the reviewer judges
 * them. Only a site that would not start or load fails the check.
 */

export const BROWSER_CHECK_SCRIPT = fileURLToPath(new URL("../../scripts/browser-check.mjs", import.meta.url));
export const BROWSER_CHECK_LABEL = "AgentOS browser check (Chromium)";

const TIMEOUT_MS = 6 * 60_000;

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** A project with a page to open: a dev/start script for a web framework, or a plain index.html. */
export async function isWebProject(projectDir: string): Promise<boolean> {
  const manifest = await readJson(path.join(projectDir, "package.json"));
  if (manifest) {
    const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
    const deps = { ...((manifest.dependencies ?? {}) as object), ...((manifest.devDependencies ?? {}) as object) };
    const web = ["next", "vite", "react-scripts", "astro", "@sveltejs/kit", "nuxt"].some((name) => name in deps);
    return web && (typeof scripts.dev === "string" || typeof scripts.start === "string");
  }
  return fs.access(path.join(projectDir, "index.html")).then(
    () => true,
    () => false,
  );
}

/** The build check a web project gets when its job named none. */
export async function defaultValidationFor(projectDir: string): Promise<string[]> {
  const manifest = await readJson(path.join(projectDir, "package.json"));
  const scripts = (manifest?.scripts ?? {}) as Record<string, unknown>;
  return typeof scripts.build === "string" ? ["npm run build"] : [];
}

/** Where the check writes, inside the project so a worker's next run can open the screenshots. */
export const BROWSER_CHECK_DIR = ".agentos/browser-check";

/**
 * Keeps `.agentos/` out of git, without touching the project's `.gitignore`:
 * screenshots must never show up as the worker's changes or be committed.
 */
export async function excludeFromGit(projectDir: string): Promise<void> {
  try {
    const { stdout } = await git(projectDir, ["rev-parse", "--git-path", "info/exclude"]);
    const file = path.resolve(projectDir, stdout.trim());
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current.split("\n").includes(".agentos/")) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}# AgentOS scratch (browser checks)\n.agentos/\n`);
  } catch {
    // Not a repository: nothing to keep out of.
  }
}

export async function runBrowserCheck(projectDir: string, _jobId: string, signal?: AbortSignal): Promise<WorkerValidation> {
  await excludeFromGit(projectDir);
  const out = path.join(projectDir, BROWSER_CHECK_DIR);
  await fs.rm(out, { recursive: true, force: true });

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BROWSER_CHECK_SCRIPT, "--project", projectDir, "--out", out], { cwd: projectDir, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output = `${output}${chunk}`.slice(-20_000)));
    child.stderr.on("data", (chunk: Buffer) => (output = `${output}${chunk}`.slice(-20_000)));

    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(kill, TIMEOUT_MS);
    signal?.addEventListener("abort", kill, { once: true });

    child.once("close", (code) => {
      clearTimeout(timer);
      const line = output.trim().split("\n").reverse().find((entry) => entry.startsWith("{"));
      let parsed: { ok?: boolean; checked?: number; problems?: string[]; reason?: string } = {};
      try {
        parsed = line ? JSON.parse(line) : {};
      } catch {
        // Reported below from the raw output.
      }

      const loaded = code === 0 || code === 1;
      const problems = parsed.problems ?? [];
      resolve({
        command: BROWSER_CHECK_LABEL,
        success: loaded,
        detail: loaded
          ? [
              `Opened the site in Chromium at 1440, 1024, 768, 390 and 320 px, with motion and with reduced motion, scrolled down and back (${parsed.checked ?? 0} views). Screenshots: ${BROWSER_CHECK_DIR}/ in the project folder (git-ignored; open them to judge the look).`,
              problems.length ? `Found: ${problems.slice(0, 15).join("; ")}${problems.length > 15 ? ` and ${problems.length - 15} more` : ""}.` : "No sideways scroll, console errors, failed requests or dead in-page links.",
            ].join(" ")
          : `The site could not be opened: ${(parsed.reason ?? output.slice(-1500)).trim()}`,
      });
    });
  });
}

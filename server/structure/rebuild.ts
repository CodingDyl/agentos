import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { StructureRebuild } from "../../shared/structure-types";
import { git, isRepository } from "../agentos/git";

/**
 * Runs `graphify update .` in one repository, one at a time per workspace.
 *
 * The environment is built from nothing rather than filtered. `update` is
 * meant to be local AST parsing, and Graphify picks an AI backend by looking
 * for API keys and CLIs: with no keys and no `claude` on PATH, a client's code
 * cannot reach a model from here, whatever a future Graphify release decides.
 * Reading documents with a model stays a deliberate `/graphify` run.
 */

export const GRAPHIFY_OUTPUT = "graphify-out";
const TIMEOUT_MS = 10 * 60_000;
const OUTPUT_LINES = 12;
/** What Graphify prints when it will not replace a graph with a smaller one. */
const REFUSED_SHRINK = /refusing to overwrite/i;

export function rebuildEnvironment(binary: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: [path.dirname(binary), "/usr/bin", "/bin"].join(path.delimiter) };
  for (const name of ["HOME", "LANG", "LC_ALL", "TMPDIR", "USER"]) {
    if (source[name]) env[name] = source[name];
  }
  return env;
}

/**
 * Keeps the output out of commits without editing a file the project tracks:
 * `.git/info/exclude` is local to this checkout, so a client repository gains
 * no change to review. A folder that is not a repository has nothing to do.
 */
export async function excludeOutputFromGit(folder: string): Promise<void> {
  if (!(await isRepository(folder))) return;

  const { stdout } = await git(folder, ["rev-parse", "--git-path", "info/exclude"]);
  const file = path.resolve(folder, stdout.trim());
  const current = await fs.readFile(file, "utf8").catch(() => "");
  const pattern = `${GRAPHIFY_OUTPUT}/`;
  if (current.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === GRAPHIFY_OUTPUT)) return;

  await fs.mkdir(path.dirname(file), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await fs.writeFile(file, `${current}${separator}${pattern}\n`);
}

export class StructureRebuilds {
  private readonly states = new Map<string, StructureRebuild>();

  get(slug: string): StructureRebuild {
    return this.states.get(slug) ?? { status: "idle" };
  }

  /** Starts a rebuild unless one is already running, and returns immediately. */
  start(slug: string, input: { folder: string; binary: string; force?: boolean; timeoutMs?: number }): StructureRebuild {
    const current = this.get(slug);
    if (current.status === "running") return current;

    const running: StructureRebuild = { status: "running", startedAt: new Date().toISOString() };
    this.states.set(slug, running);

    void this.run(slug, input).catch((error: unknown) => {
      this.states.set(slug, { status: "failed", error: error instanceof Error ? error.message : "The rebuild could not start." });
    });

    return running;
  }

  private async run(slug: string, input: { folder: string; binary: string; force?: boolean; timeoutMs?: number }): Promise<void> {
    await excludeOutputFromGit(input.folder);

    const args = ["update", ".", ...(input.force ? ["--force"] : [])];
    const child = spawn(input.binary, args, {
      cwd: input.folder,
      env: rebuildEnvironment(input.binary),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (chunk: Buffer) => {
      // The last few lines are all a failure message needs; progress can be long.
      output = `${output}${chunk.toString("utf8")}`.slice(-16_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs ?? TIMEOUT_MS);

    await new Promise<void>((resolve) => {
      child.once("error", (error) => {
        clearTimeout(timer);
        this.states.set(slug, { status: "failed", error: `Graphify could not start: ${error.message}` });
        resolve();
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const refused = REFUSED_SHRINK.test(output);

        if (timedOut) {
          this.states.set(slug, { status: "failed", error: "The rebuild took more than ten minutes and was stopped." });
        } else if (refused) {
          this.states.set(slug, {
            status: "failed",
            canForce: true,
            error: "This rebuild found fewer components than the current graph, so Graphify kept the old one. That is expected after deleting code.",
          });
        } else if (code !== 0) {
          const tail = output.trim().split(/\r?\n/).slice(-OUTPUT_LINES).join("\n");
          this.states.set(slug, { status: "failed", error: tail || `Graphify exited with code ${code}.` });
        } else {
          this.states.delete(slug);
        }
        resolve();
      });
    });
  }
}

export const structureRebuilds = new StructureRebuilds();

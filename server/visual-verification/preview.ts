import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

/**
 * Running the implementation, so it can be looked at.
 *
 * The critical rule is which copy gets started: **the worker's worktree, never
 * the source repository.** Screenshotting the operator's own checkout would
 * verify whatever they happen to have open, which is precisely not the thing
 * under review. Nothing in this module writes to the source repository; the
 * only thing it may create is `node_modules` inside the worktree, which is the
 * worktree's own scratch space.
 *
 * Every failure here is a reason, not an exception to swallow. A preview that
 * would not start makes a verification `unverifiable` — which is a real
 * outcome that an operator can act on — and never a pass.
 */

export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewError";
  }
}

/** Long enough for a cold `npm install` on a real project. */
const INSTALL_TIMEOUT_MS = 8 * 60 * 1000;

/** Long enough for a dev server to compile, short enough to fail usefully. */
const READY_TIMEOUT_MS = 120_000;

const POLL_INTERVAL_MS = 500;

/** Enough of a failing command's output to explain itself. */
const MAX_OUTPUT_CHARS = 2_000;

/**
 * Scripts that start a web server, best first.
 *
 * `dev:web` before `dev` on purpose: a project whose `dev` script runs an API
 * and a front end together under one supervisor cannot be given a port, and
 * the half that serves pages is the half worth starting.
 */
const PREVIEW_SCRIPTS = ["visual:preview", "dev:web", "dev", "start"];

function tail(output: string): string {
  const trimmed = output.trim();

  return trimmed.length > MAX_OUTPUT_CHARS
    ? `…${trimmed.slice(-MAX_OUTPUT_CHARS)}`
    : trimmed;
}

/**
 * A port the operating system says is free.
 *
 * Bound and released rather than picked at random: two verifications running
 * at once must not land on the same port, and a guess cannot promise that.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);

    // No host, so the port is reserved on every stack the machine has. A port
    // free on IPv4 and taken on IPv6 is still a port a dev server cannot use.
    server.listen(0, () => {
      const address = server.address();

      if (typeof address === "string" || address === null) {
        server.close();
        reject(new PreviewError("Could not find a free port for the preview."));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The command that serves this worktree, and the script it came from.
 *
 * An explicit `AGENTOS_VISUAL_PREVIEW_COMMAND` wins outright — a project this
 * heuristic cannot read is a configuration problem, not a reason to give up —
 * and `{port}` in it is replaced with the port that was chosen.
 */
export async function resolvePreviewCommand(
  worktreePath: string,
  port: number,
): Promise<{ command: string; script?: string }> {
  const configured = process.env.AGENTOS_VISUAL_PREVIEW_COMMAND?.trim();

  if (configured) {
    return { command: configured.replaceAll("{port}", String(port)) };
  }

  const manifest = await readJson(path.join(worktreePath, "package.json"));

  if (!manifest) {
    throw new PreviewError(
      "The worktree has no readable package.json, so there is no preview to start. Set AGENTOS_VISUAL_PREVIEW_COMMAND if this project starts some other way.",
    );
  }

  const scripts =
    typeof manifest.scripts === "object" && manifest.scripts !== null
      ? (manifest.scripts as Record<string, unknown>)
      : {};

  const script = PREVIEW_SCRIPTS.find(
    (name) => typeof scripts[name] === "string",
  );

  if (!script) {
    throw new PreviewError(
      `The worktree has none of these scripts: ${PREVIEW_SCRIPTS.join(", ")}. Set AGENTOS_VISUAL_PREVIEW_COMMAND to say how this project is served.`,
    );
  }

  return {
    script,
    command: `npm run ${script} -- --port ${port} --strictPort`,
  };
}

function hash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Gets dependencies into the worktree.
 *
 * A fresh worktree has no `node_modules`, and installing one from scratch for
 * every verification would make this step cost minutes it does not need to.
 * When the source repository has already installed the *identical* lockfile,
 * its tree is linked rather than duplicated — identical lockfiles mean
 * identical dependencies, so this is a shortcut rather than an assumption.
 *
 * A worker that added a dependency changes the lockfile, which fails that
 * check, and the install happens properly.
 */
async function installDependencies(
  worktreePath: string,
  sourceRepoPath: string | undefined,
  onProgress: (message: string) => void,
): Promise<void> {
  if (await exists(path.join(worktreePath, "node_modules"))) return;

  if (sourceRepoPath) {
    const [worktreeLock, sourceLock] = await Promise.all([
      fs.readFile(path.join(worktreePath, "package-lock.json"), "utf8").catch(() => undefined),
      fs.readFile(path.join(sourceRepoPath, "package-lock.json"), "utf8").catch(() => undefined),
    ]);

    const sourceModules = path.join(sourceRepoPath, "node_modules");

    if (
      worktreeLock &&
      sourceLock &&
      hash(worktreeLock) === hash(sourceLock) &&
      (await exists(sourceModules))
    ) {
      onProgress("Linking the source repository's dependencies");

      await fs.symlink(
        sourceModules,
        path.join(worktreePath, "node_modules"),
        "dir",
      );

      return;
    }
  }

  onProgress("Installing dependencies in the worktree");

  await runToCompletion("npm install", worktreePath, INSTALL_TIMEOUT_MS);
}

/** Runs a command and rejects with its output when it does not succeed. */
function runToCompletion(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    const capture = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_CHARS * 2);
    };

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new PreviewError(`\`${command}\` timed out.`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new PreviewError(`Could not run \`${command}\`: ${error.message}`));
    });

    child.once("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new PreviewError(
          `\`${command}\` exited with ${code ?? "no code"}. ${tail(output)}`,
        ),
      );
    });
  });
}

export interface Preview {
  /** Where the implementation is being served, e.g. `http://127.0.0.1:5310`. */
  url: string;
  /** The command that started it, for the record. */
  command: string;
  /** Stops the server and everything it started. Safe to call twice. */
  stop: () => Promise<void>;
}

/**
 * The addresses a dev server started on this port might actually be on.
 *
 * Both, because which one it is depends on the tool. Vite binds `localhost`,
 * which resolves to `::1` first on macOS, so a probe fixed to `127.0.0.1`
 * waits out its whole timeout on a server that has been up since the first
 * second — and then reports it as never having started.
 */
function candidateUrls(port: number): string[] {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

/** Whether the server is answering yet. Any reply counts — even a 404. */
async function respond(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
      redirect: "manual",
    });

    // A dev server that is up but has no route at `/` is still up. What is
    // being waited for is "something is listening and speaking HTTP".
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Stops a process and everything it spawned.
 *
 * `npm run dev` is a supervisor: killing it alone leaves the actual server
 * holding the port, and the next verification would then screenshot a stale
 * process. The whole group goes.
 */
function killGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    try {
      if (child.pid !== undefined && child.exitCode === null) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      // Already gone, which is the outcome that was wanted.
    }
  }, 5_000).unref?.();
}

/**
 * Starts the worktree's own dev server and waits for it to answer.
 *
 * Returns a handle whose `stop` must be called — the caller does so in a
 * `finally`, because a verification that threw halfway must not leave a server
 * running on a port nobody remembers.
 */
export async function startPreview(
  worktreePath: string,
  options: {
    sourceRepoPath?: string;
    onProgress?: (message: string) => void;
  } = {},
): Promise<Preview> {
  const onProgress = options.onProgress ?? (() => undefined);

  if (!(await exists(worktreePath))) {
    throw new PreviewError(
      `The worktree at ${worktreePath} is not there any more, so there is nothing to run.`,
    );
  }

  await installDependencies(worktreePath, options.sourceRepoPath, onProgress);

  const port = await freePort();
  const { command, script } = await resolvePreviewCommand(worktreePath, port);
  const candidates = candidateUrls(port);

  onProgress(
    script
      ? `Starting the implementation with \`npm run ${script}\` on port ${port}`
      : `Starting the implementation on port ${port}`,
  );

  const child = spawn(command, {
    cwd: worktreePath,
    shell: true,
    env: process.env,
    // Its own process group, so the whole tree can be stopped together.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let exited: number | null = null;

  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_CHARS * 2);
  };

  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.once("close", (code) => {
    exited = code ?? 0;
  });

  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    killGroup(child);
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // A server that died is not going to start answering. Reported with its
    // own output, because that is where the reason actually is.
    if (exited !== null) {
      throw new PreviewError(
        `The preview server exited with ${exited} before it served anything. ${tail(output)}`,
      );
    }

    for (const url of candidates) {
      if (await respond(url)) {
        onProgress(`The implementation is serving on ${url}`);
        return { url, command, stop };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await stop();

  throw new PreviewError(
    `The preview server did not answer on ${candidates.join(" or ")} within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${tail(output)}`,
  );
}

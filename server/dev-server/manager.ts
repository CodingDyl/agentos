import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import type { DevFramework, DevServerStatus } from "../../shared/dev-server-types";
import { clearSidecarBuildCache } from "../agentos/metadata-files";
import { installCommandFor } from "../workers/dependencies";
import { commandFor, detectDevProject, portFromOutput, stripAnsi } from "./detect";

/**
 * One local dev server per project, run by AgentOS.
 *
 * Processes are started as their own process group and stopped by group.
 * `npm run dev` is a supervisor: killing npm alone leaves the real server
 * holding the port. Every group is also killed when AgentOS goes down, so a
 * restart of this server never leaves a Next.js process orphaned.
 *
 * Nothing runs through a shell: every process is a file and an argument
 * array, so no path, script name or port is ever parsed by `sh`.
 *
 * The server only ever listens on localhost, and it is started with an
 * allow-listed environment: AgentOS's own `.env` (API tokens, mail passwords)
 * is not handed to a project's code, and nothing here reads the project's.
 */

const MAX_LINES = 300;
const MAX_LINE_CHARS = 2_000;
const READY_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 300;
const KILL_GRACE_MS = 4_000;

/** What a child process may inherit. Not the rest of AgentOS's environment. */
const INHERITED_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM", "NVM_DIR", "VOLTA_HOME", "FNM_DIR"];

export interface DevServerSnapshot {
  status: DevServerStatus;
  command?: string;
  framework?: DevFramework;
  port?: number;
  url?: string;
  startedAt?: string;
  error?: string;
  output: string[];
}

interface Entry {
  cwd: string;
  status: DevServerStatus;
  child?: ChildProcess;
  lines: string[];
  partial: string;
  command?: string;
  framework?: DevFramework;
  port?: number;
  announcedPort?: number;
  url?: string;
  startedAt?: string;
  error?: string;
  /** Set when the operator (or shutdown) asked for it to end, so an exit is not a failure. */
  stopping: boolean;
  /** Settles when the process group has exited (or never existed). */
  exited?: Promise<void>;
  /** Bumped on every start, so a stale launch cannot overwrite a newer one. */
  generation: number;
}

export interface DevServerOptions {
  /** The install to run first, as a file and its arguments. Replaced in tests so no real install runs. */
  installCommandFor?: (cwd: string) => Promise<readonly string[] | undefined>;
  readyTimeoutMs?: number;
  killGraceMs?: number;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Could not find a free port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/** Whether something accepts connections on this port, on either loopback address. */
function listening(port: number): Promise<boolean> {
  const attempt = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(800, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });

  return Promise.all([attempt("127.0.0.1"), attempt("::1")]).then(([v4, v6]) => v4 || v6);
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { ...env, NODE_ENV: "development", ...extra };
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone, which is the outcome that was wanted.
    }
  }
}

export class DevServerManager {
  private readonly entries = new Map<string, Entry>();
  private readonly options: Required<DevServerOptions>;

  constructor(options: DevServerOptions = {}) {
    this.options = {
      // `npm ci` or `npm install`: fixed words, split rather than handed to a shell.
      installCommandFor: options.installCommandFor ?? (async (cwd) => (await installCommandFor(cwd))?.split(" ")),
      readyTimeoutMs: options.readyTimeoutMs ?? READY_TIMEOUT_MS,
      killGraceMs: options.killGraceMs ?? KILL_GRACE_MS,
    };
  }

  get(slug: string): DevServerSnapshot {
    const entry = this.entries.get(slug);
    if (!entry) return { status: "stopped", output: [] };

    return {
      status: entry.status,
      command: entry.command,
      framework: entry.framework,
      port: entry.port,
      url: entry.url,
      startedAt: entry.startedAt,
      error: entry.error,
      output: entry.partial ? [...entry.lines, entry.partial] : [...entry.lines],
    };
  }

  /** Starts the project's server. Returns at once; poll `get` for progress. */
  start(slug: string, cwd: string): DevServerSnapshot {
    const existing = this.entries.get(slug);
    if (existing && ["installing", "starting", "running"].includes(existing.status) && existing.cwd === cwd) {
      return this.get(slug);
    }
    // One server per project: a server still running from another folder
    // (the Dev tab and Ship can name different ones) is stopped, not orphaned.
    if (existing?.child && existing.status !== "stopped" && existing.status !== "failed") {
      existing.stopping = true;
      signalGroup(existing.child, "SIGTERM");
    }

    const entry: Entry = {
      cwd,
      status: "installing",
      lines: [],
      partial: "",
      stopping: false,
      generation: (existing?.generation ?? 0) + 1,
      startedAt: new Date().toISOString(),
    };
    this.entries.set(slug, entry);

    void this.launch(entry).catch((error: unknown) => {
      this.fail(entry, error instanceof Error ? error.message : String(error));
    });

    return this.get(slug);
  }

  /** Stops the server and everything it started. Resolves once the group has exited. */
  async stop(slug: string): Promise<DevServerSnapshot> {
    const entry = this.entries.get(slug);
    if (!entry) return this.get(slug);

    if (entry.child && entry.exited) {
      entry.stopping = true;
      signalGroup(entry.child, "SIGTERM");
      const forced = setTimeout(() => entry.child && signalGroup(entry.child, "SIGKILL"), this.options.killGraceMs);
      await entry.exited;
      clearTimeout(forced);
    }

    entry.stopping = true;
    entry.generation += 1;
    if (entry.status !== "failed") {
      entry.status = "stopped";
      entry.url = undefined;
    }
    return this.get(slug);
  }

  async restart(slug: string, cwd: string): Promise<DevServerSnapshot> {
    await this.stop(slug);
    return this.start(slug, cwd);
  }

  /** Kills every group at once, synchronously. For shutdown and process exit. */
  killAll(): void {
    for (const entry of this.entries.values()) {
      entry.stopping = true;
      if (entry.child) signalGroup(entry.child, "SIGKILL");
    }
  }

  private append(entry: Entry, chunk: Buffer): void {
    const text = stripAnsi(chunk.toString("utf8")).replace(/\r(?!\n)/g, "\n");
    const pieces = (entry.partial + text).split("\n");
    entry.partial = (pieces.pop() ?? "").slice(-MAX_LINE_CHARS);

    for (const line of pieces) entry.lines.push(line.slice(0, MAX_LINE_CHARS));
    if (entry.lines.length > MAX_LINES) entry.lines.splice(0, entry.lines.length - MAX_LINES);

    const announced = portFromOutput(text);
    if (announced !== undefined) entry.announcedPort = announced;
  }

  private fail(entry: Entry, message: string): void {
    if (entry.stopping) return;
    entry.status = "failed";
    entry.error = message;
    entry.url = undefined;
    if (entry.child) signalGroup(entry.child, "SIGTERM");
  }

  /** Runs a command to completion in its own group, streaming its output into the tail. */
  private run(entry: Entry, file: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs?: number): Promise<number | null> {
    const command = [file, ...args].join(" ");
    return new Promise((resolve) => {
      const child = spawn(file, [...args], { cwd: entry.cwd, shell: false, detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
      entry.child = child;
      entry.exited = new Promise<void>((done) => child.once("close", () => done()));

      child.stdout?.on("data", (chunk: Buffer) => this.append(entry, chunk));
      child.stderr?.on("data", (chunk: Buffer) => this.append(entry, chunk));

      const timer = timeoutMs
        ? setTimeout(() => {
            this.append(entry, Buffer.from(`\n\`${command}\` timed out.\n`));
            signalGroup(child, "SIGKILL");
          }, timeoutMs)
        : undefined;

      child.once("error", (error) => {
        this.append(entry, Buffer.from(`\nCould not run \`${command}\`: ${error.message}\n`));
        resolve(null);
      });
      child.once("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve(code);
      });
    });
  }

  private async launch(entry: Entry): Promise<void> {
    const generation = entry.generation;
    const current = () => entry.generation === generation && !entry.stopping;

    const detection = await detectDevProject(entry.cwd);
    if (!detection.ok) return this.fail(entry, detection.reason);

    entry.framework = detection.framework;

    const install = await this.options.installCommandFor(entry.cwd);
    if (install?.length && current()) {
      const [file, ...args] = install;
      const shown = install.join(" ");
      entry.status = "installing";
      entry.command = shown;
      this.append(entry, Buffer.from(`$ ${shown}  (dependencies are not installed here yet)\n`));

      const code = await this.run(entry, file, args, childEnv({}), INSTALL_TIMEOUT_MS);
      if (!current()) return;
      if (code !== 0) return this.fail(entry, `\`${shown}\` failed (exit ${code ?? "unknown"}), so the server was not started.`);
    }

    if (!current()) return;

    if (await clearSidecarBuildCache(entry.cwd).catch(() => false)) {
      this.append(entry, Buffer.from("Cleared a build cache that macOS sidecar files had broken.\n"));
    }

    const port = await freePort();
    if (!current()) return;
    const { command, file, args, env } = commandFor(detection, port);

    entry.status = "starting";
    entry.command = command;
    entry.port = port;
    entry.child = undefined;
    this.append(entry, Buffer.from(`$ ${command}\n`));

    const finished = this.run(entry, file, args, childEnv(env));
    const deadline = Date.now() + this.options.readyTimeoutMs;

    // Watch for the port while the process runs; the process ending first is a result too.
    let ended = false;
    const exitCode = finished.then((code) => {
      ended = true;
      return code;
    });

    while (!ended && current() && entry.status === "starting") {
      if (entry.announcedPort !== undefined) entry.port = entry.announcedPort;
      if (entry.port !== undefined && (await listening(entry.port))) {
        entry.status = "running";
        entry.url = `http://localhost:${entry.port}`;
        break;
      }
      if (Date.now() > deadline) {
        this.fail(entry, `Nothing was listening after ${Math.round(this.options.readyTimeoutMs / 1000)} seconds.`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    const code = await exitCode;
    if (entry.stopping || entry.generation !== generation) return;

    // The server ended without being asked to. A clean exit after running is
    // a stop; anything else is a failure with its output left to read.
    const settled = entry.status as DevServerStatus;
    if (settled === "failed") return;
    if (settled === "running" && code === 0) {
      entry.status = "stopped";
      entry.url = undefined;
      return;
    }
    this.fail(entry, code === null ? "The server was killed." : `The server exited with code ${code}.`);
  }
}

export const devServers = new DevServerManager();

/** Runs on `exit` too, so a crash of the data server still takes the dev servers with it. */
process.on("exit", () => devServers.killAll());

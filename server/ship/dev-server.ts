import { spawn, type ChildProcess } from "node:child_process";
import { detectPreviewPort, type ShipDevState } from "../../shared/ship-types";
import { detectDevCommand, detectPackageManager } from "../coder/workspace-setup";
import { ShipError } from "./error";
import { requireKnownProject, requireShipRoot } from "./root";

const MAX_LOGS = 400;

interface RunningDev {
  child: ChildProcess;
  status: ShipDevState["status"];
  packageManager: NonNullable<ShipDevState["packageManager"]>;
  script: string;
  port?: number;
  logs: string[];
  error?: string;
  startedAt: string;
}

const running = new Map<string, RunningDev>();

function pushLog(session: RunningDev, chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    session.logs.push(line);
    if (session.logs.length > MAX_LOGS) session.logs.splice(0, session.logs.length - MAX_LOGS);
    const port = detectPreviewPort(line);
    if (port) {
      session.port = port;
      if (session.status === "starting" || session.status === "installing") session.status = "running";
    }
  }
}

function toState(session: RunningDev | undefined, fallback: Partial<ShipDevState> = {}): ShipDevState {
  if (!session) {
    return {
      status: fallback.status ?? "stopped",
      packageManager: fallback.packageManager ?? null,
      script: fallback.script ?? null,
      logs: fallback.logs ?? [],
      error: fallback.error,
    };
  }
  return {
    status: session.status,
    packageManager: session.packageManager,
    script: session.script,
    port: session.port,
    url: session.port ? `http://127.0.0.1:${session.port}` : undefined,
    logs: session.logs.slice(-120),
    error: session.error,
    startedAt: session.startedAt,
  };
}

export async function readShipDev(slug: string): Promise<ShipDevState> {
  await requireKnownProject(slug);
  const existing = running.get(slug);
  if (existing) return toState(existing);
  try {
    const folder = await requireShipRoot(slug);
    const packageManager = await detectPackageManager(folder);
    const script = await detectDevCommand(folder);
    return toState(undefined, { packageManager, script });
  } catch (error) {
    if (error instanceof ShipError && error.status === 409) {
      return toState(undefined, { error: error.message });
    }
    throw error;
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; logs: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const logs: string[] = [];
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) if (line) logs.push(line);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve({ code: code ?? 1, logs }));
  });
}

export async function startShipDev(slug: string): Promise<ShipDevState> {
  await requireKnownProject(slug);
  const current = running.get(slug);
  if (current && (current.status === "running" || current.status === "starting" || current.status === "installing")) {
    return toState(current);
  }
  const folder = await requireShipRoot(slug);
  const packageManager = await detectPackageManager(folder);
  const script = await detectDevCommand(folder);
  if (!packageManager || !script) {
    throw new ShipError("This folder has no package manager lockfile or a dev/start script.", 409);
  }

  const session: RunningDev = {
    child: spawn(process.execPath, ["-e", "process.exit(0)"]),
    status: "installing",
    packageManager,
    script,
    logs: [`Installing with ${packageManager}…`],
    startedAt: new Date().toISOString(),
  };
  running.set(slug, session);

  const install = await runCommand(packageManager, ["install"], folder).catch((error: Error) => {
    session.status = "error";
    session.error = error.message;
    session.logs.push(error.message);
    return undefined;
  });
  if (session.status === "error") return toState(session);
  if (!install || install.code !== 0) {
    session.status = "error";
    session.error = install?.logs.at(-1) ?? `${packageManager} install failed.`;
    session.logs.push(...(install?.logs ?? []));
    return toState(session);
  }
  session.logs.push(...install.logs, `Starting ${packageManager} run ${script}…`);
  session.status = "starting";

  const args = packageManager === "yarn" ? [script] : ["run", script];
  const child = spawn(packageManager, args, {
    cwd: folder,
    env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  session.child = child;
  child.stdout?.on("data", (chunk: Buffer) => pushLog(session, chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => pushLog(session, chunk.toString()));
  child.on("error", (error) => {
    session.status = "error";
    session.error = error.message;
    session.logs.push(error.message);
  });
  child.on("close", (code) => {
    if (session.status === "running" || session.status === "starting") {
      session.status = code === 0 ? "stopped" : "error";
      if (code !== 0) session.error = `Dev server exited with ${code}.`;
    }
    if (running.get(slug) === session) running.delete(slug);
  });
  return toState(session);
}

export async function stopShipDev(slug: string): Promise<ShipDevState> {
  await requireKnownProject(slug);
  const session = running.get(slug);
  if (!session) return readShipDev(slug);
  session.status = "stopped";
  session.child.kill("SIGTERM");
  setTimeout(() => {
    if (!session.child.killed) session.child.kill("SIGKILL");
  }, 2_000);
  running.delete(slug);
  return toState(undefined, {
    status: "stopped",
    packageManager: session.packageManager,
    script: session.script,
    logs: session.logs.slice(-120),
  });
}

export function stopAllDevServers(): void {
  for (const [slug, session] of running) {
    session.child.kill("SIGTERM");
    running.delete(slug);
  }
}

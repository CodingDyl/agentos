import fs from "node:fs/promises";
import path from "node:path";
import type {
  CuratorControl,
  HermesAutomationSurfaces,
  HermesCurator,
} from "../../shared/agentos-types";
import { hermesHome, runHermesCli } from "./automations";

/**
 * Everything in Hermes that acts on its own besides scheduled jobs: the skill
 * curator, kanban dispatch, shell hooks, webhooks — plus the two switches that
 * decide whether any of it fires (the scheduler, and the emergency stop).
 *
 * Read through the same CLI as the schedule. Every reader is tolerant and
 * every surface is read on its own, so one that can't be read shows as
 * unknown while the rest still reach the page.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g;

function lines(stdout: string): string[] {
  return stdout
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
}

/** `hermes curator status`. */
export function readCuratorStatus(stdout: string): HermesCurator {
  const all = lines(stdout);
  const header = all.map((line) => /^curator:\s*(ENABLED|PAUSED|DISABLED)\b/.exec(line.trim())).find(Boolean);
  const field = (label: string) =>
    all
      .map((line) => new RegExp(`^\\s+${label}:\\s+(.+)$`).exec(line))
      .find(Boolean)?.[1]
      .trim();
  const count = (label: string) => {
    const match = all.map((line) => new RegExp(`^\\s+${label}\\s+(\\d+)$`).exec(line)).find(Boolean);
    return match ? Number(match[1]) : undefined;
  };

  const active = count("active");
  const stale = count("stale");
  const archived = count("archived");

  return {
    state: header ? (header[1].toLowerCase() as HermesCurator["state"]) : "unknown",
    interval: field("interval"),
    lastRun: field("last run"),
    lastSummary: field("last summary"),
    skills:
      active !== undefined && stale !== undefined && archived !== undefined
        ? { active, stale, archived }
        : undefined,
  };
}

/** `hermes cron status`: is the gateway's scheduler up, so jobs will fire? */
export function readSchedulerStatus(stdout: string): HermesAutomationSurfaces["scheduler"] {
  const meaningful = lines(stdout)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const running = meaningful.find((line) => /gateway is running/i.test(line));
  if (running) return { running: true, detail: running.replace(/^[✓✔]\s*/, "") };
  return { running: false, detail: meaningful[0]?.replace(/^[✗✘⚠]\s*/, "") };
}

/** `hermes hooks list`. */
export function readHooksList(stdout: string): HermesAutomationSurfaces["hooks"] {
  const meaningful = lines(stdout).filter((line) => line.trim().length > 0);
  if (meaningful.length === 0 || /^no shell hooks/i.test(meaningful[0].trim())) {
    return { configured: false, entries: [] };
  }
  return { configured: true, entries: meaningful.map((line) => line.trim()) };
}

/** `hermes webhook list`. */
export function readWebhookList(stdout: string): HermesAutomationSurfaces["webhooks"] {
  const meaningful = lines(stdout).filter((line) => line.trim().length > 0);
  if (meaningful.length === 0 || meaningful.some((line) => /webhook platform is not enabled/i.test(line))) {
    return { enabled: false, entries: [] };
  }
  const entries = meaningful.map((line) => line.trim()).filter((line) => !/^no (dynamic )?subscriptions/i.test(line));
  return { enabled: true, entries };
}

/** `hermes kanban stats --json`. */
export function readKanbanStats(stdout: string): HermesAutomationSurfaces["kanban"] {
  try {
    const parsed = JSON.parse(stdout) as { by_status?: Record<string, unknown> };
    const byStatus: Record<string, number> = {};
    for (const [status, value] of Object.entries(parsed.by_status ?? {})) {
      if (typeof value === "number" && Number.isInteger(value)) byStatus[status] = value;
    }
    return { readable: true, byStatus };
  } catch {
    return { readable: false, byStatus: {} };
  }
}

/**
 * The emergency stop is a file: `hermes pause` writes `$HERMES_HOME/ESTOP`
 * and `hermes resume` removes it. Its presence is the whole state; a reason
 * is read when the file carries one.
 */
export function readEmergencyStop(contents: string | undefined): HermesAutomationSurfaces["emergencyStop"] {
  if (contents === undefined) return { engaged: false };
  try {
    const parsed = JSON.parse(contents) as { reason?: unknown };
    return { engaged: true, reason: typeof parsed.reason === "string" && parsed.reason ? parsed.reason : undefined };
  } catch {
    return { engaged: true };
  }
}

async function readEstopFile(): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(hermesHome(), "ESTOP"), "utf8");
  } catch {
    return undefined;
  }
}

/** Each surface, read in parallel and independently. */
export async function getAutomationSurfaces(): Promise<HermesAutomationSurfaces> {
  const [estop, scheduler, curator, kanban, hooks, webhooks] = await Promise.all([
    readEstopFile(),
    runHermesCli(["cron", "status"]).then(readSchedulerStatus, () => ({
      running: false,
      detail: "Hermes couldn't report whether its scheduler is running.",
    })),
    runHermesCli(["curator", "status"]).then(readCuratorStatus, (): HermesCurator => ({ state: "unknown" })),
    runHermesCli(["kanban", "stats", "--json"]).then(readKanbanStats, () => ({ readable: false, byStatus: {} })),
    runHermesCli(["hooks", "list"]).then(readHooksList, () => ({ configured: false, entries: [] })),
    runHermesCli(["webhook", "list"]).then(readWebhookList, () => ({ enabled: false, entries: [] })),
  ]);

  return { emergencyStop: readEmergencyStop(estop), scheduler, curator, kanban, hooks, webhooks };
}

/** Pause or resume the skill curator — reversible, and it never deletes a skill either way. */
export async function controlCurator(control: CuratorControl): Promise<void> {
  await runHermesCli(["curator", control]);
}

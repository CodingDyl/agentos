import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import { OperatorRunSchema, type OperatorRun, type OperatorRunSummary } from "../../shared/operator-types";

/**
 * Every Operator run, one JSON file each, outside the vault.
 *
 * `~/.agentos-ui/operator/<id>.json`. The vault stays human-owned; this is the
 * audit trail of what AgentOS did in it. Written atomically (temp file, then
 * rename), so a crash mid-write leaves the previous version rather than half
 * of the next one.
 */

const MAX_LISTED = 50;

function directory(): string {
  return path.join(uiStateDir(), "operator");
}

/** Run ids are minted here as `run_<uuid>`; anything else never reaches the filesystem. */
const RUN_ID = /^run_[a-f0-9-]{36}$/;

export function isRunId(id: string): boolean {
  return RUN_ID.test(id);
}

function fileFor(id: string): string {
  if (!isRunId(id)) throw new Error("Not a run id.");
  return path.join(directory(), `${id}.json`);
}

/** Writes to one run are serialised, so two updates can never interleave their renames. */
const queues = new Map<string, Promise<unknown>>();

export async function saveRun(run: OperatorRun): Promise<OperatorRun> {
  const previous = queues.get(run.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(directory(), { recursive: true });
    const target = fileFor(run.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  });
  queues.set(run.id, next.catch(() => undefined));
  await next;
  return run;
}

export async function readRun(id: string): Promise<OperatorRun | undefined> {
  if (!isRunId(id)) return undefined;
  try {
    const parsed = OperatorRunSchema.safeParse(JSON.parse(await fs.readFile(fileFor(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function listRuns(limit = MAX_LISTED): Promise<OperatorRun[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory());
  } catch {
    return [];
  }

  const runs = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => readRun(name.slice(0, -".json".length))),
  );

  return runs
    .filter((run): run is OperatorRun => run !== undefined)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

/** The list row: a title from the workspace or the first words, never the whole request. */
export function summarise(run: OperatorRun): OperatorRunSummary {
  const firstLine = run.input.split(/\r?\n/)[0] ?? "";
  const words = firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;

  return {
    id: run.id,
    input: run.input,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    workspaceId: run.workspaceId,
    title: run.intent?.workspace?.name ?? words,
    intent: run.intent?.interpretedAs,
  };
}

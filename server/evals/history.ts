import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { uiStateDir } from "../agentos/session-store";

/**
 * How each eval run scored, one JSON line per run, in AgentOS's UI state.
 *
 * Only the score is kept: when it ran, which suite, which commit, how many
 * passed. Never a prompt or a response, because an eval of mail would
 * otherwise leave mail text in a file nothing else guards.
 */

export const EvalRunSchema = z.object({
  at: z.string(),
  suite: z.string().min(1),
  commit: z.string(),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type EvalRun = z.infer<typeof EvalRunSchema>;

export function evalHistoryFile(): string {
  return path.join(uiStateDir(), "evals", "history.jsonl");
}

let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function appendEvalRun(run: EvalRun): Promise<void> {
  // Re-picked field by field: anything else on the object is dropped, not stored.
  const kept = EvalRunSchema.parse({ at: run.at, suite: run.suite, commit: run.commit, passed: run.passed, total: run.total });
  return serial(async () => {
    const file = evalHistoryFile();
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.appendFile(file, `${JSON.stringify(kept)}\n`, { encoding: "utf8", mode: 0o600 });
  });
}

/** Runs oldest first, optionally for one suite. An unreadable line is skipped. */
export async function readEvalHistory(suite?: string): Promise<EvalRun[]> {
  let raw: string;
  try {
    raw = await fs.readFile(evalHistoryFile(), "utf8");
  } catch {
    return [];
  }
  const runs: EvalRun[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = EvalRunSchema.safeParse(JSON.parse(line));
      if (parsed.success && (!suite || parsed.data.suite === suite)) runs.push(parsed.data);
    } catch {
      // A torn or hand-edited line costs only itself.
    }
  }
  return runs.sort((a, b) => a.at.localeCompare(b.at));
}

const rate = (run: Pick<EvalRun, "passed" | "total">) => (run.total === 0 ? 0 : run.passed / run.total);

/** The latest run against the one before it, by pass rate, so a changed number of cases still compares fairly. */
export function compareToPrevious(runs: readonly EvalRun[]): { verdict: "better" | "worse" | "same" | "first"; line: string } {
  const latest = runs.at(-1);
  if (!latest) return { verdict: "first", line: "No eval has run yet." };
  const previous = runs.at(-2);
  const score = `${latest.passed}/${latest.total}`;
  if (!previous) return { verdict: "first", line: `${score} on the first run.` };
  const before = `${previous.passed}/${previous.total}`;
  const delta = rate(latest) - rate(previous);
  if (Math.abs(delta) < 1e-9) return { verdict: "same", line: `${score}, the same as the last run.` };
  return delta > 0
    ? { verdict: "better", line: `${score}, better than ${before} last time.` }
    : { verdict: "worse", line: `${score}, worse than ${before} last time.` };
}

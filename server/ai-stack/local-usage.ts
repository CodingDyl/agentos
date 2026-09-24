import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { AiLocalUsage } from "../../shared/ai-stack-types";

/**
 * Usage for AIs that run outside AgentOS, read from their own local logs.
 *
 * Claude Code writes every assistant message, with its token usage, to
 * `~/.claude/projects/**.jsonl`; Codex writes `token_count` events to
 * `~/.codex/sessions/**.jsonl`. Those logs also hold full conversation
 * content, so the rule here is the same one the usage ledger keeps: only
 * token counts, model names and timestamps are ever extracted. A line is
 * parsed, its numbers are taken, and the rest is dropped on the spot — nothing
 * else about a conversation leaves this module.
 *
 * The logs are large (hundreds of MB), so each file's tally is cached against
 * its size and modification time and only re-read when it changes.
 */

export interface TokenCounts {
  input: number;
  output: number;
  cachedInput: number;
}

interface FileTally extends TokenCounts {
  byModel: Map<string, number>;
}

interface CachedTally {
  size: number;
  mtimeMs: number;
  since: number;
  tally: FileTally;
}

const cache = new Map<string, CachedTally>();

function emptyTally(): FileTally {
  return { input: 0, output: 0, cachedInput: 0, byModel: new Map() };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * One Claude Code log line, reduced to its token counts.
 *
 * `key` is the message id plus request id: Claude Code can write the same
 * assistant message more than once while it streams, and counting every copy
 * would inflate the totals.
 */
export function readClaudeLine(
  line: string,
  since: number,
): ({ key: string; model: string } & TokenCounts) | undefined {
  if (!line.includes('"usage"')) return undefined;

  let entry: Record<string, unknown> | undefined;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return undefined;
  }

  if (!entry || entry.type !== "assistant") return undefined;

  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < since) return undefined;

  const message = asRecord(entry.message);
  const usage = asRecord(message?.usage);
  if (!message || !usage) return undefined;

  const model = typeof message.model === "string" ? message.model : "unknown";
  // Placeholder entries Claude Code writes for its own bookkeeping, not model calls.
  if (model === "<synthetic>") return undefined;

  return {
    key: `${String(message.id ?? "")}:${String(entry.requestId ?? "")}`,
    model,
    input: asNumber(usage.input_tokens) + asNumber(usage.cache_creation_input_tokens),
    output: asNumber(usage.output_tokens),
    cachedInput: asNumber(usage.cache_read_input_tokens),
  };
}

/**
 * One Codex log line: either the model a turn switched to, or a turn's usage.
 *
 * `cumulative` is the session's running total. Codex sometimes repeats a
 * `token_count` event unchanged, and an unchanged running total is how a
 * repeat is recognised.
 */
export function readCodexLine(
  line: string,
  since: number,
): { model: string } | ({ cumulative: number } & TokenCounts) | undefined {
  const isUsage = line.includes("token_count");
  const isContext = line.includes("turn_context");
  if (!isUsage && !isContext) return undefined;

  let entry: Record<string, unknown> | undefined;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return undefined;
  }

  const payload = asRecord(entry?.payload);
  if (!entry || !payload) return undefined;

  if (entry.type === "turn_context" && typeof payload.model === "string") {
    return { model: payload.model };
  }

  if (payload.type !== "token_count") return undefined;

  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < since) return undefined;

  const info = asRecord(payload.info);
  const last = asRecord(info?.last_token_usage);
  const total = asRecord(info?.total_token_usage);
  if (!last) return undefined;

  // OpenAI's input count already includes the cached part.
  const cached = asNumber(last.cached_input_tokens);

  return {
    cumulative: asNumber(total?.total_tokens),
    input: Math.max(0, asNumber(last.input_tokens) - cached),
    output: asNumber(last.output_tokens),
    cachedInput: cached,
  };
}

async function tallyFile(file: string, since: number, tool: "claude" | "codex"): Promise<FileTally> {
  const tally = emptyTally();
  const seen = new Set<string>();
  let codexModel = "unknown";
  let lastCumulative = -1;

  const lines = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (tool === "claude") {
      const counts = readClaudeLine(line, since);
      if (!counts || seen.has(counts.key)) continue;
      seen.add(counts.key);
      add(tally, counts.model, counts);
      continue;
    }

    const read = readCodexLine(line, since);
    if (!read) continue;
    if ("model" in read) {
      codexModel = read.model;
      continue;
    }
    if (read.cumulative > 0 && read.cumulative === lastCumulative) continue;
    lastCumulative = read.cumulative;
    add(tally, codexModel, read);
  }

  return tally;
}

function add(tally: FileTally, model: string, counts: TokenCounts): void {
  tally.input += counts.input;
  tally.output += counts.output;
  tally.cachedInput += counts.cachedInput;
  tally.byModel.set(model, (tally.byModel.get(model) ?? 0) + counts.input + counts.output + counts.cachedInput);
}

/** Every `.jsonl` under `root` modified since `since`. Missing directory: none. */
async function recentLogs(root: string, since: number): Promise<{ file: string; size: number; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = (await fs.readdir(root, { recursive: true })) as string[];
  } catch {
    return [];
  }

  const files: { file: string; size: number; mtimeMs: number }[] = [];

  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(root, name);
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs >= since) files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Removed between listing and reading.
    }
  }

  return files;
}

async function readUsage(
  root: string,
  since: number,
  tool: "claude" | "codex",
  source: string,
): Promise<AiLocalUsage | undefined> {
  const files = await recentLogs(root, since);

  const total = emptyTally();
  let sessions = 0;

  for (const { file, size, mtimeMs } of files) {
    const cached = cache.get(file);
    let tally: FileTally;

    if (cached && cached.size === size && cached.mtimeMs === mtimeMs && cached.since === since) {
      tally = cached.tally;
    } else {
      try {
        tally = await tallyFile(file, since, tool);
      } catch {
        continue;
      }
      cache.set(file, { size, mtimeMs, since, tally });
    }

    const tokens = tally.input + tally.output + tally.cachedInput;
    if (tokens === 0) continue;

    sessions += 1;
    total.input += tally.input;
    total.output += tally.output;
    total.cachedInput += tally.cachedInput;
    for (const [model, value] of tally.byModel) {
      total.byModel.set(model, (total.byModel.get(model) ?? 0) + value);
    }
  }

  if (sessions === 0) return undefined;

  return {
    source,
    input: total.input,
    output: total.output,
    cachedInput: total.cachedInput,
    total: total.input + total.output + total.cachedInput,
    sessions,
    byModel: [...total.byModel.entries()]
      .map(([model, value]) => ({ model, total: value }))
      .sort((a, b) => b.total - a.total),
  };
}

export function readClaudeCodeUsage(since: number): Promise<AiLocalUsage | undefined> {
  return readUsage(path.join(os.homedir(), ".claude", "projects"), since, "claude", "Claude Code logs");
}

export function readCodexUsage(since: number): Promise<AiLocalUsage | undefined> {
  return readUsage(path.join(os.homedir(), ".codex", "sessions"), since, "codex", "Codex logs");
}

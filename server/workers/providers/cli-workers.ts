import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkerProviderMetrics } from "../../../shared/worker-types";
import { clip, createCliWorker, jsonLine, num, record, type CliOutputReader } from "./cli-worker";

/**
 * How each of the operator's coding CLIs is called and read. The engine that
 * runs them — isolation, streaming, timeouts, cancellation — is `cli-worker.ts`.
 */

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Claude Code, on the operator's own plan.
// ---------------------------------------------------------------------------

/** Tools Claude Code may use without asking. Edits are approved by the permission mode. */
const CLAUDE_ALLOWED = [
  "Read",
  "Glob",
  "Grep",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(node:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(ls:*)",
];

/** Refused whatever the prompt says, the same refusals the Grok worker runs with. */
const CLAUDE_DENIED = [
  "Bash(git push:*)",
  "Bash(git commit:*)",
  "Bash(git remote:*)",
  "Bash(git reset:*)",
  "Bash(git worktree:*)",
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Edit(**/.env)",
  "WebFetch",
  "WebSearch",
];

export function claudeCodeArgs(input: { prompt: string; model?: string }): string[] {
  return [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    // Project settings only: the operator's own user settings, hooks and MCP
    // servers are theirs, not the job's. (Not `--bare`: that would force API-key
    // billing and bypass the plan this worker exists to use.)
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    ...(input.model ? ["--model", input.model] : []),
    "--allowedTools",
    ...CLAUDE_ALLOWED,
    "--disallowedTools",
    ...CLAUDE_DENIED,
  ];
}

export function claudeCodeReader(): CliOutputReader {
  let model: string | undefined;
  let result: Record<string, unknown> | undefined;

  return {
    line(line) {
      const event = jsonLine(line);
      if (!event) return undefined;

      if (event.type === "system" && event.subtype === "init") {
        model = typeof event.model === "string" ? event.model : model;
        return { message: `Claude Code started${model ? ` · ${model}` : ""}` };
      }

      if (event.type === "assistant") {
        const content = record(event.message)?.content;
        if (!Array.isArray(content)) return undefined;

        for (const part of content) {
          const block = record(part);
          if (block?.type === "tool_use" && typeof block.name === "string") return { message: `Using ${block.name}` };
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) return { message: clip(block.text) };
        }
      }

      if (event.type === "result") result = event;
      return undefined;
    },

    async finish() {
      if (!result) return { blockers: ["Claude Code ended without reporting a result."] };

      const usage = record(result.usage);
      const input = (num(usage?.input_tokens) ?? 0) + (num(usage?.cache_creation_input_tokens) ?? 0);
      const output = num(usage?.output_tokens) ?? 0;
      const cached = num(usage?.cache_read_input_tokens) ?? 0;

      const metrics: WorkerProviderMetrics = {
        provider: "anthropic",
        model,
        turns: num(result.num_turns),
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cached,
        totalTokens: input + output + cached,
        measurement: usage ? "exact" : "unknown",
        sessionId: typeof result.session_id === "string" ? result.session_id : undefined,
        // No cost: this runs on the operator's plan. `total_cost_usd` is what
        // the same run would have cost on the API, not what anyone was billed.
      };

      const failed = result.is_error === true || (typeof result.subtype === "string" && result.subtype !== "success");

      return {
        summary: typeof result.result === "string" ? result.result : undefined,
        metrics,
        blockers: failed ? [`Claude Code stopped: ${String(result.subtype ?? "error")}.`] : undefined,
      };
    },
  };
}

export const claudeCodeWorker = createCliWorker({
  id: "claude-code",
  name: "Claude Code",
  role: "Implementation on your Claude plan — writes code in an isolated checkout",
  capabilities: ["code", "review", "research"],
  binary: "claude",
  installHint: "Install Claude Code: https://docs.claude.com/claude-code.",
  ready: async () =>
    (await exists(path.join(os.homedir(), ".claude")))
      ? { ok: true }
      : { ok: false, reason: "Claude Code has never been signed in on this machine. Run `claude` once and log in." },
  args: ({ prompt, model }) => claudeCodeArgs({ prompt, model }),
  env: (base) => {
    // Without these removed, Claude Code would bill the API key AgentOS holds
    // instead of the operator's plan — the one thing this worker is for.
    const env: NodeJS.ProcessEnv = { ...base, DISABLE_AUTOUPDATER: "1" };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
  },
  reader: () => claudeCodeReader(),
});

// ---------------------------------------------------------------------------
// Codex, on the operator's ChatGPT plan.
// ---------------------------------------------------------------------------

export function codexArgs(input: { cwd: string; prompt: string; model?: string; lastMessage: string }): string[] {
  return [
    "exec",
    "--json",
    // Writes confined to the worktree, network off: Codex's own sandbox.
    "--sandbox",
    "workspace-write",
    "--cd",
    input.cwd,
    "--skip-git-repo-check",
    "--output-last-message",
    input.lastMessage,
    // An update mid-job replaces the binary underneath the run.
    "-c",
    "check_for_update_on_startup=false",
    ...(input.model ? ["--model", input.model] : []),
    input.prompt,
  ];
}

export function codexReader(model?: string): CliOutputReader {
  let lastMessage: string | undefined;
  let input = 0;
  let cached = 0;
  let output = 0;
  let measured = false;
  const blockers: string[] = [];

  return {
    line(line) {
      const event = jsonLine(line);
      if (!event) return undefined;

      if (event.type === "turn.completed") {
        const usage = record(event.usage);
        if (usage) {
          measured = true;
          input += num(usage.input_tokens) ?? 0;
          cached += num(usage.cached_input_tokens) ?? 0;
          output += num(usage.output_tokens) ?? 0;
        }
        return undefined;
      }

      if (event.type === "turn.failed" || event.type === "error") {
        const message = String(record(event.error)?.message ?? event.message ?? "Codex reported an error.");
        blockers.push(message);
        return { message: clip(message) };
      }

      if (event.type !== "item.completed") return undefined;
      const item = record(event.item);

      if (item?.type === "agent_message" && typeof item.text === "string") {
        lastMessage = item.text;
        return { message: clip(item.text) };
      }
      if (item?.type === "command_execution" && typeof item.command === "string") return { message: `Ran ${clip(item.command, 120)}` };
      if (item?.type === "file_change" && Array.isArray(item.changes)) {
        const paths = item.changes.map((change) => record(change)?.path).filter((value): value is string => typeof value === "string");
        return { message: `Changed ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}` };
      }
      return undefined;
    },

    async finish(_stdout, files) {
      const fromFile = await fs.readFile(files.lastMessage, "utf8").catch(() => undefined);

      return {
        summary: fromFile?.trim() || lastMessage,
        blockers,
        metrics: {
          provider: "openai",
          model,
          // OpenAI's input count already includes the cached part.
          inputTokens: Math.max(0, input - cached),
          cachedTokens: cached,
          outputTokens: output,
          totalTokens: input + output,
          measurement: measured ? "exact" : "unknown",
        },
      };
    },
  };
}

export const codexWorker = createCliWorker({
  id: "codex",
  name: "Codex",
  role: "Implementation on your ChatGPT plan — writes code in a sandboxed checkout",
  capabilities: ["code", "review"],
  binary: "codex",
  installHint: "Install it with `npm install -g @openai/codex`.",
  ready: async () =>
    (await exists(path.join(os.homedir(), ".codex", "auth.json")))
      ? { ok: true }
      : { ok: false, reason: "Codex is not signed in. Run `codex login`." },
  args: ({ cwd, prompt, model, files }) => codexArgs({ cwd, prompt, model, lastMessage: files.lastMessage }),
  reader: ({ model }) => codexReader(model),
});

// ---------------------------------------------------------------------------
// Gemini CLI.
// ---------------------------------------------------------------------------

export const geminiWorker = createCliWorker({
  id: "gemini",
  name: "Gemini CLI",
  role: "Implementation on your Google plan — writes code in an isolated checkout",
  capabilities: ["code", "research"],
  binary: "gemini",
  installHint: "Install it with `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.",
  // Edits approved automatically; shell commands are not, so they are refused
  // rather than run in a job nobody is watching.
  args: ({ prompt, model }) => ["-p", prompt, "--approval-mode", "auto_edit", ...(model ? ["--model", model] : [])],
  reader: () => {
    return {
      line: (line) => (line.trim() ? { message: clip(line) } : undefined),
      finish: async (stdout) => ({
        summary: stdout.trim().split("\n").slice(-30).join("\n"),
        // Gemini's plain-text mode reports no usage; unknown is the honest answer.
        metrics: { provider: "google", measurement: "unknown" },
      }),
    };
  },
});

// ---------------------------------------------------------------------------
// Hermes, as a worker rather than the orchestrator.
// ---------------------------------------------------------------------------

export function hermesUsage(report: unknown): WorkerProviderMetrics {
  const data = record(report) ?? {};
  const tokens = record(data.tokens) ?? record(data.usage) ?? data;
  const input = num(tokens.input_tokens) ?? num(tokens.prompt_tokens) ?? num(tokens.input);
  const output = num(tokens.output_tokens) ?? num(tokens.completion_tokens) ?? num(tokens.output);
  const total = num(tokens.total_tokens) ?? num(tokens.total) ?? (input !== undefined && output !== undefined ? input + output : undefined);

  return {
    provider: typeof data.provider === "string" ? data.provider : "hermes",
    model: typeof data.model === "string" ? data.model : undefined,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    // Hermes' own report estimates cost; an estimate is not recorded as a price.
    measurement: total !== undefined ? "exact" : "unknown",
  };
}

export const hermesWorker = createCliWorker({
  id: "hermes-worker",
  name: "Hermes Agent",
  role: "Implementation through Hermes' own tools — writes code in an isolated checkout",
  capabilities: ["code", "research"],
  binary: "hermes",
  installHint: "Install Hermes Agent and make sure `hermes` is on your PATH.",
  // `--ignore-rules` keeps Hermes' persona out of a coding job (its SOUL.md
  // otherwise reshapes the output). No `--yolo`: risky commands are refused,
  // not approved, because Hermes has no sandbox of its own.
  args: ({ cwd, prompt, model, files }) => ["-z", prompt, "--in", cwd, "--ignore-rules", "--usage-file", files.usage, ...(model ? ["-m", model] : [])],
  reader: () => ({
    line: (line) => (line.trim() ? { message: clip(line) } : undefined),
    finish: async (stdout, files) => {
      const report = await fs
        .readFile(files.usage, "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined);

      return { summary: stdout.trim(), metrics: hermesUsage(report) };
    },
  }),
});

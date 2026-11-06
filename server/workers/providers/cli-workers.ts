import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normaliseWorkerModel } from "../../ai-stack/model-names";
import { findOnPath } from "../../ai-stack/detect";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkerProviderMetrics } from "../../../shared/worker-types";
import { clip, createCliWorker, jsonLine, num, record, type CliOutputReader } from "./cli-worker";
import { codexSandboxFlags, geminiIncludeFlags } from "../git-sandbox";

const run = promisify(execFile);

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
  "Bash(git show:*)",
  "Bash(git ls-tree:*)",
  "Bash(git merge-base:*)",
  "Bash(git rev-list:*)",
  "Bash(ls:*)",
];

/**
 * Refused whatever the prompt says, the same refusals the Grok worker runs with.
 *
 * WebFetch and WebSearch are not here: deny outranks allow, so listing them
 * made a job's own grant (Motion Design asks for WebFetch) silently useless.
 * They stay off by default because they are not in CLAUDE_ALLOWED, and an
 * unlisted tool is refused in a headless run.
 */
const CLAUDE_DENIED = [
  "Bash(git push:*)",
  "Bash(git commit:*)",
  "Bash(git remote:*)",
  "Bash(git reset:*)",
  "Bash(git worktree:*)",
  "Bash(git fetch:*)",
  "Bash(git pull:*)",
  "Bash(git merge:*)",
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Edit(**/.env)",
];

/**
 * MCP servers a job may be handed. Headless and isolated, so a worker's browser
 * never opens a window on the operator's screen or touches a real profile.
 */
const CLAUDE_MCP_SERVERS = {
  playwright: { command: "npx", args: ["@playwright/mcp@latest", "--headless", "--isolated"] },
} as const;

export type ClaudeMcpServerId = keyof typeof CLAUDE_MCP_SERVERS;

function mcpArgs(servers: readonly ClaudeMcpServerId[] | undefined): { config: string[]; tools: string[] } {
  const ids = [...new Set(servers ?? [])];
  if (ids.length === 0) return { config: [], tools: [] };
  const mcpServers = Object.fromEntries(ids.map((id) => [id, CLAUDE_MCP_SERVERS[id]]));
  return {
    config: ["--mcp-config", JSON.stringify({ mcpServers })],
    // A bare server name allows every tool that server offers.
    tools: ids.map((id) => `mcp__${id}`),
  };
}

export function claudeCodeArgs(input: {
  prompt: string;
  model?: string;
  effort?: string;
  extraAllowedTools?: string[];
  settingSources?: string;
  mcpServers?: readonly ClaudeMcpServerId[];
  writableRoots?: string[];
  /** Folders the job may read but never change: added, then denied to Edit and Write. */
  readOnlyRoots?: string[];
  reportOnly?: boolean;
}): string[] {
  const mcp = mcpArgs(input.mcpServers);
  const readOnly = input.readOnlyRoots ?? [];
  const extraDirs = [...(input.writableRoots ?? []), ...readOnly].flatMap((root) => ["--add-dir", root]);
  return [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    ...extraDirs,
    // Project settings only by default: the operator's own user settings, hooks
    // and MCP servers are theirs, not the job's. Motion Design passes
    // `user,project` so ~/.claude/skills and a Higgsfield MCP are available.
    "--setting-sources",
    input.settingSources?.trim() || "project",
    "--strict-mcp-config",
    ...mcp.config,
    ...(input.model ? ["--model", input.model] : []),
    ...(input.effort ? ["--effort", input.effort] : []),
    "--allowedTools",
    ...CLAUDE_ALLOWED,
    ...(input.extraAllowedTools ?? []),
    ...mcp.tools,
    "--disallowedTools",
    ...CLAUDE_DENIED,
    ...(input.reportOnly ? ["Edit", "Write", "NotebookEdit"] : []),
    // `//` marks an absolute path in a Claude Code permission rule.
    ...readOnly.flatMap((root) => [`Edit(/${root}/**)`, `Write(/${root}/**)`, `NotebookEdit(/${root}/**)`]),
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
  role: "Implementation on your Claude plan. Writes code in an isolated checkout",
  capabilities: ["code", "review", "research"],
  binary: "claude",
  installHint: "Install Claude Code: https://docs.claude.com/claude-code.",
  ready: async () =>
    (await exists(path.join(os.homedir(), ".claude")))
      ? { ok: true }
      : { ok: false, reason: "Claude Code has never been signed in on this machine. Run `claude` once and log in." },
  args: ({ prompt, model, job, writableRoots }) =>
    claudeCodeArgs({
      prompt,
      model,
      effort: job.effort,
      extraAllowedTools: job.extraAllowedTools,
      settingSources: job.claudeSettingSources,
      mcpServers: job.claudeMcpServers,
      writableRoots,
      readOnlyRoots: job.claudeReadOnlyRoots,
      reportOnly: job.reportOnly,
    }),
  env: (base) => {
    // Without these removed, Claude Code would bill the API key AgentOS holds
    // instead of the operator's plan — the one thing this worker is for.
    const env: NodeJS.ProcessEnv = { ...base, DISABLE_AUTOUPDATER: "1" };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    // Claude Code reads ANTHROPIC_MODEL when no --model is passed. A display name
    // there ("Opus 5.5") fails every job with unrecognized_model, so it is
    // translated like the AI Stack field, or dropped if it can't be.
    if (env.ANTHROPIC_MODEL !== undefined) {
      const model = normaliseWorkerModel("claude-code", env.ANTHROPIC_MODEL).model;
      if (model) env.ANTHROPIC_MODEL = model;
      else delete env.ANTHROPIC_MODEL;
    }
    return env;
  },
  reader: () => claudeCodeReader(),
});

// ---------------------------------------------------------------------------
// Codex, on the operator's ChatGPT plan.
// ---------------------------------------------------------------------------

export function codexArgs(input: {
  cwd: string;
  prompt: string;
  model?: string;
  lastMessage: string;
  writableRoots?: string[];
  reportOnly?: boolean;
}): string[] {
  return [
    "exec",
    "--json",
    // Writes confined to the worktree, network off: Codex's own sandbox.
    // Git metadata lives outside the worktree; extra writable roots cover it.
    "--sandbox",
    input.reportOnly ? "read-only" : "workspace-write",
    "--cd",
    input.cwd,
    "--skip-git-repo-check",
    "--output-last-message",
    input.lastMessage,
    // An update mid-job replaces the binary underneath the run.
    "-c",
    "check_for_update_on_startup=false",
    // `codex exec` does not take `--ask-for-approval` (that flag is top-level
    // `codex` only). A headless job must never pause for a person, so the
    // approval policy is set as config instead.
    "-c",
    'approval_policy="never"',
    ...codexSandboxFlags(input.cwd, input.writableRoots ?? []),
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
  role: "Implementation on your ChatGPT plan. Writes code in a sandboxed checkout",
  capabilities: ["code", "review"],
  binary: "codex",
  installHint: "Install it with `npm install -g @openai/codex`.",
  ready: async () =>
    (await exists(path.join(os.homedir(), ".codex", "auth.json")))
      ? { ok: true }
      : { ok: false, reason: "Codex is not signed in. Run `codex login`." },
  args: ({ cwd, prompt, model, files, writableRoots, job }) =>
    codexArgs({ cwd, prompt, model, lastMessage: files.lastMessage, writableRoots, reportOnly: job.reportOnly }),
  reader: ({ model }) => codexReader(model),
});

// ---------------------------------------------------------------------------
// Gemini CLI.
// ---------------------------------------------------------------------------

export const geminiWorker = createCliWorker({
  id: "gemini",
  name: "Gemini CLI",
  role: "Implementation on your Google plan. Writes code in an isolated checkout",
  capabilities: ["code", "research"],
  binary: "gemini",
  installHint: "Install it with `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.",
  // Edits approved automatically; shell commands are not, so they are refused
  // rather than run in a job nobody is watching.
  args: ({ prompt, model, writableRoots }) => [
    "-p",
    prompt,
    "--approval-mode",
    "auto_edit",
    ...geminiIncludeFlags(writableRoots ?? []),
    ...(model ? ["--model", model] : []),
  ],
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
  role: "Implementation through Hermes' own tools. Writes code in an isolated checkout",
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

// ---------------------------------------------------------------------------
// Cursor Agent, on the operator's Cursor plan.
//
// The binary is `cursor-agent`, never `agent`: on this machine `agent` is
// Grok Build, and the Cursor installer would replace that symlink.
// ---------------------------------------------------------------------------

/** Refused even with `--force`. Deny outranks the auto-approval a headless run needs. */
export const CURSOR_DENY = [
  "Shell(git:push*)",
  "Shell(git:commit*)",
  "Shell(git:remote*)",
  "Shell(git:reset*)",
  "Shell(git:fetch*)",
  "Shell(git:pull*)",
  "Shell(git:merge*)",
  "Shell(git:rebase*)",
  "Shell(git:worktree*)",
  "Shell(sudo)",
  "Shell(rm)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Write(**/.env)",
  "Write(**/.env.*)",
  "Write(**/*.pem)",
  "Write(**/*.key)",
  // A headless job must not hang on an MCP or web-fetch prompt, and must not
  // inherit the operator's connectors.
  "Mcp(*:*)",
  "WebFetch(*)",
] as const;

export function cursorDenyRules(reportOnly: boolean): string[] {
  return reportOnly ? [...CURSOR_DENY, "Write(**)"] : [...CURSOR_DENY];
}

/** `cursor-agent status` text. Signed out is a sentence, not a thrown error. */
export function cursorSignedIn(statusText: string): boolean {
  return !/not logged in/i.test(statusText);
}

/** Adds this job's refusals to a project CLI config without dropping what was already there. */
export function mergeCursorPermissions(existing: unknown, deny: readonly string[]): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const permissions =
    base.permissions && typeof base.permissions === "object" && !Array.isArray(base.permissions)
      ? { ...(base.permissions as Record<string, unknown>) }
      : {};
  const current = Array.isArray(permissions.deny)
    ? permissions.deny.filter((entry): entry is string => typeof entry === "string")
    : [];
  const next = [...current];
  for (const rule of deny) {
    if (!next.includes(rule)) next.push(rule);
  }
  permissions.deny = next;
  base.permissions = permissions;
  return base;
}

/**
 * Writes `<worktree>/.cursor/cli.json` for this job only, and puts the file
 * back afterwards. The path has to stay inside the worktree: a symlink there
 * would otherwise land the refusals, or a restore, somewhere else.
 */
export async function installCursorJobPermissions(
  cwd: string,
  deny: readonly string[],
): Promise<() => Promise<void>> {
  const root = await fs.realpath(cwd);
  const dir = path.join(root, ".cursor");
  const file = path.join(dir, "cli.json");

  const inside = (candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

  let original: string | undefined;
  let exists = true;
  try {
    await fs.lstat(file);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") throw error;
    exists = false;
  }

  if (!exists) {
    original = undefined;
  } else {
    // A symlink, including a dangling one, has to resolve inside the checkout
    // before anything is written through it.
    let resolved: string;
    try {
      resolved = await fs.realpath(file);
    } catch {
      throw new Error("Cursor's CLI config points outside the job checkout.");
    }
    if (!inside(resolved)) throw new Error("Cursor's CLI config points outside the job checkout.");
    original = await fs.readFile(resolved, "utf8");
  }

  let parsed: unknown = {};
  if (original !== undefined) {
    try {
      parsed = JSON.parse(original) as unknown;
    } catch {
      // A config this job cannot read is left untouched. The sandbox and the
      // brief still apply; guessing at a rewrite could drop the project's rules.
      return async () => undefined;
    }
  }

  await fs.mkdir(dir, { recursive: true });
  const resolvedDir = await fs.realpath(dir);
  if (!inside(resolvedDir)) throw new Error("Cursor's CLI config directory points outside the job checkout.");

  await fs.writeFile(file, `${JSON.stringify(mergeCursorPermissions(parsed, deny), null, 2)}\n`, "utf8");

  return async () => {
    if (original !== undefined) await fs.writeFile(file, original, "utf8");
    else await fs.rm(file, { force: true });
  };
}

export function cursorArgs(input: {
  cwd: string;
  prompt: string;
  model?: string;
  writableRoots?: string[];
  reportOnly?: boolean;
}): string[] {
  const roots = (input.writableRoots ?? []).filter((root) => path.resolve(root) !== path.resolve(input.cwd));
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--trust",
    "--sandbox",
    "enabled",
    "--force",
    "--workspace",
    input.cwd,
    ...roots.flatMap((root) => ["--add-dir", root]),
    ...(input.reportOnly ? ["--mode", "ask"] : []),
    ...(input.model ? ["--model", input.model] : []),
    input.prompt,
  ];
}

export function cursorReader(model?: string): CliOutputReader {
  let seenModel = model;
  let result: Record<string, unknown> | undefined;
  let summary: string | undefined;

  return {
    line(line) {
      const event = jsonLine(line);
      if (!event) return line.trim() ? { message: clip(line) } : undefined;

      if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") {
        seenModel = event.model;
        return { message: `Cursor started · ${seenModel}` };
      }

      if (event.type === "assistant") {
        // Partial deltas repeat the text the complete message already carries.
        if ("timestamp_ms" in event) return undefined;
        const content = record(event.message)?.content;
        if (!Array.isArray(content)) return undefined;
        for (const part of content) {
          const block = record(part);
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
            summary = block.text;
            return { message: clip(block.text) };
          }
        }
        return undefined;
      }

      if (event.type === "tool_call" && event.subtype === "started") {
        const call = record(event.tool_call);
        const name = call ? Object.keys(call)[0]?.replace(/ToolCall$/, "") : "tool";
        return { message: `Using ${name || "tool"}` };
      }

      if (event.type === "result") result = event;
      return undefined;
    },

    async finish() {
      const usage = record(result?.usage);
      const input = num(usage?.input_tokens);
      const output = num(usage?.output_tokens);
      const failed = result?.is_error === true || (typeof result?.subtype === "string" && result.subtype !== "success");
      const text = typeof result?.result === "string" && result.result.trim() ? result.result : summary;

      const metrics: WorkerProviderMetrics = {
        provider: "cursor",
        model: seenModel,
        inputTokens: input,
        outputTokens: output,
        totalTokens: input !== undefined && output !== undefined ? input + output : undefined,
        measurement: usage ? "exact" : "unknown",
        sessionId: typeof result?.session_id === "string" ? result.session_id : undefined,
      };

      return {
        summary: text,
        metrics,
        blockers: !result
          ? ["Cursor ended without reporting a result."]
          : failed
            ? [`Cursor stopped: ${String(result.subtype ?? "error")}.`]
            : undefined,
      };
    },
  };
}

export const cursorWorker = createCliWorker({
  id: "cursor",
  name: "Cursor",
  role: "Implementation on your Cursor plan. Writes code in an isolated checkout",
  capabilities: ["code", "review", "research"],
  binary: "cursor-agent",
  installHint:
    "Install Cursor's CLI so `cursor-agent` is on your PATH, then run `cursor-agent login`. Leave the `agent` command alone when it is Grok.",
  ready: async () => {
    const binary = await findOnPath("cursor-agent");
    if (!binary) return { ok: false, reason: "cursor-agent is not installed." };
    try {
      const { stdout } = await run(binary, ["status"], { timeout: 8_000 });
      return cursorSignedIn(stdout)
        ? { ok: true }
        : { ok: false, reason: "Cursor Agent is not signed in. Run `cursor-agent login`." };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/not logged in/i.test(detail)) {
        return { ok: false, reason: "Cursor Agent is not signed in. Run `cursor-agent login`." };
      }
      return { ok: false, reason: `Cursor Agent could not report its sign-in: ${detail}` };
    }
  },
  prepare: ({ cwd, job }) => installCursorJobPermissions(cwd, cursorDenyRules(job.reportOnly === true)),
  args: ({ cwd, prompt, model, writableRoots, job }) =>
    cursorArgs({ cwd, prompt, model, writableRoots, reportOnly: job.reportOnly }),
  reader: ({ model }) => cursorReader(model),
});

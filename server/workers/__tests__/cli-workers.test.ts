import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { buildCliPrompt } from "../providers/cli-worker";
import { launchFailureMessage, preflightCliFlags, unsupportedFlagName } from "../providers/cli-worker";
import { claudeCodeArgs, claudeCodeReader, codexArgs, codexReader, hermesUsage } from "../providers/cli-workers";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cli-workers-"));
const files = { lastMessage: path.join(scratch, "last.txt"), usage: path.join(scratch, "usage.json") };

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("the CLI worker brief", () => {
  it("wraps the context packet and forbids committing and reading .env", () => {
    const prompt = buildCliPrompt("OBJECTIVE: fix the header");
    assert.match(prompt, /OBJECTIVE: fix the header/);
    assert.match(prompt, /Do not commit, push/);
    assert.match(prompt, /\.env/);
  });
});

describe("Claude Code", () => {
  it("runs on the operator's plan, with the job's refusals, and never bare", () => {
    const args = claudeCodeArgs({ prompt: "go", model: "sonnet" });

    assert.ok(!args.includes("--bare"));
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    assert.equal(args[args.indexOf("--setting-sources") + 1], "project");
    assert.ok(!args.includes("--effort"));
    assert.ok(args.includes("Bash(git push:*)"));
    assert.ok(args.indexOf("Bash(git push:*)") > args.indexOf("--disallowedTools"));
  });

  it("can raise effort, allow extra tools, and load user skills for a Motion Design job", () => {
    const args = claudeCodeArgs({
      prompt: "/motion-site-studio",
      model: "claude-opus-5-5",
      effort: "max",
      extraAllowedTools: ["Write", "Bash(higgsfield:*)"],
      settingSources: "user,project",
    });
    assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5-5");
    assert.equal(args[args.indexOf("--effort") + 1], "max");
    assert.equal(args[args.indexOf("--setting-sources") + 1], "user,project");
    assert.ok(args.includes("Write"));
    assert.ok(args.includes("Bash(higgsfield:*)"));
    assert.ok(args.indexOf("Write") > args.indexOf("--allowedTools"));
    assert.ok(args.indexOf("Write") < args.indexOf("--disallowedTools"));
  });

  it("never denies WebFetch outright, so a job's own grant takes effect", () => {
    const plain = claudeCodeArgs({ prompt: "go" });
    assert.ok(!plain.includes("WebFetch"), "off by default: not allowed, not denied");

    const granted = claudeCodeArgs({ prompt: "go", extraAllowedTools: ["WebFetch"] });
    assert.equal(granted.lastIndexOf("WebFetch"), granted.indexOf("WebFetch"));
    assert.ok(granted.indexOf("WebFetch") < granted.indexOf("--disallowedTools"));
  });

  it("hands a job only the MCP servers it asked for, headless and allowed", () => {
    assert.ok(!claudeCodeArgs({ prompt: "go" }).includes("--mcp-config"));

    const args = claudeCodeArgs({ prompt: "go", mcpServers: ["playwright"] });
    assert.ok(args.includes("--strict-mcp-config"));
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    assert.equal(config.mcpServers.playwright.command, "npx");
    assert.ok(config.mcpServers.playwright.args.includes("--headless"));
    assert.ok(args.indexOf("mcp__playwright") > args.indexOf("--allowedTools"));
    assert.ok(args.indexOf("mcp__playwright") < args.indexOf("--disallowedTools"));
  });

  it("reads tokens from the result event and records no cost", async () => {
    const reader = claudeCodeReader();
    assert.equal(reader.line(JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-6" }))?.message, "Claude Code started · claude-sonnet-4-6");
    assert.equal(
      reader.line(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }))?.message,
      "Using Edit",
    );
    reader.line(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Fixed the header.",
        num_turns: 4,
        total_cost_usd: 0.42,
        session_id: "abc",
        usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 },
      }),
    );

    const outcome = await reader.finish("", files);
    assert.equal(outcome.summary, "Fixed the header.");
    assert.equal(outcome.blockers, undefined);
    assert.equal(outcome.metrics?.costUsd, undefined);
    assert.equal(outcome.metrics?.inputTokens, 15);
    assert.equal(outcome.metrics?.cachedTokens, 100);
    assert.equal(outcome.metrics?.totalTokens, 135);
    assert.equal(outcome.metrics?.measurement, "exact");
  });

  it("says so when it never reported a result", async () => {
    const outcome = await claudeCodeReader().finish("", files);
    assert.match(outcome.blockers?.[0] ?? "", /without reporting a result/);
  });

  it("turns an error result into a blocker", async () => {
    const reader = claudeCodeReader();
    reader.line(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
    assert.match((await reader.finish("", files)).blockers?.[0] ?? "", /error_max_turns/);
  });
});

describe("Codex", () => {
  it("runs sandboxed in the worktree with auto-update off", () => {
    const args = codexArgs({ cwd: "/tmp/wt", prompt: "go", lastMessage: "/tmp/last" });
    assert.equal(args[0], "exec");
    assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
    // `codex exec` (0.156+) rejects `--ask-for-approval`; unattended approval
    // is a config override instead. Sandbox and writable-roots stay as they were.
    assert.ok(!args.includes("--ask-for-approval"));
    assert.ok(!args.includes("--full-auto"));
    const policy = args.indexOf('approval_policy="never"');
    assert.ok(policy > 0);
    assert.equal(args[policy - 1], "-c");
    assert.equal(args[args.indexOf("--cd") + 1], "/tmp/wt");
    assert.ok(args.includes("check_for_update_on_startup=false"));
    assert.ok(!args.includes("--model"));
    assert.equal(args.at(-1), "go");
    assert.equal(preflightCliFlags("codex", args), undefined);
  });

  it("preflight refuses the old --ask-for-approval exec flag", () => {
    const message = preflightCliFlags("codex", ["exec", "--ask-for-approval", "never"]);
    assert.match(message ?? "", /does not accept --ask-for-approval/);
    assert.match(message ?? "", /approval_policy/);
    assert.equal(preflightCliFlags("claude", ["--ask-for-approval", "never"]), undefined);
  });

  it("adds git metadata outside the worktree as writable roots", () => {
    const args = codexArgs({
      cwd: "/tmp/wt",
      prompt: "go",
      lastMessage: "/tmp/last",
      writableRoots: ["/repo/.git/worktrees/job", "/repo/.git"],
    });
    assert.ok(args.includes("--add-dir"));
    assert.ok(args.includes("/repo/.git/worktrees/job"));
    const roots = args.find((arg) => arg.includes("sandbox_workspace_write.writable_roots="));
    assert.match(roots ?? "", /sandbox_workspace_write.writable_roots=/);
    assert.equal(args[args.indexOf(roots!) - 1], "-c");
    assert.ok(args.includes('approval_policy="never"'));
  });

  it("sums turn usage, keeps cached apart, and prefers the last-message file", async () => {
    const reader = codexReader("gpt-5-codex");
    reader.line(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "streamed" } }));
    assert.equal(reader.line(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test" } }))?.message, "Ran npm test");
    reader.line(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } }));
    reader.line(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 5 } }));
    fs.writeFileSync(files.lastMessage, "From the file.\n");

    const outcome = await reader.finish("", files);
    assert.equal(outcome.summary, "From the file.");
    assert.equal(outcome.metrics?.model, "gpt-5-codex");
    assert.equal(outcome.metrics?.inputTokens, 110);
    assert.equal(outcome.metrics?.cachedTokens, 40);
    assert.equal(outcome.metrics?.outputTokens, 15);
    assert.equal(outcome.metrics?.totalTokens, 165);
    assert.equal(outcome.metrics?.costUsd, undefined);
    fs.rmSync(files.lastMessage);
  });

  it("records a failed turn as a blocker", async () => {
    const reader = codexReader();
    reader.line(JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached" } }));
    const outcome = await reader.finish("", files);
    assert.deepEqual(outcome.blockers, ["usage limit reached"]);
    assert.equal(outcome.metrics?.measurement, "unknown");
  });
});

describe("Hermes usage report", () => {
  it("reads tokens in either naming, and never an estimated cost", () => {
    const metrics = hermesUsage({ model: "anthropic/claude-sonnet-4.6", provider: "openrouter", usage: { prompt_tokens: 7, completion_tokens: 3 }, cost_usd: 0.01 });
    assert.equal(metrics.totalTokens, 10);
    assert.equal(metrics.provider, "openrouter");
    assert.equal(metrics.measurement, "exact");
    assert.equal(metrics.costUsd, undefined);
  });

  it("is unknown when there is no report", () => {
    assert.equal(hermesUsage(undefined).measurement, "unknown");
  });
});

describe("why a CLI exited badly", async () => {
  const { exitDetail } = await import("../providers/cli-worker");
  it("prefers stderr", () => {
    assert.equal(exitDetail("", "line one\nError: not logged in\n"), "line one Error: not logged in");
  });
  it("reads Claude Code's result event from stdout when stderr is empty", () => {
    const stdout = ['{"type":"system","subtype":"init"}', '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Claude AI usage limit reached|1760000000"}'].join("\n");
    assert.equal(exitDetail(stdout, ""), "Claude AI usage limit reached|1760000000");
  });
  it("falls back to the result subtype, then to plain output", () => {
    assert.equal(exitDetail('{"type":"result","subtype":"error_max_turns","is_error":true}', ""), "error max turns");
    assert.equal(exitDetail("Invalid API key · Please run /login\n", ""), "Invalid API key · Please run /login");
    assert.equal(exitDetail("", ""), "");
  });
  it("names an unsupported flag from clap usage text", () => {
    const clap =
      "error: unexpected argument '--ask-for-approval' found\n\n  tip: to pass '--ask-for-approval' as a value, use '-- --ask-for-approval'\nUsage: codex exec [OPTIONS] [PROMPT]";
    assert.equal(unsupportedFlagName(clap.replace(/\s+/g, " ")), "--ask-for-approval");
    assert.match(
      launchFailureMessage("Codex", 2, null, "", clap),
      /rejected launch flag --ask-for-approval/,
    );
  });
});

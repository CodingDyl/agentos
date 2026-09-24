import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { buildCliPrompt } from "../providers/cli-worker";
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
    assert.ok(args.includes("Bash(git push:*)"));
    assert.ok(args.indexOf("Bash(git push:*)") > args.indexOf("--disallowedTools"));
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
    assert.equal(args[args.indexOf("--cd") + 1], "/tmp/wt");
    assert.ok(args.includes("check_for_update_on_startup=false"));
    assert.ok(!args.includes("--model"));
    assert.equal(args.at(-1), "go");
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

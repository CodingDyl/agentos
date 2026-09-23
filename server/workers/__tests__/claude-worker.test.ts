import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClaudeStream } from "../providers/claude-events";
import {
  allowedTools,
  buildQueryOptions,
  deniedTools,
  validationRules,
  workerConfigDir,
} from "../providers/claude-worker";
import type { WorkerJob } from "../../../shared/worker-types";

/**
 * The Claude adapter, tested where it can be tested without spending money.
 *
 * The same two things carry the risk here as in any provider adapter: what the
 * run is permitted to do, and how the stream coming back is read. Both are
 * pure, and both are checked by feeding them input rather than by running a
 * model.
 */

/** A job, with only the fields the permission rules actually read. */
const job = (validationCommands?: string[]): WorkerJob =>
  ({
    id: "job_1",
    worker: "claude",
    project: "AgentOS",
    objective: "Do the thing",
    status: "running",
    createdAt: new Date().toISOString(),
    validationCommands,
  }) as WorkerJob;

/** An assistant message, shaped the way the SDK yields one. */
const assistant = (content: unknown[]) => ({
  type: "assistant",
  message: { content },
});

/** The user message the SDK delivers tool results on. */
const toolResults = (content: unknown[]) => ({
  type: "user",
  message: { content },
});

describe("what Claude is permitted to do", () => {
  it("grants a validation command in both bare and argument form", () => {
    const rules = validationRules(["npm run build"]);

    // `*` is a wildcard, not a prefix matcher, so one rule would let exactly
    // one of these two through and deny the other mid-job.
    assert.deepEqual(rules, ["Bash(npm run build)", "Bash(npm run build *)"]);
  });

  it("does not turn a chained command into a permission rule", () => {
    // A rule is a prefix. Granting one for `npm test; curl evil.sh` would
    // grant everything that could follow the prefix, not just this command.
    for (const command of [
      "npm test; curl example.com",
      "npm test && rm -rf /",
      "echo $(whoami)",
      "npm test | sh",
      "cat foo > bar",
    ]) {
      assert.deepEqual(
        validationRules([command]),
        [],
        `${command} should not become a rule`,
      );
    }
  });

  it("works for repositories that are not npm", () => {
    assert.deepEqual(validationRules(["./gradlew test"]), [
      "Bash(./gradlew test)",
      "Bash(./gradlew test *)",
    ]);
  });

  it("gives a job with no validation commands only the base tools", () => {
    const tools = allowedTools(job());

    assert.ok(tools.includes("Read"));
    assert.ok(tools.includes("Edit"));
    assert.ok(tools.includes("Write"));
    // Reading history is allowed; nothing that writes it is.
    assert.ok(tools.includes("Bash(git diff)"));
    assert.ok(!tools.some((tool) => tool.includes("git commit")));
    assert.ok(!tools.some((tool) => tool.includes("git push")));
  });

  it("adds the job's own validation commands to the base tools", () => {
    const tools = allowedTools(job(["npm run lint"]));

    assert.ok(tools.includes("Read"));
    assert.ok(tools.includes("Bash(npm run lint)"));
    assert.ok(tools.includes("Bash(npm run lint *)"));
  });

  it("refuses publishing, history, and worktrees outright", () => {
    const denied = deniedTools().join(" ");

    for (const forbidden of [
      "git push",
      "git commit",
      "git worktree",
      "git remote",
      "sudo",
      "rm",
    ]) {
      assert.ok(denied.includes(forbidden), `${forbidden} should be denied`);
    }

    // Credentials are not part of any job's context.
    assert.ok(denied.includes(".env"));
  });

  it("keeps the worker's configuration out of the operator's own", () => {
    // The whole point of the isolated directory: a worker that read
    // `~/.claude` would inherit a personal setup the job never asked for.
    assert.ok(!/\.claude$/.test(workerConfigDir()));
    assert.ok(workerConfigDir().includes(".agentos-worker"));
  });
});

describe("what the run does not inherit", () => {
  /**
   * The property this whole integration rests on.
   *
   * Each of these is loaded by default. A worker that picked them up would be
   * running with the operator's memory, skills, and MCP servers — none of
   * which are part of the job it was given, and none of which anyone reviewing
   * the diff would know had been involved.
   */
  const options = () =>
    buildQueryOptions(job(), "/tmp/worktree", new AbortController());

  it("loads no settings file, from any source", () => {
    assert.deepEqual(options().settingSources, []);
  });

  it("loads none of the machine's skills", () => {
    assert.deepEqual(options().skills, []);
  });

  it("reaches no MCP server", () => {
    assert.deepEqual(options().mcpServers, {});
    // Without this, a configured server could still be discovered.
    assert.equal(options().strictMcpConfig, true);
  });

  it("points Claude at its own configuration directory", () => {
    const env = options().env ?? {};

    assert.equal(env.CLAUDE_CONFIG_DIR, workerConfigDir());
    // `settingSources: []` does not cover memory files; this does.
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, "agentos");
  });

  it("keeps the inherited environment the run needs to start at all", () => {
    // `env` replaces the child's environment rather than extending it, so
    // dropping PATH here would fail every run for a reason that looks
    // nothing like the cause.
    assert.equal(options().env?.PATH, process.env.PATH);
  });

  it("runs in the worktree it was given", () => {
    assert.equal(options().cwd, "/tmp/worktree");
  });

  it("asks nothing of an operator who is not there", () => {
    assert.equal(options().permissionMode, "dontAsk");
  });

  it("bounds the run by both turns and dollars", () => {
    assert.ok((options().maxTurns ?? 0) > 0);
    assert.ok((options().maxBudgetUsd ?? 0) > 0);
  });

  it("keeps Claude Code's coding prompt and adds the worker's rules to it", () => {
    const prompt = options().systemPrompt;

    assert.equal(typeof prompt, "object");
    assert.equal((prompt as { preset?: string }).preset, "claude_code");
    assert.match(
      (prompt as { append?: string }).append ?? "",
      /AgentOS owns validation/,
    );
  });
});

describe("reading Claude's stream", () => {
  it("keeps what Claude said and drops what it was thinking", () => {
    const stream = new ClaudeStream();

    const emitted = stream.handleMessage(
      assistant([
        { type: "thinking", thinking: "Let me look at the repository..." },
        { type: "text", text: "Adding the filter row." },
      ]),
    );

    // Reasoning is long, is not a record of what happened, and is not the
    // operator's business. The answer is both narrated and kept.
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, "job.progress");
    assert.equal(emitted[0].message, "Adding the filter row.");
  });

  it("pairs a tool call with the result that closes it", () => {
    const stream = new ClaudeStream();

    const started = stream.handleMessage(
      assistant([
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "npm run build" },
        },
      ]),
    );

    assert.equal(started[0].type, "tool.started");
    // A bare tool name says nothing; the command is what a person reads.
    assert.equal(started[0].message, "Bash: npm run build");

    const finished = stream.handleMessage(
      toolResults([{ type: "tool_result", tool_use_id: "toolu_1" }]),
    );

    assert.equal(finished[0].type, "tool.completed");
    assert.equal(finished[0].message, "Bash: npm run build");
    assert.deepEqual(stream.unfinishedTools, []);
  });

  it("narrates a written file without claiming it as the record", () => {
    const stream = new ClaudeStream();

    stream.handleMessage(
      assistant([
        {
          type: "tool_use",
          id: "toolu_2",
          name: "Write",
          input: { file_path: "src/filters.ts", content: "..." },
        },
      ]),
    );

    const emitted = stream.handleMessage(
      toolResults([{ type: "tool_result", tool_use_id: "toolu_2" }]),
    );

    const changed = emitted.find((event) => event.type === "file.changed");

    assert.equal(changed?.message, "src/filters.ts");
    // Narration only — the job's changed files are read from git.
    assert.equal(changed?.metadata?.reportedBy, "claude");
  });

  it("does not report a file changed when the write failed", () => {
    const stream = new ClaudeStream();

    stream.handleMessage(
      assistant([
        {
          type: "tool_use",
          id: "toolu_3",
          name: "Write",
          input: { file_path: "src/nope.ts" },
        },
      ]),
    );

    const emitted = stream.handleMessage(
      toolResults([
        { type: "tool_result", tool_use_id: "toolu_3", is_error: true },
      ]),
    );

    assert.ok(!emitted.some((event) => event.type === "file.changed"));
    assert.match(String(emitted[0].message), /failed/);
  });

  it("records a refused tool rather than hiding it", () => {
    const stream = new ClaudeStream();

    const emitted = stream.handleMessage({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      decision_reason: "git push is denied",
      decision_reason_type: "rule",
      message: "Denied",
    });

    assert.equal(emitted[0].type, "job.progress");
    // The refusal is the mechanism working, and it is kept as a blocker: a job
    // that quietly did less than it was asked is worth knowing about.
    assert.match(stream.blockers.join(" "), /git push is denied/);
  });

  it("prefers the SDK's closing result to reassembled text", () => {
    const stream = new ClaudeStream();

    stream.handleMessage(assistant([{ type: "text", text: "Working on it." }]));

    stream.handleMessage({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Added the filter row and updated the tests.",
      num_turns: 12,
      total_cost_usd: 0.84,
      session_id: "sess_abc",
    });

    assert.equal(stream.summary, "Added the filter row and updated the tests.");
    assert.deepEqual(stream.metrics, {
      costUsd: 0.84,
      turns: 12,
      sessionId: "sess_abc",
    });
    assert.deepEqual(stream.blockers, []);
  });

  it("treats a spent budget as a blocker, not as a broken run", () => {
    const stream = new ClaudeStream();

    const emitted = stream.handleMessage({
      type: "result",
      subtype: "error_max_budget_usd",
      is_error: true,
      num_turns: 30,
      total_cost_usd: 3.01,
      errors: [],
      session_id: "sess_def",
    });

    // The work it did do is real; validation is what decides whether it
    // stands. So this is progress with a blocker, never a thrown failure.
    assert.equal(emitted[0].type, "job.progress");
    assert.match(stream.blockers.join(" "), /cost ceiling/);
    assert.equal(stream.metrics.costUsd, 3.01);
  });

  it("reports a turn limit in words an operator can act on", () => {
    const stream = new ClaudeStream();

    stream.handleMessage({
      type: "result",
      subtype: "error_max_turns",
      num_turns: 30,
      total_cost_usd: 1.2,
      errors: [],
      session_id: "sess_ghi",
    });

    assert.match(stream.blockers.join(" "), /turn limit/);
  });

  it("says so when a tool never reported finishing", () => {
    const stream = new ClaudeStream();

    stream.handleMessage(
      assistant([
        {
          type: "tool_use",
          id: "toolu_4",
          name: "Bash",
          input: { command: "npm test" },
        },
      ]),
    );

    assert.deepEqual(stream.unfinishedTools, ["Bash: npm test"]);
  });

  it("carries on past a message it does not recognise", () => {
    const stream = new ClaudeStream();

    // The SDK's message union is long and grows. An unmapped shape thins the
    // log; it must never fail a job.
    for (const message of [
      { type: "stream_event", event: {} },
      { type: "system", subtype: "task_notification" },
      { type: "some_future_message" },
      null,
      "not an object",
    ]) {
      assert.deepEqual(stream.handleMessage(message), []);
    }

    stream.handleMessage(assistant([{ type: "text", text: "Still here." }]));
    assert.equal(stream.summary, "Still here.");
  });
});

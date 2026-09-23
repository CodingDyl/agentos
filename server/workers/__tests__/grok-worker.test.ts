import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrokStream } from "../providers/grok-events";
import { buildGrokArgs, buildGrokPrompt } from "../providers/grok-worker";

/**
 * The Grok adapter, tested where it can be tested without spending tokens.
 *
 * Two things carry the risk in a provider adapter: the arguments it starts the
 * process with, and how it reads what comes back. Both are pure, and both are
 * checked here by feeding them input rather than by running a model.
 */

/** Fixture lines in the shape Grok actually emits. */
const line = (event: unknown): string => JSON.stringify(event);

describe("reading Grok's stream", () => {
  it("does not turn streamed tokens into events", () => {
    const stream = new GrokStream();
    const emitted = [];

    for (const word of ["Look", "ing", " at", " the", " code"]) {
      emitted.push(...stream.handleLine(line({ type: "thought", data: word })));
    }

    for (const word of ["Added", " the", " grid"]) {
      emitted.push(...stream.handleLine(line({ type: "text", data: word })));
    }

    // Reasoning and answer text arrive one token per line. An event per token
    // would bury everything that actually says what happened.
    assert.deepEqual(emitted, []);

    // The answer is still kept — it is the summary a person reads first.
    assert.equal(stream.summary, "Added the grid");
  });

  it("keeps one answer from running into the next", () => {
    const stream = new GrokStream();

    stream.handleLine(line({ type: "text", data: "I will create the file." }));
    // A response boundary. Grok gives no other signal that one answer ended.
    stream.handleLine(line({ type: "usage", stopReason: "tool_use" }));
    stream.handleLine(line({ type: "text", data: "Created the file." }));

    assert.equal(stream.summary, "I will create the file.\n\nCreated the file.");
  });

  it("pairs a tool call with the update that closes it", () => {
    const stream = new GrokStream();

    const started = stream.handleLine(
      line({
        type: "tool_call",
        toolCallId: "call_1",
        title: "Read src/main.ts",
        toolName: "read_file",
        kind: "read",
        status: "in_progress",
      }),
    );

    assert.equal(started.length, 1);
    assert.equal(started[0].type, "tool.started");
    assert.equal(started[0].message, "Read src/main.ts");

    // An in-progress update is not a boundary; a long call reports many.
    assert.deepEqual(
      stream.handleLine(
        line({ type: "tool_call_update", toolCallId: "call_1", status: "in_progress" }),
      ),
      [],
    );

    const finished = stream.handleLine(
      line({ type: "tool_call_update", toolCallId: "call_1", status: "completed" }),
    );

    // The update carries no title of its own; the one it opened with is what
    // makes the closing line readable.
    assert.equal(finished[0].type, "tool.completed");
    assert.equal(finished[0].message, "Read src/main.ts");
    assert.deepEqual(stream.unfinishedTools, []);
  });

  it("names the files a finished tool call touched", () => {
    const stream = new GrokStream();

    stream.handleLine(
      line({
        type: "tool_call",
        toolCallId: "call_2",
        title: "Edit",
        kind: "edit",
        status: "in_progress",
      }),
    );

    const emitted = stream.handleLine(
      line({
        type: "tool_call_update",
        toolCallId: "call_2",
        status: "completed",
        kind: "edit",
        locations: [{ path: "src/grid.tsx" }, { path: "src/grid.css" }],
      }),
    );

    assert.deepEqual(
      emitted.filter((event) => event.type === "file.changed").map((e) => e.message),
      ["src/grid.tsx", "src/grid.css"],
    );
  });

  it("reports a tool call that failed as a failure, not a completion", () => {
    const stream = new GrokStream();

    stream.handleLine(
      line({ type: "tool_call", toolCallId: "c", title: "Run tests", status: "in_progress" }),
    );

    const emitted = stream.handleLine(
      line({ type: "tool_call_update", toolCallId: "c", status: "failed" }),
    );

    assert.match(emitted[0].message ?? "", /failed/);
  });

  it("keeps an unrecognised event instead of dropping or throwing on it", () => {
    const stream = new GrokStream();

    // Grok says its event list is not exhaustive, so this has to be survivable.
    const emitted = stream.handleLine(
      line({ type: "auto_compact_started", detail: "context full" }),
    );

    assert.equal(emitted[0].type, "job.progress");
    assert.match(emitted[0].message ?? "", /auto_compact_started/);
    assert.equal(emitted[0].metadata?.provider, "grok");
  });

  it("survives a line that is not JSON at all", () => {
    const stream = new GrokStream();
    const emitted = stream.handleLine("warning: something went sideways");

    assert.equal(emitted[0].type, "job.progress");
    assert.match(String(emitted[0].metadata?.raw), /sideways/);
  });

  it("records what Grok said went wrong", () => {
    const stream = new GrokStream();

    stream.handleLine(line({ type: "error", message: "rate limited" }));
    stream.handleLine(line({ type: "max_turns_reached" }));

    assert.deepEqual(stream.blockers, [
      "rate limited",
      "Grok stopped at its turn limit before finishing.",
    ]);
  });

  it("reads why the turn ended", () => {
    const stream = new GrokStream();

    stream.handleLine(
      line({ type: "end", stopReason: "max_turns", usage: { output_tokens: 12 } }),
    );

    assert.equal(stream.stopReason, "max_turns");
    assert.deepEqual(stream.usage, { output_tokens: 12 });
  });

  it("counts turns and tokens, and never a cost", () => {
    const stream = new GrokStream();

    stream.handleLine(line({ type: "usage", stopReason: "tool_use" }));
    stream.handleLine(line({ type: "usage", stopReason: "end_turn" }));
    stream.handleLine(
      line({
        type: "end",
        stopReason: "end_turn",
        usage: { input_tokens: 4_210, output_tokens: 812 },
      }),
    );

    assert.deepEqual(stream.metrics, {
      provider: "xai",
      turns: 2,
      inputTokens: 4_210,
      outputTokens: 812,
      totalTokens: 5_022,
      measurement: "exact",
    });
    // Grok reports tokens and does not price them, so cost stays absent
    // rather than becoming an estimate that reads like a measurement.
    assert.equal("costUsd" in stream.metrics, false);
  });

  it("keeps token counts a later payload does not mention", () => {
    const stream = new GrokStream();

    stream.handleLine(
      line({ type: "usage", usage: { input_tokens: 900, output_tokens: 100 } }),
    );
    stream.handleLine(
      line({ type: "end", stopReason: "end_turn", usage: { output_tokens: 250 } }),
    );

    assert.equal(stream.metrics.inputTokens, 900);
    assert.equal(stream.metrics.outputTokens, 250);
  });

  it("stops recording rather than letting one run fill the log", () => {
    const stream = new GrokStream();
    let emitted = 0;

    for (let index = 0; index < 5_000; index += 1) {
      emitted += stream.handleLine(
        line({ type: "tool_call", toolCallId: `c${index}`, title: "Read" }),
      ).length;
    }

    // Far fewer than were fed in, and it said so rather than thinning silently.
    assert.ok(emitted < 600, `expected the log to be capped, got ${emitted}`);
  });

  it("says which tool calls never reported finishing", () => {
    const stream = new GrokStream();

    stream.handleLine(
      line({ type: "tool_call", toolCallId: "open", title: "Long build" }),
    );

    assert.deepEqual(stream.unfinishedTools, ["Long build"]);
  });
});

describe("how Grok is started", () => {
  const args = buildGrokArgs({
    cwd: "/tmp/worktree",
    prompt: "do the thing",
    allowWeb: false,
    sandbox: "workspace",
    turns: "40",
  });

  /** The value that follows a flag, for asserting on pairs. */
  const valueAfter = (flag: string): string | undefined =>
    args[args.indexOf(flag) + 1];

  it("runs in the worktree AgentOS created", () => {
    assert.equal(valueAfter("--cwd"), "/tmp/worktree");
  });

  it("never asks Grok to make a worktree of its own", () => {
    // The job manager already made one. A second, nested inside it, would put
    // the work somewhere nobody is reviewing.
    assert.ok(!args.includes("--worktree"));
    assert.ok(!args.includes("-w"));
    assert.ok(!args.includes("--worktree-ref"));
  });

  it("asks for the stream AgentOS knows how to read", () => {
    assert.equal(valueAfter("--output-format"), "streaming-json");
  });

  it("bounds the run", () => {
    assert.equal(valueAfter("--max-turns"), "40");
    assert.ok(args.includes("--no-auto-update"));
    assert.equal(valueAfter("--sandbox"), "workspace");
  });

  it("blocks the things a prompt cannot be trusted to prevent", () => {
    const denied = args
      .map((argument, index) => (args[index - 1] === "--deny" ? argument : ""))
      .filter(Boolean);

    // Deny rules outrank the auto-approval that unattended running needs.
    assert.ok(args.includes("--always-approve"));

    for (const rule of ["Bash(git push)", "Bash(git commit)", "Bash(rm -rf)"]) {
      assert.ok(denied.includes(rule), `expected ${rule} to be denied`);
    }

    // Prefixes, not globs: `Bash(git push *)` would require an argument and
    // let a bare `git push` through.
    assert.ok(!denied.some((rule) => rule.includes("* ")));
    assert.ok(!denied.includes("Bash(git push *)"));
  });

  it("keeps the job's own text out of Grok's command layer", () => {
    // Without this, an objective beginning with `/` reads as a slash command.
    assert.ok(args.includes("--verbatim"));
  });

  it("leaves the network off unless it was asked for", () => {
    assert.equal(valueAfter("--disallowed-tools"), "web_search,web_fetch");

    const withWeb = buildGrokArgs({
      cwd: "/tmp/worktree",
      prompt: "do the thing",
      allowWeb: true,
      sandbox: "workspace",
      turns: "40",
    });

    assert.ok(!withWeb.includes("--disallowed-tools"));
  });

  it("omits the sandbox flag rather than inventing a profile", () => {
    const unsandboxed = buildGrokArgs({
      cwd: "/tmp/worktree",
      prompt: "do the thing",
      allowWeb: false,
      sandbox: undefined,
      turns: "40",
    });

    assert.ok(!unsandboxed.includes("--sandbox"));
  });

  it("passes the prompt last, so no part of it is read as a flag", () => {
    assert.equal(args.at(-2), "-p");
    assert.equal(args.at(-1), "do the thing");
  });
});

describe("what Grok is told", () => {
  const prompt = buildGrokPrompt("JOB\n\nObjective:\nBuild the grid");

  it("carries the job packet unchanged", () => {
    assert.ok(prompt.includes("Objective:\nBuild the grid"));
  });

  it("tells it the verification is not its own to do", () => {
    assert.match(prompt, /AgentOS reads the changed files from git/);
    assert.match(prompt, /Reporting success does not make a job pass/);
  });
});

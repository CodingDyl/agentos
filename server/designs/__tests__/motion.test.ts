import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MotionJobRequestSchema, type MotionJobRequest } from "../../../shared/motion-types";
import { applyEvent, claudeArgs, describeTool, MOTION_DENIED_TOOLS, revisionPrompt } from "../motion";
import {
  BUILT_IN_BRAND,
  BUILT_IN_SHOWREEL,
  buildStudioPrompt,
  extractBrandTemplate,
  extractShowreelLine,
  fillTemplate,
  noteBody,
} from "../motion-prompts";
import { buildRenderArgs, extractVideoUrls } from "../renderer";

const request = (overrides: Partial<MotionJobRequest> = {}): MotionJobRequest =>
  MotionJobRequestSchema.parse({ template: "showreel", product: "Pantry Pilot", ...overrides });

describe("reading the motion prompts out of the vault notes", () => {
  it("drops front matter and the Related links", () => {
    const body = noteBody("---\ntags: [video]\n---\n# Rules\n\nDo this.\n\n## Related\n\n- [[other]]\n");
    assert.equal(body, "# Rules\n\nDo this.");
  });

  it("finds the one-liner inside a note that also explains it", () => {
    const note = 'One-liner - why it works\n\npython\nmake a dynamic 15-second motion graphics video that shows what an \nincredible motion designer you are. \ngo all out.\n"showreel" sets a genre';
    assert.equal(
      extractShowreelLine(note),
      "make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are. go all out.",
    );
  });

  it("takes the brand template from under its heading", () => {
    const note = "Motion Studio Rules:\n...\n---\n\nDynamic Prompt for use with any brand:\n\nMake a dynamic 20-second video for [PRODUCT].";
    assert.equal(extractBrandTemplate(note), "Make a dynamic 20-second video for [PRODUCT].");
    assert.equal(extractBrandTemplate("no marker here"), undefined);
  });
});

describe("filling a template from the brief", () => {
  it("puts the product and length into the showreel one-liner", () => {
    const filled = fillTemplate("showreel", BUILT_IN_SHOWREEL, request({ durationSec: 20 }));
    assert.match(filled, /^make a dynamic 20-second motion graphics video about Pantry Pilot that shows/);
  });

  it("fills every brand placeholder, and says so when there is no metric", () => {
    const filled = fillTemplate("brand", BUILT_IN_BRAND, request({ template: "brand", url: "https://pantrypilot.app", cta: "Join the beta", formats: ["9:16", "1:1"] }));
    assert.doesNotMatch(filled, /\[(PRODUCT|URL|METRIC|CTA)\]/);
    assert.match(filled, /for Pantry Pilot \(https:\/\/pantrypilot\.app\)/);
    assert.match(filled, /never invent a number/);
    assert.match(filled, /Format: 1080x1920 \(9:16\), then 1080x1080 \(1:1\) from the same timeline\./);
  });

  it("uses the operator's own words for a custom brief", () => {
    assert.equal(fillTemplate("custom", "", request({ template: "custom", brief: "A 10s loop of our logo." })), "A 10s loop of our logo.");
  });

  it("refuses a brief with no subject, and a custom film with no brief", () => {
    assert.equal(MotionJobRequestSchema.safeParse({ template: "brand" }).success, false);
    assert.equal(MotionJobRequestSchema.safeParse({ template: "custom" }).success, false);
  });
});

describe("the studio prompt", () => {
  it("keeps the rules whole and tells Claude where AgentOS reads its loop", () => {
    const prompt = buildStudioPrompt({
      request: request({ formats: ["9:16", "16:9"] }),
      rules: "# Motion studio rules\n\n- Rule one.",
      brief: "make a dynamic film",
      brandFiles: ["01-logo.svg"],
      hasWorkspaceContext: false,
    });
    assert.match(prompt, /# Motion studio rules\n\n- Rule one\./);
    assert.match(prompt, /sheet\/round-N\.png/);
    assert.match(prompt, /scores\.json/);
    assert.match(prompt, /out\/final\.mp4 for 9:16, then out\/final-16x9\.mp4/);
    assert.match(prompt, /01-logo\.svg/);
    assert.doesNotMatch(prompt, /BRIEF\.md includes the workspace/);
  });
});

describe("running Claude Code", () => {
  const job = { prompt: "THE BRIEF", sessionId: undefined, attempts: 0, request: request({ effort: "max" }), model: "opus", pendingNote: undefined };

  it("starts fresh with the brief, on the plan's settings only", () => {
    const args = claudeArgs(job);
    assert.equal(args[args.indexOf("-p") + 1], "THE BRIEF");
    assert.equal(args[args.indexOf("--effort") + 1], "max");
    assert.equal(args[args.indexOf("--setting-sources") + 1], "project");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(!args.includes("--resume"));
    // The brief is one argument, however it is written: it can never become a flag or a command.
    assert.equal(args.filter((arg) => arg === "THE BRIEF").length, 1);
  });

  it("resumes the same session rather than starting over", () => {
    const args = claudeArgs({ ...job, attempts: 1, sessionId: "abc-123" });
    assert.deepEqual(args.slice(0, 2), ["--resume", "abc-123"]);
    assert.notEqual(args[args.indexOf("-p") + 1], "THE BRIEF");
  });

  it("sends the operator's changes as a revision", () => {
    const args = claudeArgs({ ...job, attempts: 1, sessionId: "abc-123", pendingNote: "Make the hook faster." });
    assert.equal(args[args.indexOf("-p") + 1], revisionPrompt("Make the hook faster."));
  });

  it("refuses destructive commands and credentials whatever the brief says", () => {
    const denied = claudeArgs(job).slice(claudeArgs(job).indexOf("--disallowedTools") + 1);
    for (const rule of ["Bash(rm -rf:*)", "Bash(sudo:*)", "Read(**/.env)"]) assert.ok(denied.includes(rule));
    assert.deepEqual(denied, MOTION_DENIED_TOOLS);
  });
});

describe("reading Claude Code's stream", () => {
  const blank = () => ({ log: [] as { at: string; kind: "system" | "text" | "tool"; message: string }[], sessionId: undefined as string | undefined, model: undefined as string | undefined, summary: undefined as string | undefined, usage: undefined, resultError: undefined as string | undefined });

  it("records the session, what Claude says and does, and how it ended", () => {
    const job = blank();
    applyEvent(job, JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "claude-opus-5-5" }));
    applyEvent(job, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Round 1 scores:  hook 7" }, { type: "tool_use", name: "Bash", input: { command: "node render.mjs --sheet --round 1" } }] } }));
    applyEvent(job, "not json at all");
    applyEvent(job, JSON.stringify({ type: "result", subtype: "success", result: "Done. Hook 9.", num_turns: 42, usage: { input_tokens: 10, output_tokens: 5 } }));

    assert.equal(job.sessionId, "s1");
    assert.equal(job.model, "claude-opus-5-5");
    assert.deepEqual(job.log.map((entry) => entry.message), ["Round 1 scores: hook 7", "Bash · node render.mjs --sheet --round 1"]);
    assert.equal(job.summary, "Done. Hook 9.");
    assert.equal(job.resultError, undefined);
  });

  it("notices a run that stopped at an error", () => {
    const job = blank();
    applyEvent(job, JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
    assert.match(job.resultError ?? "", /error_max_turns/);
  });

  it("names files, not paths", () => {
    assert.equal(describeTool("Write", { file_path: "/Users/x/AgentOS-Media/motion/mot_1/film.js" }), "Write · film.js");
  });
});

describe("Higgsfield video results", () => {
  it("keeps the rendered video and not its poster", () => {
    const output = '{"result":{"video":"https://cdn.test/job/out.mp4?sig=1","thumbnail":"https://cdn.test/job/poster.jpg"}}';
    assert.deepEqual(extractVideoUrls(output), ["https://cdn.test/job/out.mp4?sig=1"]);
  });

  it("waits longer for a video model", () => {
    const args = buildRenderArgs({ prompt: "a pan", kind: "video", model: "seedance_2_0" });
    assert.equal(args[args.indexOf("--wait-timeout") + 1], "20m");
  });
});

describe("telling videos from images", () => {
  it("recognises a bare extension as well as a stored name", async () => {
    const { isVideoName, thumbnailNameFor } = await import("../media");
    assert.equal(isVideoName(".mp4"), true);
    assert.equal(isVideoName("abc.MOV"), true);
    assert.equal(isVideoName(".png"), false);
    assert.equal(thumbnailNameFor("abc.webm"), "abc.jpg");
    assert.equal(thumbnailNameFor("abc.png"), "abc.png");
  });
});

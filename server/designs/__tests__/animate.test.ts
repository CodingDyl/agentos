import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { AnimateDecisionSchema, AnimateRequestSchema } from "../../../shared/animate-types";
import { animateClaudeArgs, checkpointImagePath, isAnimateId } from "../animate";
import type { syncWorkerJob as SyncWorkerJob } from "../animate";
import type { applyEvent as ApplyEvent } from "../motion";

/** The slice of a stored motion job that `applyEvent` reads and writes. */
type MotionRecord = Parameters<typeof ApplyEvent>[0];

/** An animate job. Fixtures below are partial on purpose: only what the sync reads. */
type AnimateRecord = Parameters<typeof SyncWorkerJob>[0];

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-animate-test-"));
process.env.AGENTOS_UI_DIR = testRoot;

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

const base = { prompt: "FIRST", model: "opus", attempts: 0, stage: "story" as const };

describe("Claude Motion intake", () => {
  it("needs a topic and defaults the length and format", () => {
    assert.equal(AnimateRequestSchema.safeParse({ topic: "  " }).success, false);
    const parsed = AnimateRequestSchema.parse({ topic: "How a bill becomes law" });
    assert.equal(parsed.durationSec, 20);
    assert.deepEqual(parsed.formats, ["9:16"]);
  });

  it("asks what to change when changes are requested without a note", () => {
    assert.equal(AnimateDecisionSchema.safeParse({ decision: "changes" }).success, false);
    assert.equal(AnimateDecisionSchema.safeParse({ decision: "approve" }).success, true);
  });
});

describe("running a stage", () => {
  it("starts with the full prompt, then resumes the session with only what the operator decided", () => {
    const first = animateClaudeArgs(base);
    assert.equal(first.includes("--resume"), false);
    assert.equal(first[first.indexOf("-p") + 1], "FIRST");

    const next = animateClaudeArgs({ ...base, attempts: 1, sessionId: "s1", pendingPrompt: "The operator approved the story." });
    assert.equal(next[next.indexOf("--resume") + 1], "s1");
    assert.equal(next[next.indexOf("-p") + 1], "The operator approved the story.");
  });

  it("builds at max effort and checks gates at high", () => {
    const effort = (stage: "story" | "build") => {
      const args = animateClaudeArgs({ ...base, stage });
      return args[args.indexOf("--effort") + 1];
    };
    assert.equal(effort("story"), "high");
    assert.equal(effort("build"), "max");
  });

  it("allows web search for fact checks but never pushing code", () => {
    const args = animateClaudeArgs(base);
    assert.ok(args.slice(args.indexOf("--allowedTools"), args.indexOf("--disallowedTools")).includes("WebSearch"));
    assert.ok(args.includes("Bash(git push:*)"));
  });
});

describe("exit status mapping", () => {
  it("never marks a job completed when resultError exists, even if videos were filed", async () => {
    const { applyEvent } = await import("../motion");
    
    const job: MotionRecord = {
      log: [],
      sessionId: undefined,
      model: undefined,
      summary: undefined,
      usage: undefined,
      resultError: undefined,
      lastToolError: "Tool execution failed",
    };
    
    // Simulate a result event with is_error but subtype "success" (the bug case)
    applyEvent(job, JSON.stringify({
      type: "result",
      is_error: true,
      subtype: "success",
      result: "Done"
    }));
    
    // Should have resultError set (never success when is_error is true)
    assert.ok(job.resultError, "resultError should be set when is_error is true");
    assert.ok(!job.resultError.includes("success"), "Error message should never contain 'success' when is_error is true");
    assert.ok(job.resultError.includes("Tool error"), "Should extract tool error from lastToolError");
  });
  
  it("provides concrete error messages based on tool errors, not generic success", async () => {
    const { applyEvent } = await import("../motion");
    
    // Test tool error extraction
    const job1: MotionRecord = { log: [], resultError: undefined, lastToolError: "ffmpeg exited with code 1" };
    applyEvent(job1, JSON.stringify({ type: "result", is_error: true, subtype: "tool_error" }));
    assert.match(job1.resultError ?? "", /ffmpeg exited with code 1/, "Should extract specific tool error from lastToolError");
    assert.ok(!job1.resultError?.includes("success"), "Tool error should not mention success");
    
    // Test subtype when not "success"
    const job2: MotionRecord = { log: [], resultError: undefined, lastToolError: undefined };
    applyEvent(job2, JSON.stringify({ type: "result", is_error: true, subtype: "timeout" }));
    assert.match(job2.resultError ?? "", /did not finish within the time limit/, "Should use timeout message");
    
    // Test is_error with subtype "success" - should never say success
    const job3: MotionRecord = { log: [], resultError: undefined, lastToolError: undefined };
    applyEvent(job3, JSON.stringify({ type: "result", is_error: true, subtype: "success" }));
    assert.ok(job3.resultError, "Should set error even when subtype is success");
    assert.ok(!job3.resultError.includes("success"), "Should not use word success when is_error is true");
  });
  
  it("tracks tool errors from tool_result events in the stream", async () => {
    const { applyEvent } = await import("../motion");
    
    const job: MotionRecord = { log: [], resultError: undefined, lastToolError: undefined };
    
    // Simulate a top-level tool_result with is_error
    applyEvent(job, JSON.stringify({
      type: "tool_result",
      is_error: true,
      content: "Command failed: node tools/export.mjs --format mp4\nError: Missing required frames"
    }));
    
    // Job should now have the error
    assert.ok(job.lastToolError, "Should extract tool error to job.lastToolError");
    assert.match(job.lastToolError ?? "", /Command failed/, "Should capture tool error content");
    
    // Then when result comes with is_error, it should use this error
    applyEvent(job, JSON.stringify({ type: "result", is_error: true, subtype: "success" }));
    assert.match(job.resultError ?? "", /Command failed/, "Should use captured tool error in result");
  });
  
  it("tracks tool errors from nested user/tool_result events", async () => {
    const { applyEvent } = await import("../motion");
    
    const job: MotionRecord = { log: [], resultError: undefined, lastToolError: undefined };
    
    // Simulate nested tool_result in user message (Claude Code stream-json format)
    applyEvent(job, JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            is_error: true,
            content: "ffmpeg: error while loading shared libraries"
          }
        ]
      }
    }));
    
    // Job should now have the error
    assert.ok(job.lastToolError, "Should extract nested tool error to job.lastToolError");
    assert.match(job.lastToolError ?? "", /ffmpeg: error/, "Should capture nested tool error content");
    
    // Then when result comes with is_error, it should use this error
    applyEvent(job, JSON.stringify({ type: "result", is_error: true, subtype: "success" }));
    assert.match(job.resultError ?? "", /ffmpeg: error/, "Should use captured nested tool error in result");
  });
});

describe("worker job integration", () => {
  it("creates a worker job using stable ID (workerJobId or job.id, never changes)", async () => {
    const { syncWorkerJob } = await import("../animate");
    const { readJob: readWorkerJob } = await import("../../workers/job-store");
    
    const job = {
      id: "anm_0123456789abcdef",
      title: "Test video",
      status: "running",
      stage: "story",
      request: { project: "test-project" },
      createdAt: "2026-10-07T19:00:00Z",
      startedAt: "2026-10-07T19:01:00Z",
      log: [],
      assetIds: [],
    } as unknown as AnimateRecord;
    
    // First sync - should create a new workerJobId
    await syncWorkerJob(job);
    assert.ok(job.workerJobId, "Should set workerJobId");
    assert.ok(job.workerJobId.startsWith("job_"), "Worker job ID should start with job_");
    const stableId = job.workerJobId;
    
    const workerJob1 = await readWorkerJob(stableId);
    assert.ok(workerJob1, "Should create worker job");
    assert.equal(workerJob1.worker, "claude-code", "Should use claude-code as worker");
    assert.equal(workerJob1.status, "running", "Should map status to running");
    
    // Later sync with session ID - should keep same stable ID, not create duplicate
    job.sessionId = "s_different_id_456";
    await syncWorkerJob(job);
    assert.equal(job.workerJobId, stableId, "Should keep same workerJobId");
    
    const workerJob2 = await readWorkerJob(stableId);
    assert.ok(workerJob2, "Should update existing worker job");
    
    // Verify no duplicate job was created with session ID
    const duplicateJob = await readWorkerJob("s_different_id_456");
    assert.ok(!duplicateJob, "Should not create duplicate job with session ID");
  });
  
  it("records failure events only once when transitioning to failed status", async () => {
    const { syncWorkerJob } = await import("../animate");
    const { readEvents } = await import("../../workers/job-store");
    
    const job = {
      id: "anm_1111222233334444",
      title: "Test failure",
      status: "running",
      stage: "build",
      request: { project: "test-project" },
      createdAt: "2026-10-07T19:00:00Z",
      startedAt: "2026-10-07T19:01:00Z",
      log: [
        { at: "2026-10-07T19:02:00Z", kind: "tool", message: "Bash · node render.mjs" },
        { at: "2026-10-07T19:03:00Z", kind: "text", message: "Rendering frames..." },
      ],
      assetIds: [],
    } as unknown as AnimateRecord;
    
    // First sync - running status
    await syncWorkerJob(job);
    const workerJobId = job.workerJobId;
    assert.ok(workerJobId, "Should have workerJobId after first sync");
    
    const initialEvents = await readEvents(workerJobId);
    const initialEventCount = initialEvents.length;
    
    // Transition to failed
    job.status = "failed";
    job.error = "Tool error: ffmpeg exited with code 1";
    job.completedAt = "2026-10-07T19:05:00Z";
    await syncWorkerJob(job);
    
    const events = await readEvents(workerJobId);
    assert.ok(events.length > initialEventCount, "Should record new events on failure");
    
    const failedEvent = events.find(e => e.type === "job.failed");
    assert.ok(failedEvent, "Should record job.failed event");
    assert.match(failedEvent?.message ?? "", /ffmpeg exited with code 1/, "Should include error message");
    
    // Sync again while still failed - should not duplicate events
    await syncWorkerJob(job);
    const eventsAfterSecondSync = await readEvents(workerJobId);
    assert.equal(eventsAfterSecondSync.length, events.length, "Should not duplicate failure events");
  });
  
  it("updates lastEventAt on every sync to show current activity", async () => {
    const { syncWorkerJob } = await import("../animate");
    const { readJob: readWorkerJob } = await import("../../workers/job-store");
    
    const job = {
      id: "anm_5555666677778888",
      title: "Test update",
      status: "running",
      stage: "look",
      request: {},
      createdAt: "2026-10-07T19:00:00Z",
      log: [],
      assetIds: [],
    } as unknown as AnimateRecord;
    
    await syncWorkerJob(job);
    const workerJobId = job.workerJobId;
    assert.ok(workerJobId, "Should have workerJobId after first sync");
    
    const workerJob1 = await readWorkerJob(workerJobId);
    assert.ok(workerJob1, "Should have worker job");
    const firstEventAt = workerJob1.lastEventAt;
    
    // Wait a bit and sync again
    await new Promise(resolve => setTimeout(resolve, 10));
    await syncWorkerJob(job);
    const workerJob2 = await readWorkerJob(workerJobId);
    assert.ok(workerJob2, "Should still have worker job");
    const secondEventAt = workerJob2.lastEventAt;
    
    assert.ok(secondEventAt, "Should have lastEventAt");
    assert.notEqual(secondEventAt, firstEventAt, "Should update lastEventAt on every sync");
  });
  
  it("preserves resume functionality with same Claude session", () => {
    // Resume uses the same session ID and continues from where it stopped
    // The animateClaudeArgs function includes --resume with sessionId
    // Worker job tracks the updated progress through syncWorkerJob calls
    
    const base = { prompt: "FIRST", model: "opus", attempts: 1, sessionId: "s1", pendingPrompt: "Continue", stage: "story" as const };
    const args = animateClaudeArgs(base);
    
    assert.equal(args[args.indexOf("--resume") + 1], "s1", "Resume should use same session");
  });
});

describe("serving checkpoint frames", () => {
  const id = "anm_0123456789abcdef";
  it("serves a named frame of a known stage", () => {
    assert.ok(isAnimateId(id));
    assert.match(checkpointImagePath(id, "look", "look-1.png") ?? "", /checkpoints\/look\/look-1\.png$/);
    assert.match(checkpointImagePath(id, "build", "contact.png") ?? "", /checkpoints\/delivery\/contact\.png$/);
  });

  it("refuses paths, other stages and non-images", () => {
    assert.equal(checkpointImagePath(id, "look", "../../../etc/passwd"), undefined);
    assert.equal(checkpointImagePath(id, "look", "notes.md"), undefined);
    assert.equal(checkpointImagePath(id, "../x", "a.png"), undefined);
    assert.equal(checkpointImagePath("anm_x", "look", "a.png"), undefined);
  });
});

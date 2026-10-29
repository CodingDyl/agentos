import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { VideoIdea } from "../../../shared/video-ideas-types";
import { closeLearningDatabase } from "../../learning/db";
import { advanceIdea, retryIdea, type PipelineDeps } from "../pipeline";
import { createIdea, getIdea, updateIdea } from "../store";

after(() => closeLearningDatabase());

function fakes(overrides: Partial<PipelineDeps> = {}) {
  const calls: string[] = [];
  const deps: PipelineDeps = {
    captions: async () => [{ seconds: 1, text: "hello" }],
    storedTranscript: async () => undefined,
    note: async (idea) => {
      calls.push("note");
      return updateIdea(idea.id, { stage: "noted", notePath: "knowledge/videos/x.md" });
    },
    assess: async (idea) => {
      calls.push("assess");
      return updateIdea(idea.id, { stage: "assessing", jobId: "job-a" });
    },
    jobStatus: async () => "completed",
    fileAssessment: async (idea) => {
      calls.push("fileAssessment");
      return updateIdea(idea.id, { stage: "awaiting_decision", verdict: "adopt" });
    },
    plan: async (idea) => {
      calls.push("plan");
      return updateIdea(idea.id, { stage: "planning", jobId: "job-p" });
    },
    filePlan: async (idea) => {
      calls.push("filePlan");
      return updateIdea(idea.id, { stage: "building" });
    },
    build: async (idea) => {
      calls.push("build");
      return idea;
    },
    ...overrides,
  };
  return { deps, calls };
}

async function walk(idea: VideoIdea, deps: PipelineDeps, steps = 6): Promise<VideoIdea> {
  let current = idea;
  for (let step = 0; step < steps; step += 1) current = await advanceIdea(current, deps);
  return current;
}

const make = (sourceId: string, mode: "learn" | "assess") => createIdea({ id: sourceId, externalId: "dQw4w9WgXcQ", title: sourceId }, mode);

describe("the video idea pipeline", () => {
  it("stops at the note when only learning", async () => {
    const { deps, calls } = fakes();
    const done = await walk(make("ls-w1", "learn"), deps);
    assert.equal(done.stage, "noted");
    assert.deepEqual(calls, ["note"]);
  });

  it("goes on to wait for a decision when checking against AgentOS", async () => {
    const { deps, calls } = fakes();
    const done = await walk(make("ls-w2", "assess"), deps);
    assert.equal(done.stage, "awaiting_decision");
    assert.deepEqual(calls, ["note", "assess", "fileAssessment"]);
  });

  it("asks for a transcript when the video has no captions", async () => {
    const { deps } = fakes({ captions: async () => undefined });
    const done = await advanceIdea(make("ls-w3", "learn"), deps);
    assert.equal(done.stage, "needs_transcript");
    assert.equal(done.error, "This video has no captions");
  });

  it("waits while the assessment job runs", async () => {
    const { deps, calls } = fakes({ jobStatus: async () => "running" });
    const idea = updateIdea(make("ls-w4", "assess").id, { stage: "assessing", jobId: "job-a" });
    assert.equal((await advanceIdea(idea, deps)).stage, "assessing");
    assert.deepEqual(calls, []);
  });

  it("fails an assessment whose job vanished, e.g. after a restart, and retries it", async () => {
    const { deps } = fakes({ jobStatus: async () => undefined });
    const idea = updateIdea(make("ls-w5", "assess").id, { stage: "assessing", jobId: "job-gone", notePath: "knowledge/videos/x.md" });
    const failed = await advanceIdea(idea, deps);
    assert.equal(failed.stage, "failed");
    assert.equal(failed.failedAt, "assessing");
    assert.match(failed.error ?? "", /stopped/);

    const retried = await retryIdea(failed.id);
    assert.equal(retried.stage, "noted");
    const { deps: working, calls } = fakes();
    assert.equal((await advanceIdea(retried, working)).stage, "assessing");
    assert.deepEqual(calls, ["assess"]);
  });

  it("goes back to the transcript when a note was cut off by a restart", async () => {
    const { deps, calls } = fakes();
    const idea = updateIdea(make("ls-w6", "learn").id, { stage: "noting" });
    const done = await advanceIdea(idea, deps);
    assert.equal(done.stage, "noted");
    assert.deepEqual(calls, ["note"]);
  });

  it("turns a thrown step into a failure with Retry", async () => {
    const { deps } = fakes({
      note: async () => {
        throw new Error("Claude did not answer");
      },
    });
    const done = await advanceIdea(make("ls-w7", "learn"), deps);
    assert.equal(done.stage, "failed");
    assert.equal(done.failedAt, "transcribing");
    assert.equal(done.error, "Claude did not answer");
    assert.equal((await retryIdea(done.id)).stage, "transcribing");
  });

  it("writes the note from a pasted transcript, never asking for captions again", async () => {
    let fetched = false;
    const { deps, calls } = fakes({
      captions: async () => {
        fetched = true;
        return undefined;
      },
      storedTranscript: async (path) => (path === "knowledge/videos/p.transcript.md" ? [{ seconds: 0, text: "pasted" }] : undefined),
    });
    const idea = updateIdea(make("ls-w9", "learn").id, { stage: "noting", transcriptPath: "knowledge/videos/p.transcript.md" });
    const done = await advanceIdea(idea, deps);
    assert.equal(done.stage, "noted");
    assert.deepEqual(calls, ["note"]);
    assert.equal(fetched, false);
  });

  it("retries a note that failed after a pasted transcript", async () => {
    const idea = updateIdea(make("ls-w10", "learn").id, { stage: "failed", failedAt: "needs_transcript", transcriptPath: "knowledge/videos/p.transcript.md" });
    assert.equal((await retryIdea(idea.id)).stage, "transcribing");
  });

  it("only retries a failed idea", async () => {
    await assert.rejects(retryIdea(make("ls-w8", "learn").id), (error: Error & { status?: number }) => error.status === 409);
    assert.equal(getIdea(make("ls-w8", "learn").id)?.stage, "transcribing");
  });
});

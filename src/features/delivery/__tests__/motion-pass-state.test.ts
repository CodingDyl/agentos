import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { motionPassState } from "../motion-pass-state";

type Run = Parameters<typeof motionPassState>[0];
type Motion = NonNullable<Parameters<typeof motionPassState>[1]>;

const APPROVED = "a".repeat(40);
const FIRST = "b".repeat(40);
const SECOND = "c".repeat(40);

const rebuild = (over: Partial<Run> = {}): Run =>
  ({
    stages: [{ id: "functions", approvedRevision: 1 }],
    revisions: [{ stage: "functions", revision: 1, ref: APPROVED }],
    ...over,
  }) as unknown as Run;
const live = (ref: string) => rebuild({ motionRef: ref, motionBase: APPROVED });
const motion = (status: string, integratedCommit?: string, enhanceExisting = true): Motion =>
  ({ enhanceExisting, job: { id: "job_1", status, integratedCommit, href: "/workers/jobs/job_1" } }) as Motion;

describe("what the motion pass card offers", () => {
  it("offers a finished pass, whether or not it has landed", () => {
    assert.equal(motionPassState(rebuild(), motion("awaiting_review")).canPublish, true);
    assert.equal(motionPassState(rebuild(), motion("completed", FIRST)).canPublish, true);
  });

  it("offers a newer pass while an earlier one is on the preview", () => {
    assert.deepEqual(motionPassState(live(FIRST), motion("completed", SECOND)), { published: true, canPublish: true });
    assert.deepEqual(motionPassState(live(FIRST), motion("awaiting_review")), { published: true, canPublish: true });
  });

  it("does not offer the pass already on the preview", () => {
    assert.deepEqual(motionPassState(live(FIRST), motion("completed", FIRST)), { published: true, canPublish: false });
  });

  it("does not offer unfinished work, a landed job whose check failed, or a new motion site", () => {
    assert.equal(motionPassState(rebuild(), motion("running")).canPublish, false);
    assert.equal(motionPassState(rebuild(), motion("failed", FIRST)).canPublish, false);
    assert.equal(motionPassState(rebuild(), motion("completed", undefined)).canPublish, false);
    assert.equal(motionPassState(rebuild(), motion("awaiting_review", undefined, false)).canPublish, false);
    assert.equal(motionPassState(rebuild(), undefined).canPublish, false);
  });
});

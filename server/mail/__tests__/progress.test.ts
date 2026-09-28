import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readProgress, startProgress } from "../progress";

describe("mail progress", () => {
  it("counts a job through its phases and goes idle when it finishes", () => {
    const job = startProgress("sync");
    job.phase("fetching", 2);
    job.advance(true);
    assert.deepEqual([readProgress().phase, readProgress().done, readProgress().total], ["fetching", 1, 2]);

    job.phase("profiling", 3);
    job.advance(true);
    job.advance(false);
    const midway = readProgress();
    assert.deepEqual([midway.running, midway.phase, midway.done, midway.failed, midway.total], [true, "profiling", 2, 1, 3]);

    job.finish();
    assert.equal(readProgress().running, false);
  });

  it("lets a newer job take over and ignores the older one's late updates", () => {
    const older = startProgress("sync");
    older.phase("profiling", 10);
    const newer = startProgress("reprofile");
    newer.phase("profiling", 4);

    older.advance(true);
    older.finish();
    assert.deepEqual([readProgress().running, readProgress().kind, readProgress().done], [true, "reprofile", 0]);

    newer.finish();
    assert.equal(readProgress().running, false);
  });
});

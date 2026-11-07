import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deleteOwnerHours, logOwnerHours, ownerHoursFile, readOwnerHours } from "../hours-store";

describe("owner hours store", () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.AGENTOS_UI_DIR;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "owner-hours-"));
    process.env.AGENTOS_UI_DIR = dir;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads nothing when no hours were ever logged", async () => {
    assert.deepEqual(await readOwnerHours(), []);
  });

  it("logs an entry with an id and a time, and reads it back", async () => {
    const entry = await logOwnerHours({ on: "2026-11-10", minutes: 30, kind: "delivery", workspace: "acme", note: "Review" });
    assert.match(entry.id, /^oh-/);
    assert.equal(entry.minutes, 30);
    assert.deepEqual((await readOwnerHours()).map((item) => item.id), [entry.id]);
  });

  it("keeps every entry when two are logged at once", async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => logOwnerHours({ on: "2026-11-10", minutes: n * 15, kind: "admin" })));
    assert.equal((await readOwnerHours()).length, 5);
  });

  it("deletes one entry, and says when there was none", async () => {
    const keep = await logOwnerHours({ on: "2026-11-10", minutes: 15, kind: "sales" });
    const drop = await logOwnerHours({ on: "2026-11-10", minutes: 45, kind: "sales" });
    assert.equal(await deleteOwnerHours(drop.id), true);
    assert.equal(await deleteOwnerHours(drop.id), false);
    assert.deepEqual((await readOwnerHours()).map((item) => item.id), [keep.id]);
  });

  it("skips an unreadable entry instead of failing the list", async () => {
    const good = await logOwnerHours({ on: "2026-11-10", minutes: 15, kind: "review" });
    const file = ownerHoursFile();
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as { items: unknown[] };
    stored.items.push({ id: "broken", minutes: "lots" });
    await fs.writeFile(file, JSON.stringify(stored));
    assert.deepEqual((await readOwnerHours()).map((item) => item.id), [good.id]);
  });

  it("refuses to read a missing file as an error", async () => {
    await assert.doesNotReject(readOwnerHours());
  });
});

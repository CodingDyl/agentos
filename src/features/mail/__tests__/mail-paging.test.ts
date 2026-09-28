import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailData, MailThread } from "@shared/mail-types";
import { flattenMail, pageWindow, paginateMail, statusCounts } from "../mail-model";

function threads(prefix: string, count: number, classified = true): MailThread[] {
  return Array.from({ length: count }, (_, index) => ({
    threadId: `${prefix}${index}`,
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
    classified,
    unread: false,
  }));
}

const data: MailData = {
  generatedAt: "2026-09-28T00:00:00.000Z",
  needsYou: threads("n", 10),
  fyi: [...threads("u", 5, false), ...threads("f", 30)],
  lowPriority: threads("l", 20),
};
const rows = flattenMail(data);

describe("statusCounts", () => {
  it("counts each bucket, plus unclassified threads inside FYI", () => {
    assert.deepEqual(statusCounts(rows), { all: 65, needs: 10, fyi: 35, low: 20, unsorted: 5 });
  });
});

describe("paginateMail", () => {
  it("regroups a page that spans a bucket boundary", () => {
    const page = paginateMail(rows, "all", 1, 25);
    assert.deepEqual(
      page.groups.map((group) => [group.tone, group.rows.length]),
      [
        ["needs", 10],
        ["fyi", 15],
      ],
    );
    assert.equal(page.pageCount, 3);
    assert.equal(page.firstIndex, 1);
    assert.equal(page.lastIndex, 25);
  });

  it("filters to one status", () => {
    const page = paginateMail(rows, "low", 1, 25);
    assert.equal(page.total, 20);
    assert.deepEqual(page.groups.map((group) => group.tone), ["low"]);
  });

  it("filters to threads Jev hasn't classified yet", () => {
    const page = paginateMail(rows, "unsorted", 1, 25);
    assert.equal(page.total, 5);
    assert.ok(page.groups[0].rows.every((row) => !row.thread.classified));
  });

  it("clamps a page past the end back into range", () => {
    const page = paginateMail(rows, "needs", 4, 25);
    assert.equal(page.page, 1);
    assert.equal(page.pageCount, 1);
  });

  it("reports an empty filter as zero rows on page 1", () => {
    const page = paginateMail(flattenMail({ ...data, lowPriority: [] }), "low", 1, 25);
    assert.deepEqual([page.total, page.page, page.firstIndex, page.groups.length], [0, 1, 0, 0]);
  });
});

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    assert.deepEqual(pageWindow(2, 3), [1, 2, 3]);
  });

  it("elides the middle around the current page", () => {
    assert.deepEqual(pageWindow(4, 6), [1, null, 3, 4, 5, 6]);
    assert.deepEqual(pageWindow(1, 6), [1, 2, null, 6]);
  });
});

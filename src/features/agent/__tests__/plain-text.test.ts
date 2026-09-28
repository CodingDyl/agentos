import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withoutEmDashes } from "@shared/plain-text";

describe("withoutEmDashes", () => {
  it("turns a clause dash into a comma", () => {
    assert.equal(withoutEmDashes("The site is fast — and it converts."), "The site is fast, and it converts.");
    assert.equal(withoutEmDashes("fast—and"), "fast, and");
  });

  it("keeps number ranges as hyphens", () => {
    assert.equal(withoutEmDashes("From 2019—2021, and 5 – 10 agents"), "From 2019-2021, and 5-10 agents");
  });

  it("ends a clause at a line break, and keeps a dash list marker as a hyphen", () => {
    assert.equal(withoutEmDashes("Three things —\n— speed\n— trust"), "Three things:\n- speed\n- trust");
  });

  it("never touches code", () => {
    const text = "Run `a — b` then\n```\nx — y\n```\nok — done";
    assert.equal(withoutEmDashes(text), "Run `a — b` then\n```\nx — y\n```\nok, done");
  });

  it("leaves hyphenated words and clean text alone", () => {
    assert.equal(withoutEmDashes("A well-known, low-friction ask."), "A well-known, low-friction ask.");
  });

  it("does not leave a comma before punctuation", () => {
    assert.equal(withoutEmDashes("It works —."), "It works.");
  });
});

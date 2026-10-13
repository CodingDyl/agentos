import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_SNIPPETS,
  frameAt,
  sliceTokens,
  totalChars,
} from "../sidebar-code-panel-model";

describe("sidebar code panel", () => {
  it("has looping snippets that carry syntax kinds", () => {
    assert.ok(CODE_SNIPPETS.length >= 2);
    const kinds = new Set(CODE_SNIPPETS.flatMap((snippet) => snippet.lines.flatMap((line) => line.map((token) => token.kind))));
    for (const kind of ["keyword", "string", "comment"] as const) {
      assert.ok(kinds.has(kind), `missing ${kind}`);
    }
  });

  it("types characters in order and parks a cursor at the end of the visible text", () => {
    const lines = [
      [
        { kind: "keyword" as const, text: "const" },
        { kind: "plain" as const, text: " x" },
      ],
      [{ kind: "comment" as const, text: "// hi" }],
    ];
    const empty = sliceTokens(lines, 0);
    assert.deepEqual(empty.lines, []);
    assert.deepEqual(empty.cursor, { line: 0, column: 0 });

    const mid = sliceTokens(lines, 7);
    assert.equal(mid.lines.length, 1);
    assert.equal(mid.lines[0].map((token) => token.text).join(""), "const x");
    assert.deepEqual(mid.cursor, { line: 0, column: 7 });

    const intoSecond = sliceTokens(lines, 9);
    assert.equal(intoSecond.lines.length, 2);
    assert.equal(intoSecond.lines[1].map((token) => token.text).join(""), "/");
    assert.deepEqual(intoSecond.cursor, { line: 1, column: 1 });

    const full = sliceTokens(lines, totalChars(lines));
    assert.equal(full.lines.length, 2);
    assert.equal(full.lines[1].map((token) => token.text).join(""), "// hi");
  });

  it("loops through snippets after a pause, and shows a finished frame when motion is reduced", () => {
    const first = CODE_SNIPPETS[0];
    const charMs = 20;
    const pauseMs = 100;
    const firstDuration = totalChars(first.lines) * charMs + pauseMs;

    const typing = frameAt(charMs * 4, { charMs, pauseMs, reducedMotion: false });
    assert.equal(typing.snippetIndex, 0);
    assert.equal(typing.done, false);
    assert.ok(typing.lines.length >= 1);

    const paused = frameAt(firstDuration - 10, { charMs, pauseMs, reducedMotion: false });
    assert.equal(paused.snippetIndex, 0);
    assert.equal(paused.done, true);

    const next = frameAt(firstDuration + charMs, { charMs, pauseMs, reducedMotion: false });
    assert.equal(next.snippetIndex, 1);

    const still = frameAt(12_000, { charMs, pauseMs, reducedMotion: true });
    assert.equal(still.snippetIndex, 0);
    assert.equal(still.done, true);
    assert.equal(still.lines.length, first.lines.length);
  });
});

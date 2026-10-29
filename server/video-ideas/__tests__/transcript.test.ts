import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fetchCaptions, linesFromPaste, parseVtt, transcriptText } from "../transcript";

const AUTO_VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
so<00:00:01.500><c> today</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
so today

00:00:03.010 --> 00:00:05.000 align:start position:0%
so today
we<00:00:03.500><c> build</c><00:00:04.000><c> agents</c>

00:01:05.000 --> 00:01:07.000
that &amp; more
`;

describe("transcripts", () => {
  it("reads auto captions without their rolling repeats or tags", () => {
    assert.deepEqual(parseVtt(AUTO_VTT), [
      { seconds: 1, text: "so today" },
      { seconds: 3, text: "we build agents" },
      { seconds: 65, text: "that & more" },
    ]);
  });

  it("stamps minutes, and hours past an hour", () => {
    assert.equal(
      transcriptText([
        { seconds: 65, text: "a" },
        { seconds: 3723, text: "b" },
      ]),
      "[01:05] a\n[1:02:03] b",
    );
  });

  it("splits a pasted transcript, keeping its timestamps when it has them", () => {
    assert.deepEqual(linesFromPaste("[01:05] hello\n\n2:00 world\nplain line"), [
      { seconds: 65, text: "hello" },
      { seconds: 120, text: "world" },
      { seconds: 120, text: "plain line" },
    ]);
  });

  it("returns undefined when a video has no captions", async () => {
    assert.equal(await fetchCaptions("dQw4w9WgXcQ", async () => undefined), undefined);
  });

  it("prefers hand-made English captions over auto ones", async () => {
    const lines = await fetchCaptions("dQw4w9WgXcQ", async (_args, cwd) => {
      await fs.writeFile(path.join(cwd, "dQw4w9WgXcQ.en-orig.vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nauto words\n");
      await fs.writeFile(path.join(cwd, "dQw4w9WgXcQ.en.vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nmanual words\n");
    });
    assert.deepEqual(lines, [{ seconds: 1, text: "manual words" }]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HANDOFF, SPEECH_BUDGET, SpeechStream } from "../speech-stream";

/** Feeds a reply the way Hermes streams it: a few characters at a time. */
function stream(reply: string, step = 7): string[] {
  const speech = new SpeechStream();
  const pieces: string[] = [];
  for (let end = step; end < reply.length + step; end += step) {
    pieces.push(...speech.feed(reply.slice(0, Math.min(end, reply.length)), false));
  }
  pieces.push(...speech.feed(reply, true));
  return pieces;
}

describe("SpeechStream", () => {
  it("speaks a finished sentence before the reply is complete", () => {
    const speech = new SpeechStream();
    assert.deepEqual(speech.feed("Your morning is clear apart from one call", false), []);
    const early = speech.feed("Your morning is clear apart from one call with Sam at ten. Then the", false);
    assert.equal(early.length, 1);
    assert.ok(early[0].startsWith("Your morning is clear"));
    assert.ok(!early[0].includes("Then the"));
  });

  it("never repeats or drops words however the text arrives", () => {
    const reply =
      "Focus on the pantry sync bug first. It blocks two customers today.\nThen review the onboarding copy, which is short. After that, reply to the two warm leads and close the loop on the invoice.";
    for (const step of [1, 3, 7, 25, 1000]) {
      const spoken = stream(reply, step).join(" ").replace(/\s+/g, " ");
      assert.equal(spoken, reply.replace(/\s+/g, " "), `step ${step}`);
    }
  });

  it("does not speak code, even when a fence is still open", () => {
    const reply = "Here is the change to make in the config file today.\n```ts\nconst secret = 1;\n```\nThat is all I would change for now, honestly.";
    const spoken = stream(reply, 5).join(" ");
    assert.ok(!spoken.includes("secret"));
    assert.ok(spoken.includes("That is all I would change"));

    const openFence = new SpeechStream();
    const out = openFence.feed("Here is the change to make in the config file today.\n```ts\nconst secret = 1;\nmore code", false);
    assert.ok(out.every((piece) => !piece.includes("secret")));
  });

  it("holds a fragment back until it is worth a request, but flushes it at the end", () => {
    const speech = new SpeechStream();
    assert.deepEqual(speech.feed("Done.", false), []);
    assert.deepEqual(speech.feed("Done.", true), ["Done."]);
  });

  it("stops at a budget and hands off to the screen, once", () => {
    const sentence = "This is another sentence of a reasonable length. ";
    const long = sentence.repeat(Math.ceil((SPEECH_BUDGET * 3) / sentence.length));
    const speech = new SpeechStream();
    const pieces = [...speech.feed(long, false), ...speech.feed(long, true)];
    assert.equal(pieces.at(-1), HANDOFF);
    assert.equal(pieces.filter((piece) => piece === HANDOFF).length, 1);
    assert.equal(speech.isCapped, true);
    assert.deepEqual(speech.feed(long + "more.", true), []);
  });

  it("keeps every request short enough to answer quickly", () => {
    const run = "word ".repeat(200);
    for (const piece of stream(run, 50)) assert.ok(piece.length <= 330, `${piece.length}`);
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { synthesise, transcribe, VoiceError } from "../fish";
import { isVoiceEnabled, setVoiceEnabled } from "../settings";
import { toSpeechText } from "../speech-text";

describe("toSpeechText", () => {
  it("drops code, tables, links and markup but keeps the words", () => {
    const { text, truncated } = toSpeechText(
      "## Focus\n\n- **Ship** the [landing page](https://x.dev)\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n",
    );
    assert.equal(truncated, false);
    assert.ok(text.includes("Ship the landing page"));
    assert.ok(!/const|https|\||\*\*/.test(text));
  });

  it("cuts long replies at a sentence and hands off to the screen", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const { text, truncated } = toSpeechText(long, 200);
    assert.equal(truncated, true);
    assert.ok(text.endsWith("The rest is on screen."));
    assert.ok(text.length < 240);
  });
});

describe("voice switch", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-"));
    process.env.AGENTOS_UI_DIR = dir;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is on by default and remembers being switched off", () => {
    assert.equal(isVoiceEnabled(), true);
    setVoiceEnabled(false);
    assert.equal(isVoiceEnabled(), false);
    setVoiceEnabled(true);
    assert.equal(isVoiceEnabled(), true);
  });
});

describe("Fish Audio adapter", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.FISH_AUDIO_API_KEY;
  });

  it("refuses without a key and never calls out", async () => {
    delete process.env.FISH_AUDIO_API_KEY;
    delete process.env.FISH_API_KEY;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("");
    }) as typeof fetch;
    await assert.rejects(synthesise("hi"), (e: VoiceError) => e.reason === "not-configured");
    assert.equal(called, false);
  });

  it("sends the key and the Jarvis voice, and returns audio", async () => {
    process.env.FISH_AUDIO_API_KEY = "secret";
    let seen: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const audio = await synthesise("Good morning");
    assert.equal(audio.length, 3);
    assert.ok(seen!.url.endsWith("/v1/tts"));
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer secret");
    assert.equal(JSON.parse(seen!.init.body as string).reference_id, "05b36da8574341d0803391491850db20");
  });

  it("classifies a rejected key without leaking it", async () => {
    process.env.FISH_AUDIO_API_KEY = "secret";
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
    await assert.rejects(synthesise("hi"), (e: VoiceError) => e.reason === "unauthorized" && !e.message.includes("secret"));
  });

  it("reads a transcript and treats silence as empty", async () => {
    process.env.FISH_AUDIO_API_KEY = "secret";
    globalThis.fetch = (async () => Response.json({ text: " give me my morning brief " })) as typeof fetch;
    assert.equal(await transcribe(Buffer.from([1]), "audio/webm"), "give me my morning brief");
    globalThis.fetch = (async () => Response.json({ text: "" })) as typeof fetch;
    await assert.rejects(transcribe(Buffer.from([1]), "audio/webm"), (e: VoiceError) => e.reason === "empty");
  });
});

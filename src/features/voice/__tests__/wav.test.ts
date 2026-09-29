import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeWav, mixToMono, resample } from "../wav";

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));

describe("encodeWav", () => {
  it("writes a valid 16-bit mono PCM header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16_000);
    const view = new DataView(wav.buffer);

    assert.equal(ascii(wav, 0, 4), "RIFF");
    assert.equal(ascii(wav, 8, 4), "WAVE");
    assert.equal(ascii(wav, 12, 4), "fmt ");
    assert.equal(view.getUint16(20, true), 1, "PCM");
    assert.equal(view.getUint16(22, true), 1, "mono");
    assert.equal(view.getUint32(24, true), 16_000, "sample rate");
    assert.equal(view.getUint32(28, true), 32_000, "byte rate");
    assert.equal(view.getUint16(34, true), 16, "bits per sample");
    assert.equal(ascii(wav, 36, 4), "data");
    assert.equal(view.getUint32(40, true), 8, "data bytes");
    assert.equal(view.getUint32(4, true), wav.length - 8, "RIFF size");
    assert.equal(wav.length, 44 + 8);
  });

  it("converts and clamps samples", () => {
    const wav = encodeWav(new Float32Array([1, -1, 2, -2, 0]), 8_000);
    const view = new DataView(wav.buffer);
    assert.equal(view.getInt16(44, true), 32767);
    assert.equal(view.getInt16(46, true), -32768);
    assert.equal(view.getInt16(48, true), 32767, "over-range clamps high");
    assert.equal(view.getInt16(50, true), -32768, "over-range clamps low");
    assert.equal(view.getInt16(52, true), 0);
  });
});

describe("resample", () => {
  it("brings 48 kHz down to a third of the length at 16 kHz", () => {
    const out = resample(new Float32Array(48_000).fill(0.25), 48_000, 16_000);
    assert.equal(out.length, 16_000);
    assert.ok(out.every((sample) => Math.abs(sample - 0.25) < 1e-6));
  });

  it("leaves audio alone when the rate already matches", () => {
    const samples = new Float32Array([0.1, 0.2]);
    assert.equal(resample(samples, 16_000, 16_000), samples);
  });

  it("keeps the shape of a ramp", () => {
    const ramp = Float32Array.from({ length: 300 }, (_, i) => i / 300);
    const out = resample(ramp, 48_000, 16_000);
    for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1]);
  });
});

describe("mixToMono", () => {
  it("averages channels", () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    assert.deepEqual(Array.from(mono), [0.5, 0.5]);
  });

  it("passes a single channel straight through", () => {
    const only = new Float32Array([0.3]);
    assert.equal(mixToMono([only]), only);
  });
});

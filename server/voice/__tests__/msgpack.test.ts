import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeMsgpack } from "../msgpack";

/**
 * Expected bytes come from `ormsgpack`, the library Fish Audio's own Python
 * SDK uses to build its requests, so a pass means byte-for-byte agreement.
 */
const FROM_SDK_LIBRARY = {
  asr: "83a5617564696fc403010203a86c616e6775616765c0b169676e6f72655f74696d657374616d7073c3",
  tts: "8da474657874aa48656c6c6f207369722eac6368756e6b5f6c656e677468ccc8a6666f726d6174a36d7033ab73616d706c655f72617465c0ab6d70335f62697472617465cc80ac6f7075735f6269747261746520aa7265666572656e63657390ac7265666572656e63655f6964d9203035623336646138353734333431643038303333393134393138353064623230a96e6f726d616c697a65c3a76c6174656e6379a862616c616e636564a770726f736f6479c0a5746f705f70cb3fe6666666666666ab74656d7065726174757265cb3fe6666666666666",
  ints: "8ba16100a1627fa163cc80a164ccffa165cd0100a166cdffffa167ce00010000a168ffa169e0a16ad0dfa16bd1ff7f",
  long: "84a173d92878787878787878787878787878787878787878787878787878787878787878787878787878787878a174a8c3a9e28094e29c93a162c5012c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a16c9401a374776fc0c2",
};

describe("encodeMsgpack", () => {
  it("encodes the speech-to-text request exactly as the SDK does", () => {
    const bytes = encodeMsgpack({ audio: new Uint8Array([1, 2, 3]), language: null, ignore_timestamps: true });
    assert.equal(bytes.toString("hex"), FROM_SDK_LIBRARY.asr);
  });

  it("encodes the text-to-speech request exactly as the SDK does", () => {
    const bytes = encodeMsgpack({
      text: "Hello sir.",
      chunk_length: 200,
      format: "mp3",
      sample_rate: null,
      mp3_bitrate: 128,
      opus_bitrate: 32,
      references: [],
      reference_id: "05b36da8574341d0803391491850db20",
      normalize: true,
      latency: "balanced",
      prosody: null,
      top_p: 0.7,
      temperature: 0.7,
    });
    assert.equal(bytes.toString("hex"), FROM_SDK_LIBRARY.tts);
  });

  it("uses the shortest integer form at every boundary", () => {
    const bytes = encodeMsgpack({ a: 0, b: 127, c: 128, d: 255, e: 256, f: 65535, g: 65536, h: -1, i: -32, j: -33, k: -129 });
    assert.equal(bytes.toString("hex"), FROM_SDK_LIBRARY.ints);
  });

  it("handles long strings, unicode, large binary and mixed arrays", () => {
    const bytes = encodeMsgpack({ s: "x".repeat(40), t: "é—✓", b: new Uint8Array(300), l: [1, "two", null, false] });
    assert.equal(bytes.toString("hex"), FROM_SDK_LIBRARY.long);
  });
});

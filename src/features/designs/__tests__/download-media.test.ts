import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeDataUrl, isRemoteHttpUrl, originalMediaUrl } from "../download-media";

describe("originalMediaUrl", () => {
  it("strips a thumbnail size so the download is the original", () => {
    assert.equal(
      originalMediaUrl("/api/designs/assets/a1/media?size=thumbnail"),
      "/api/designs/assets/a1/media",
    );
  });

  it("leaves a data URL alone", () => {
    assert.equal(originalMediaUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  });
});

describe("isRemoteHttpUrl", () => {
  it("treats AgentOS media paths as local", () => {
    assert.equal(isRemoteHttpUrl("/api/designs/assets/a1/media"), false);
    assert.equal(isRemoteHttpUrl("data:image/png;base64,AAAA"), false);
  });

  it("treats an absolute third-party URL as remote", () => {
    assert.equal(isRemoteHttpUrl("https://cdn.example/out.png"), true);
  });
});

describe("decodeDataUrl", () => {
  it("decodes a base64 PNG payload and keeps the mime type", () => {
    const decoded = decodeDataUrl("data:image/png;base64,AQID");
    assert.equal(decoded.mimeType, "image/png");
    assert.deepEqual([...decoded.data], [1, 2, 3]);
  });
});

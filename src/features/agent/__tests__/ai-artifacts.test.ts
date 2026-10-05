import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withoutAiArtifacts } from "../../../../shared/plain-text";

const c = (code: number) => String.fromCodePoint(code);
const EM_DASH = c(0x2014);
const EN_DASH = c(0x2013);
const ZERO_WIDTH_SPACE = c(0x200b);
const ZWJ = c(0x200d);
const BOM = c(0xfeff);
const NBSP = c(0x00a0);
const NARROW_NBSP = c(0x202f);

describe("withoutAiArtifacts", () => {
  it("removes em dashes and spaced en dashes", () => {
    const result = withoutAiArtifacts(`Thanks for the update ${EM_DASH} that works for us ${EN_DASH} see you then.`);
    assert.ok(!result.includes(EM_DASH));
    assert.ok(!result.includes(EN_DASH));
    assert.equal(result, "Thanks for the update, that works for us, see you then.");
  });

  it("turns a number range dash into a hyphen", () => {
    assert.equal(withoutAiArtifacts(`Available 9${EN_DASH}5 on weekdays.`), "Available 9-5 on weekdays.");
  });

  it("strips invisible watermark characters", () => {
    const marked = `Hi${ZERO_WIDTH_SPACE} Sam,${BOM}\nThe${c(0x2060)} invoice is attached.${c(0x200e)}`;
    const result = withoutAiArtifacts(marked);
    assert.equal(result, "Hi Sam,\nThe invoice is attached.");
    assert.ok([...result].every((character) => character.charCodeAt(0) < 128));
  });

  it("keeps a zero-width joiner inside an emoji sequence but drops a stray one", () => {
    const technologist = `${c(0x1f469)}${ZWJ}${c(0x1f4bb)}`;
    assert.equal(withoutAiArtifacts(`Team ${technologist}`), `Team ${technologist}`);
    assert.equal(withoutAiArtifacts(`Wo${ZWJ}rd`), "Word");
  });

  it("normalises look-alike spaces, curly quotes and the ellipsis character", () => {
    const result = withoutAiArtifacts(`${c(0x201c)}Great${c(0x201d)},${NBSP}it${c(0x2019)}s done${c(0x2026)}${NARROW_NBSP}ok`);
    assert.equal(result, `"Great", it's done... ok`);
  });

  it("drops markdown emphasis and headings", () => {
    assert.equal(withoutAiArtifacts("## Update\nThe **deadline** is Friday."), "Update\nThe deadline is Friday.");
  });

  it("removes a model preamble and a trailing offer to help", () => {
    const reply = "Here is a polished version of your email:\n\nHi Sam,\n\nThe report is ready.\n\nLet me know if you want any changes.";
    assert.equal(withoutAiArtifacts(reply), "Hi Sam,\n\nThe report is ready.");
  });

  it("leaves ordinary text a person wrote alone", () => {
    const text = "Hi Sam,\n\nThe well-known 2-step plan is attached. Can we meet at 10:30?\n\nThanks,\nDylan";
    assert.equal(withoutAiArtifacts(text), text);
  });
});

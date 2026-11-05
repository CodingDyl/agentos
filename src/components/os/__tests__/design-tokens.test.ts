import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatShortcut, isMacPlatform } from "../../../lib/shortcuts";

/** The tokens as `agentos.css` declares them, so this checks what ships. */
const css = readFileSync(new URL("../../../styles/agentos.css", import.meta.url), "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(match, `--${name} is declared as a hex value`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Quiet Terminal tokens", () => {
  it("declares the exact values DESIGN.md specifies", () => {
    const expected: Record<string, string> = {
      "bg-canvas": "#111315",
      "bg-sidebar": "#15181b",
      "bg-panel": "#1a1e22",
      "bg-raised": "#22272d",
      "bg-selected": "#273b34",
      "border-subtle": "#30363d",
      "border-control": "#65717d",
      "text-primary": "#eef1f4",
      "text-secondary": "#acb5bf",
      "text-muted": "#8e99a5",
      accent: "#9ddbbd",
      "accent-hover": "#b4e6ce",
      "on-accent": "#12231b",
      focus: "#b0d6ff",
      "status-success": "#9ddbbd",
      "status-warning": "#e8c58a",
      "status-error": "#f4a3a8",
    };
    for (const [name, value] of Object.entries(expected)) assert.equal(token(name).toLowerCase(), value, name);
  });

  it("keeps normal text at AA on every surface it sits on", () => {
    const surfaces = ["bg-canvas", "bg-sidebar", "bg-panel", "bg-raised", "bg-selected"];
    const texts = ["text-primary", "text-secondary", "text-muted", "status-warning", "status-error", "status-success"];
    for (const surface of surfaces) {
      for (const text of texts) {
        // Documented in DESIGN.md: selected states use primary or secondary text.
        if (surface === "bg-selected" && text === "text-muted") continue;
        const ratio = contrast(token(text), token(surface));
        assert.ok(ratio >= 4.5, `${text} on ${surface} is ${ratio.toFixed(2)}`);
      }
    }
  });

  it("records that muted text is not for the Selected fill", () => {
    assert.ok(contrast(token("text-muted"), token("bg-selected")) < 4.5);
  });

  it("keeps the primary action, control edges and focus legible", () => {
    assert.ok(contrast(token("on-accent"), token("accent")) >= 4.5);
    assert.ok(contrast(token("on-accent"), token("accent-hover")) >= 4.5);
    for (const surface of ["bg-canvas", "bg-sidebar", "bg-panel"]) {
      assert.ok(contrast(token("border-control"), token(surface)) >= 3, `control edge on ${surface}`);
      assert.ok(contrast(token("focus"), token(surface)) >= 3, `focus on ${surface}`);
    }
  });
});

describe("formatShortcut", () => {
  it("writes the modifier the platform has", () => {
    assert.equal(formatShortcut("K", "MacIntel"), "⌘K");
    assert.equal(formatShortcut("⇧C", "MacIntel"), "⌘⇧C");
    assert.equal(formatShortcut("K", "Win32"), "Ctrl K");
    assert.equal(formatShortcut("⇧C", "Linux x86_64"), "Ctrl Shift C");
  });

  it("treats iPad and iPhone as Apple, and an unknown platform as not", () => {
    assert.equal(isMacPlatform("iPad"), true);
    assert.equal(isMacPlatform(undefined), false);
  });
});

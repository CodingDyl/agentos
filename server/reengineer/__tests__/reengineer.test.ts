import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-reengineer-"));
process.env.AGENTOS_ROOT = root;

const { addEntry, libraryBrief, listLibrary, mediaPath, recordVerdict } = await import("../library");
const { normaliseTarget, parseLibraryJson, targetKind } = await import("../runs");

describe("what a target is", () => {
  it("tells a website from an app from source", () => {
    assert.equal(targetKind("https://linear.app"), "website");
    assert.equal(targetKind("linear.app/features"), "website");
    assert.equal(targetKind("Notes"), "app");
    assert.equal(targetKind("/Users/me/code/thing"), "source");
    assert.equal(targetKind("https://github.com/o/r"), "website");
    assert.equal(normaliseTarget("linear.app"), "https://linear.app");
    assert.equal(normaliseTarget("Notes"), "Notes");
  });
});

describe("reading what a run wrote", () => {
  it("takes the documented shape and the usual variations, and drops what has no substance", () => {
    const entries = parseLibraryJson(
      JSON.stringify({
        entries: [
          { title: "Sticky scroll header", kind: "component", summary: "A header that shrinks on scroll.", whyItWorks: "It keeps the call to action in reach.", tags: ["navigation"] },
          { name: "Hero camera dolly", type: "motion", description: "Scroll scrubs a video.", why_it_works: "One continuous shot." },
          { title: "No summary" },
          "junk",
        ],
      }),
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[1].kind, "motion");
    assert.equal(entries[1].whyItWorks, "One continuous shot.");
    assert.deepEqual(parseLibraryJson("not json"), []);
  });
});

describe("the library in the vault", () => {
  it("files an entry as a note, numbers duplicate titles, and reads it back", async () => {
    const first = await addEntry({ title: "Sticky header", kind: "component", summary: "Shrinks on scroll.", whyItWorks: "CTA stays reachable.", tags: ["Navigation"], source: { target: "https://a.test", runId: "rev_1" } });
    const second = await addEntry({ title: "Sticky header", kind: "component", summary: "Another.", whyItWorks: "", tags: [], source: { target: "https://b.test" } });
    assert.equal(first.id, "sticky-header");
    assert.equal(second.id, "sticky-header-2");
    assert.ok(fs.existsSync(path.join(root, "knowledge/library/sticky-header.md")));
    const entries = await listLibrary();
    assert.equal(entries.length, 2);
    const read = entries.find((entry) => entry.id === "sticky-header")!;
    assert.equal(read.summary, "Shrinks on scroll.");
    assert.equal(read.whyItWorks, "CTA stays reachable.");
    assert.deepEqual(read.tags, ["navigation"]);
    assert.equal(read.status, "candidate");
  });

  it("learns from verdicts: proven and rejected set standing, used only counts", async () => {
    const proven = await recordVerdict("sticky-header", "proven", "Worked on Bosch");
    assert.equal(proven?.status, "proven");
    const used = await recordVerdict("sticky-header", "used", undefined, "bosch");
    assert.equal(used?.status, "proven");
    assert.equal(used?.uses, 1);
    assert.equal(used?.verdicts.length, 2);
    const rejected = await recordVerdict("sticky-header-2", "rejected", "Janky on mobile");
    assert.equal(rejected?.status, "rejected");
    assert.equal(await recordVerdict("../../etc/passwd", "proven"), undefined);
    assert.equal(await recordVerdict("nope", "proven"), undefined);
  });

  it("briefs a worker with proven first and names rejected ones so they are not reached for", async () => {
    const brief = libraryBrief(await listLibrary());
    assert.match(brief, /## Proven[\s\S]*Sticky header/);
    assert.match(brief, /do not reach for these[\s\S]*Janky on mobile/);
    assert.match(brief, /not source to copy/);
    assert.ok(!libraryBrief(await listLibrary(), { kind: "motion" }).includes("Sticky header"));
  });

  it("serves only images inside the knowledge folders", () => {
    assert.ok(mediaPath("knowledge/teardowns/assets/rev_1/a.png"));
    assert.equal(mediaPath("knowledge/teardowns/../../secret.png"), undefined);
    assert.equal(mediaPath("projects/x/photo.png"), undefined);
    assert.equal(mediaPath("knowledge/library/sticky-header.md"), undefined);
  });
});

describe("the library in a prompt", () => {
  it("offers only the kinds that bear on the work, proven first, and adds nothing when nothing applies", async () => {
    const { libraryPromptContext, withLibrary } = await import("../library");
    await addEntry({ title: "Camera dolly hero", kind: "motion", summary: "Scroll scrubs one continuous shot.", whyItWorks: "No cuts to break the journey.", tags: [], source: { target: "https://c.test" } });
    await recordVerdict("camera-dolly-hero", "proven");
    const entries = await listLibrary();

    const motion = libraryPromptContext(entries, ["motion"]);
    assert.match(motion, /^## Patterns from the library/);
    assert.match(motion, /Proven:\n- Camera dolly hero/);
    assert.ok(!motion.includes("Sticky header"), "a component is not offered to motion work");
    assert.match(motion, /never source or assets to copy/);

    const components = libraryPromptContext(entries, ["component"]);
    assert.match(components, /Proven:\n- Sticky header/);
    assert.match(components, /Tried and rejected, so avoid:\n- Sticky header: Janky on mobile/);

    assert.equal(libraryPromptContext(entries, ["function"]), "");
    assert.equal(await withLibrary("BRIEF", ["function"]), "BRIEF");
    assert.match(await withLibrary("BRIEF", ["motion"]), /^BRIEF\n\n## Patterns from the library/);
  });

  it("stays bounded however large the library grows", async () => {
    const { libraryPromptContext } = await import("../library");
    const big = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index}`, title: `Pattern ${index}`, kind: "pattern" as const, summary: "x".repeat(400), whyItWorks: "y".repeat(400),
      tags: [], status: "proven" as const, source: { target: "t" }, verdicts: [], uses: 0, createdAt: "2026-01-01T00:00:00Z", path: "p",
    }));
    assert.ok(libraryPromptContext(big, ["pattern"]).length <= 3200);
  });
});

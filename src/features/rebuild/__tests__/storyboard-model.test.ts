import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageNote, RebuildArtifact } from "../../../../shared/website-rebuild-types";
import { comparePages, noteTotal, pagesOf, pinFromPoint, routeLabel, snapshotsComplete, writtenNotes } from "../storyboard-model";

let sequence = 0;
const shot = (route: string, viewport: "desktop" | "mobile", revision: number, digest?: string): RebuildArtifact => {
  sequence += 1;
  return { id: `a${sequence}`, stage: "build", media: "image", title: `${route} (${viewport})`, path: `p${sequence}.png`, href: `/img/${sequence}`, revision, digest, createdAt: "2026-10-08T00:00:00.000Z" };
};
const both = (route: string, revision: number, digest: string) => [shot(route, "desktop", revision, digest), shot(route, "mobile", revision, `${digest}-m`)];

describe("storyboard pages", () => {
  it("groups snapshots by the route in their title, home first", () => {
    const pages = pagesOf([...both("/contact", 1, "c"), ...both("/", 1, "h"), shot("/about", "desktop", 1)]);
    assert.deepEqual(pages.map((page) => page.route), ["/", "/contact", "/about"]);
    assert.ok(pages[0].desktop && pages[0].mobile);
    assert.equal(pages[2].mobile, undefined);
  });

  it("calls a baseline complete only when every page has both widths", () => {
    assert.equal(snapshotsComplete([]), false);
    assert.equal(snapshotsComplete(pagesOf(both("/", 1, "h"))), true);
    assert.equal(snapshotsComplete(pagesOf([...both("/", 1, "h"), shot("/about", "desktop", 1)])), false);
  });

  it("ignores images that are not page snapshots", () => {
    const stray = { ...shot("/", "desktop", 1), title: "Logo (logo-1)" };
    assert.deepEqual(pagesOf([stray]), []);
  });

  it("labels the home page", () => {
    assert.equal(routeLabel("/"), "Home");
    assert.equal(routeLabel("/services/electrical"), "/services/electrical");
  });
});

describe("before and after", () => {
  it("has nothing to compare on the first revision", () => {
    assert.deepEqual(comparePages(both("/", 1, "h"), 1), []);
  });

  it("marks a page changed when its bytes differ, and leaves an identical one alone", () => {
    const images = [...both("/", 1, "h"), ...both("/contact", 1, "c1"), ...both("/", 2, "h"), ...both("/contact", 2, "c2")];
    const changes = comparePages(images, 2);
    assert.equal(changes.find((change) => change.route === "/")?.changed, false);
    const contact = changes.find((change) => change.route === "/contact");
    assert.equal(contact?.changed, true);
    assert.equal(contact?.before?.desktop?.revision, 1);
    assert.equal(contact?.after.desktop?.revision, 2);
  });

  it("notices a change at phone width only", () => {
    const images = [shot("/", "desktop", 1, "d"), shot("/", "mobile", 1, "m1"), shot("/", "desktop", 2, "d"), shot("/", "mobile", 2, "m2")];
    assert.equal(comparePages(images, 2)[0].changed, true);
  });

  it("treats a new page as changed, and never calls an undigested snapshot changed", () => {
    const added = comparePages([...both("/", 1, "h"), ...both("/", 2, "h"), ...both("/pricing", 2, "p")], 2);
    assert.equal(added.find((change) => change.route === "/pricing")?.changed, true);
    assert.equal(added.find((change) => change.route === "/pricing")?.before, undefined);
    const old = comparePages([shot("/", "desktop", 1), shot("/", "mobile", 1), shot("/", "desktop", 2), shot("/", "mobile", 2)], 2);
    assert.equal(old[0].changed, false);
  });
});

describe("pins and notes", () => {
  it("turns a click into a percent of the snapshot, clamped to its edges", () => {
    const box = { left: 100, top: 50, width: 400, height: 2000 };
    assert.deepEqual(pinFromPoint(box, 300, 550), { x: 50, y: 25 });
    assert.deepEqual(pinFromPoint(box, 90, 5000), { x: 0, y: 100 });
    assert.deepEqual(pinFromPoint({ ...box, width: 0 }, 300, 550), { x: 0, y: 25 });
  });

  it("keeps only notes with words, trimmed, and counts them", () => {
    const note = (id: string, text: string): PageNote => ({ id, text, viewport: "desktop" });
    const written = writtenNotes({ "/": [note("a", "  Bigger headline "), note("b", "   ")], "/about": [note("c", "")] });
    assert.deepEqual(Object.keys(written), ["/"]);
    assert.equal(written["/"][0].text, "Bigger headline");
    assert.equal(noteTotal(written), 1);
  });
});

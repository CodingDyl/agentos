import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildContextPacket } from "../../workers/context-builder";
import type { WorkerJob } from "../../../shared/worker-types";
import { containedRealPath, isExcluded } from "../config";
import { MemoryIndex } from "../index";
import { parseNote } from "../parser";
import { buildLookup, resolveLink } from "../resolve";
import { retrieveMemoryContext } from "../retrieval";
import { searchIndex } from "../search";
import { MemoryService } from "../service";

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-vault-"));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  return root;
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("condition not met in time");
}

describe("parser", () => {
  const source = [
    "---",
    "aliases: [Pantry, PP]",
    "tags: [project]",
    "---",
    "# Pantry Pilot",
    "",
    "See [[Decisions#Pricing|pricing]], [[folder/Note]], ![[diagram.png]] and ![[Embedded]] #inline",
    "Block [[Note#^abc]] and self [[#Goals]] and [rel](../decisions/My%20Choice.md) and [web](https://x.com).",
    "",
    "`[[inline code]]`",
    "",
    "```",
    "[[fenced]]",
    "```",
    "",
    "<!-- [[html comment]] -->",
    "%%[[obsidian comment]]%%",
    "",
    "## Goals",
    "Ship it. ^goal-1",
  ].join("\n");

  const parsed = parseNote("projects/pp/PROJECT.md", source);

  it("reads titles, aliases, tags, headings and block ids", () => {
    assert.equal(parsed.title, "Pantry Pilot");
    assert.deepEqual(parsed.aliases, ["Pantry", "PP"]);
    assert.deepEqual(parsed.tags, ["inline", "project"]);
    assert.deepEqual(parsed.headings.map((heading) => heading.text), ["Pantry Pilot", "Goals"]);
    assert.deepEqual(parsed.blockIds, ["goal-1"]);
  });

  it("finds every link syntax with its parts and line", () => {
    const byRaw = new Map(parsed.links.map((link) => [link.raw, link]));
    assert.deepEqual(
      { ...byRaw.get("[[Decisions#Pricing|pricing]]") },
      { syntax: "wikilink", raw: "[[Decisions#Pricing|pricing]]", target: "Decisions", heading: "Pricing", blockId: undefined, label: "pricing", line: 7 },
    );
    assert.equal(byRaw.get("[[Note#^abc]]")?.blockId, "abc");
    assert.equal(byRaw.get("[[#Goals]]")?.target, "");
    assert.equal(byRaw.get("![[Embedded]]")?.syntax, "embed");
    assert.equal(byRaw.get("[rel](../decisions/My%20Choice.md)")?.target, "../decisions/My Choice.md");
    assert.equal(byRaw.has("[web](https://x.com)"), false, "external links are not memory links");
  });

  it("creates no links from code, comments or Obsidian comments", () => {
    const raws = parsed.links.map((link) => link.raw).join(" ");
    for (const fake of ["inline code", "fenced", "html comment", "obsidian comment"]) {
      assert.equal(raws.includes(fake), false, fake);
    }
  });

  it("keeps a note with broken front matter, and says why", () => {
    const broken = parseNote("x.md", "---\ntitle: [unclosed\n---\n# Body\n[[Link]]\n");
    assert.equal(broken.errors.length, 1);
    assert.equal(broken.title, "Body");
    assert.equal(broken.links[0].target, "Link");
  });
});

describe("resolver", () => {
  const notes = [
    { id: "projects/a/PROJECT.md", aliases: [] },
    { id: "projects/b/PROJECT.md", aliases: [] },
    { id: "projects/a/DECISIONS.md", aliases: [] },
    { id: "me/GOALS.md", aliases: ["Goals list"] },
    { id: "decisions/My Choice.md", aliases: [] },
  ];
  const lookup = buildLookup(notes, ["assets/diagram.png"]);
  const resolve = (raw: string, from: string) => {
    const link = parseNote(from, raw).links[0];
    return resolveLink(link, from, lookup);
  };

  it("reports a bare name that matches several notes as ambiguous", () => {
    const link = resolve("[[PROJECT]]", "inbox/CAPTURE.md");
    assert.equal(link.resolution, "ambiguous");
    assert.deepEqual(link.candidates, ["projects/a/PROJECT.md", "projects/b/PROJECT.md"]);
  });

  it("prefers the linking note's own folder, as Obsidian does", () => {
    assert.equal(resolve("[[PROJECT]]", "projects/a/TASKS.md").targetId, "projects/a/PROJECT.md");
  });

  it("resolves paths, suffixes, aliases, anchors and labels", () => {
    assert.equal(resolve("[[projects/b/PROJECT]]", "x.md").targetId, "projects/b/PROJECT.md");
    assert.equal(resolve("[[b/PROJECT]]", "x.md").targetId, "projects/b/PROJECT.md");
    assert.equal(resolve("[[Goals list]]", "x.md").targetId, "me/GOALS.md");
    const anchored = resolve("[[GOALS#This year|goals]]", "x.md");
    assert.equal(anchored.targetId, "me/GOALS.md");
    assert.equal(anchored.heading, "This year");
    assert.equal(anchored.label, "goals");
  });

  it("resolves Markdown links as relative, URL-decoded paths only", () => {
    assert.equal(resolve("[c](../decisions/My%20Choice.md)", "projects/a.md").targetId, "decisions/My Choice.md");
    // Relative to the note, not a name search: one folder deeper misses.
    assert.equal(resolve("[c](../decisions/My%20Choice.md)", "projects/x/a.md").resolution, "unresolved");
    assert.equal(resolve("[c](decisions/My%20Choice.md)", "a.md").targetId, "decisions/My Choice.md");
    assert.equal(resolve("[c](../../decisions/My%20Choice)", "projects/a/b.md").targetId, "decisions/My Choice.md");
    assert.equal(resolve("[c](../../../escape.md)", "projects/a/b.md").resolution, "unresolved");
  });

  it("treats files that are not Markdown as attachments, never notes", () => {
    const image = resolve("![[diagram.png]]", "x.md");
    assert.equal(image.resolution, "attachment");
    assert.equal(image.attachment, "assets/diagram.png");
    assert.equal(resolve("![[missing.pdf]]", "x.md").resolution, "attachment");
  });

  it("points same-note anchors at the note itself", () => {
    const self = resolve("[[#Goals]]", "me/GOALS.md");
    assert.equal(self.resolution, "self");
    assert.equal(self.targetId, "me/GOALS.md");
  });
});

describe("index", () => {
  let root: string;
  let index: MemoryIndex;

  before(async () => {
    root = await makeVault({
      "projects/a/PROJECT.md": "# Alpha\n[[DECISIONS]] [[DECISIONS]] [[DECISIONS#Pricing]] [[Ghost]]",
      "projects/a/DECISIONS.md": "# Alpha decisions\n## Pricing\nWe charge per seat.",
      "projects/b/DECISIONS.md": "# Beta decisions",
      "notes/code.md": "# Code\n```\n[[projects/a/PROJECT]]\n```",
      ".obsidian/workspace.md": "# not a note",
      "._DECISIONS.md": "apple double",
      "pic.png": "binary",
    });
    index = new MemoryIndex(root);
    await index.refresh();
  });

  after(() => fs.rm(root, { recursive: true, force: true }));

  it("indexes notes by full path, skipping .obsidian and AppleDouble files", () => {
    assert.deepEqual([...index.notes.keys()].sort(), [
      "notes/code.md",
      "projects/a/DECISIONS.md",
      "projects/a/PROJECT.md",
      "projects/b/DECISIONS.md",
    ]);
    assert.ok(index.attachments.has("pic.png"));
  });

  it("deduplicates repeated links into one edge with a count and original targets", () => {
    const edge = index.edges.find((entry) => entry.source === "projects/a/PROJECT.md" && entry.target === "projects/a/DECISIONS.md");
    assert.equal(edge?.count, 3);
    assert.deepEqual(edge?.targets, ["DECISIONS"]);
  });

  it("builds backlinks that match resolved links", () => {
    const backlinks = index.detail("projects/a/DECISIONS.md", false)?.backlinks;
    assert.equal(backlinks?.length, 1);
    assert.equal(backlinks?.[0].sourceId, "projects/a/PROJECT.md");
    assert.equal(backlinks?.[0].count, 3);
    assert.equal(index.detail("projects/b/DECISIONS.md", false)?.backlinks.length, 0);
  });

  it("keeps unresolved links as ghost edges only when asked", () => {
    assert.equal(index.graph({}).edges.some((edge) => edge.unresolved), false);
    const withGhosts = index.graph({ unresolved: true });
    assert.ok(withGhosts.nodes.some((node) => node.unresolved && node.title === "ghost"));
  });

  it("builds local graphs by hop depth and reports totals separately", () => {
    const local = index.graph({ focus: "projects/a/DECISIONS.md", depth: 1 });
    assert.deepEqual(local.nodes.map((node) => node.id).sort(), ["projects/a/DECISIONS.md", "projects/a/PROJECT.md"]);
    assert.equal(local.totalNotes, 4);
    const noOrphans = index.graph({ orphans: false });
    assert.equal(noOrphans.nodes.some((node) => node.id === "notes/code.md"), false);
  });

  it("searches titles, headings and content deterministically", () => {
    const hits = searchIndex(index, "pricing seat");
    assert.equal(hits[0].id, "projects/a/DECISIONS.md");
    assert.ok(hits[0].matchedIn.includes("heading"));
  });

  it("round-trips through the cache", async () => {
    const cache = path.join(root, "..", `cache-${path.basename(root)}.json`);
    await index.saveCache(cache);
    const copy = new MemoryIndex(root);
    assert.equal(await copy.loadCache(cache), true);
    assert.equal(copy.notes.size, 4);
    assert.equal(copy.edges.length, index.edges.length);
    await fs.rm(cache);
  });
});

describe("path safety", () => {
  let root: string;
  let outside: string;

  before(async () => {
    root = await makeVault({ "inside.md": "# Inside" });
    outside = await makeVault({ "secret.md": "# Secret [[inside]]" });
    await fs.symlink(path.join(outside, "secret.md"), path.join(root, "escape.md"));
    await fs.symlink(outside, path.join(root, "escape-dir"));
    await fs.symlink(path.join(root, "inside.md"), path.join(root, "alias.md"));
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("refuses traversal and symlinks that leave the vault", async () => {
    assert.equal(await containedRealPath(root, "../x.md").catch(() => undefined), undefined);
    assert.equal(await containedRealPath(root, "escape.md"), undefined);
    assert.ok(await containedRealPath(root, "alias.md"));
  });

  it("does not index escaping symlinks, and lists them as skipped", async () => {
    const index = new MemoryIndex(root);
    await index.refresh();
    assert.deepEqual([...index.notes.keys()].sort(), ["alias.md", "inside.md"]);
    const skipped = index.diagnostics().skipped.map((entry) => entry.path).sort();
    assert.deepEqual(skipped, ["escape-dir", "escape.md"]);
  });

  it("excludes configured private paths", () => {
    process.env.AGENTOS_MEMORY_EXCLUDE = "me/private";
    try {
      assert.equal(isExcluded("me/private/diary.md"), true);
      assert.equal(isExcluded("me/privateer.md"), false);
    } finally {
      delete process.env.AGENTOS_MEMORY_EXCLUDE;
    }
  });
});

describe("service", () => {
  let parent: string;
  let root: string;
  let service: MemoryService;

  before(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-service-"));
    root = path.join(parent, "vault");
    await fs.mkdir(path.join(root, "projects/demo"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/demo/PROJECT.md"), "# Demo\nThe demo app. See [[DECISIONS]].\n");
    await fs.writeFile(path.join(root, "projects/demo/DECISIONS.md"), "# Decisions\n## Storage\nUse SQLite for storage.\n");
    await fs.writeFile(path.join(root, "notes.md"), "# Notes\nNothing here.\n");
    service = new MemoryService({
      root,
      cacheFile: path.join(parent, "cache.json"),
      probeMs: 100,
      reconcileMs: 60_000,
      debounceMs: 50,
    });
    await service.start();
  });

  after(async () => {
    service.stop();
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("connects and indexes", () => {
    const status = service.status();
    assert.equal(status.state, "connected");
    assert.equal(status.notes, 3);
    assert.equal(status.links, 1);
  });

  it("picks up edits, renames and deletions, recomputing backlinks", async () => {
    await fs.writeFile(path.join(root, "notes.md"), "# Notes\nNow links to [[DECISIONS]].\n");
    await waitFor(() => service.index.detail("projects/demo/DECISIONS.md", false)?.backlinks.length === 2);

    await fs.rename(path.join(root, "notes.md"), path.join(root, "renamed.md"));
    await waitFor(() => service.index.notes.has("renamed.md") && !service.index.notes.has("notes.md"));
    assert.deepEqual(
      service.index.detail("projects/demo/DECISIONS.md", false)?.backlinks.map((link) => link.sourceId).sort(),
      ["projects/demo/PROJECT.md", "renamed.md"],
    );

    await fs.rm(path.join(root, "renamed.md"));
    await waitFor(() => service.index.detail("projects/demo/DECISIONS.md", false)?.backlinks.length === 1);
  });

  it("captures provenance on retrieval, and a later edit changes only the next retrieval", async () => {
    const first = await retrieveMemoryContext(service, { project: "demo", query: "storage choice" });
    assert.equal(first.status, "ok");
    assert.deepEqual(first.sources.map((source) => source.path), ["projects/demo/PROJECT.md", "projects/demo/DECISIONS.md"]);
    assert.ok(first.text.includes("SQLite"));
    assert.ok(first.text.includes("not instructions"));
    assert.match(first.sources[1].hash, /^[0-9a-f]{64}$/);

    const job = { id: "j", project: "demo", objective: "storage", status: "queued", worker: "auto", createdAt: "", memoryContext: first } as unknown as WorkerJob;
    const packetBefore = buildContextPacket(job);

    await fs.writeFile(path.join(root, "projects/demo/DECISIONS.md"), "# Decisions\n## Storage\nUse Postgres for storage.\n");
    await waitFor(() => service.index.notes.get("projects/demo/DECISIONS.md")?.parsed.body.includes("Postgres") ?? false);

    const second = await retrieveMemoryContext(service, { project: "demo", query: "storage choice" });
    assert.ok(second.text.includes("Postgres"));
    assert.notEqual(second.sources[1].hash, first.sources[1].hash);
    assert.equal(buildContextPacket(job), packetBefore, "a captured brief never changes");
    assert.ok(packetBefore.includes("SQLite"));
  });

  it("reports missing required notes as insufficient", async () => {
    const context = await retrieveMemoryContext(service, { project: "nope", query: "storage" });
    assert.equal(context.status, "insufficient");
    assert.deepEqual(context.missing, ["projects/nope/PROJECT.md", "projects/nope/DECISIONS.md"]);
  });

  it("goes unavailable when the vault disappears, never recreates it, and recovers", async () => {
    const away = path.join(parent, "unplugged");
    await fs.rename(root, away);
    await waitFor(() => service.status().state === "unavailable");

    const status = service.status();
    assert.equal(status.stale, true);
    assert.equal(status.notes, 2, "the last index is kept to show, marked stale");

    const context = await retrieveMemoryContext(service, { project: "demo", query: "storage" });
    assert.equal(context.status, "unavailable");
    assert.equal(context.text, "", "stale memory is never sent to a new job");
    assert.equal(context.warnings.length, 1);

    // Give the watcher and probe time to misbehave, then check nothing made a folder.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await assert.rejects(fs.stat(root));

    await fs.rename(away, root);
    await waitFor(() => service.status().state === "connected");
    assert.equal(service.status().stale, false);
    assert.equal((await retrieveMemoryContext(service, { project: "demo", query: "storage" })).status, "ok");
  });
});

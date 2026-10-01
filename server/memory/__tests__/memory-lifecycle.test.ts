import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { noteRevision } from "../../../shared/memory-types";
import { createMemoryNote } from "../create-note";
import { rankDuplicates, type DuplicatePoolEntry } from "../duplicate-detection";
import { patchFrontmatter, replaceBody } from "../frontmatter";
import { readHistory } from "../history";
import {
  archiveMemoryNote,
  editMemoryNote,
  MemoryMutationError,
  restoreMemoryNote,
  undoMemoryChange,
  updateMemoryFromProposal,
} from "../mutations";
import { parseCloseoutLines, proposalNoise } from "../proposals";
import { retrieveMemoryContext } from "../retrieval";
import { MemoryService } from "../service";

describe("front matter patching", () => {
  it("changes only the keys it owns and leaves the rest byte for byte", () => {
    const source = "---\n# a comment\ntags: [a, b]\naliases:\n  - One\n  - Two\ntype: fact\n---\n# Title\n\nBody\n";
    const next = patchFrontmatter(source, { type: "pattern", updatedBy: "human" });
    assert.equal(next, "---\n# a comment\ntags: [a, b]\naliases:\n  - One\n  - Two\ntype: \"pattern\"\nupdatedBy: \"human\"\n---\n# Title\n\nBody\n");
  });

  it("removes a key with its continuation lines, and the block when it empties", () => {
    const source = "---\narchived: true\nlist:\n  - x\n---\nBody\n";
    assert.equal(patchFrontmatter(source, { list: null }), "---\narchived: true\n---\nBody\n");
    assert.equal(patchFrontmatter(source, { list: null, archived: null }), "Body\n");
  });

  it("adds a block to a note that has none, and quotes values that YAML would retype", () => {
    assert.equal(patchFrontmatter("# T\n", { createdAt: "2026-10-01T10:00:00.000Z", archived: true }), '---\ncreatedAt: "2026-10-01T10:00:00.000Z"\narchived: true\n---\n# T\n');
  });

  it("replaces the body and keeps the block", () => {
    assert.equal(replaceBody("---\na: 1\n---\nold\n", "# New"), "---\na: 1\n---\n# New\n");
  });
});

describe("editing memory", () => {
  let parent: string;
  let root: string;
  let service: MemoryService;
  const id = "projects/demo/memory/Recipe fallback.md";
  const original =
    '---\ntype: "pattern"\ncreatedBy: "agent:claude"\ncreatedAt: "2026-09-12T08:00:00.000Z"\nsourceTask: "PP-031"\nsourceRun: "job-1"\ncustom: keep me\n---\n# Recipe fallback\n\nWhen external lookup fails, generate internally.\n';

  const revision = () => noteRevision(service.index.notes.get(id)!.hash);

  before(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-edit-"));
    root = path.join(parent, "vault");
    await fs.mkdir(path.join(root, "projects/demo/memory"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/demo/PROJECT.md"), "# Demo\n\nA recipe app.\n");
    await fs.writeFile(path.join(root, "projects/demo/DECISIONS.md"), "# Decisions\n");
    await fs.writeFile(path.join(root, id), original);
    service = new MemoryService({ root, cacheFile: path.join(parent, "cache.json"), probeMs: 60_000, reconcileMs: 60_000 });
    await service.start();
  });

  after(async () => {
    service.stop();
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("exposes type, provenance and revision on the note", () => {
    const detail = service.index.detail(id, false)!;
    assert.equal(detail.memoryType, "pattern");
    assert.equal(detail.archived, false);
    assert.equal(detail.provenance.createdBy, "agent:claude");
    assert.equal(detail.provenance.sourceTask, "PP-031");
    assert.match(detail.revision, /^sha256:[0-9a-f]{32}$/);
  });

  it("edits body and type, keeps provenance, stamps updatedBy, re-indexes and logs", async () => {
    const result = await editMemoryNote(service, {
      id,
      expectedRevision: revision(),
      body: "# Recipe fallback\n\nWhen external lookup returns nothing suitable, use internal generation.\n",
      type: "lesson",
    });
    const written = await fs.readFile(path.join(root, id), "utf8");
    assert.match(written, /createdBy: "agent:claude"/);
    assert.match(written, /createdAt: "2026-09-12T08:00:00.000Z"/);
    assert.match(written, /sourceTask: "PP-031"/);
    assert.match(written, /custom: keep me/);
    assert.match(written, /updatedBy: "human"/);
    assert.match(written, /updatedAt: "/);
    assert.match(written, /nothing suitable/);

    const detail = service.index.detail(id, false)!;
    assert.equal(detail.memoryType, "lesson", "re-indexed before returning");
    assert.equal(detail.revision, result.revision);

    const history = await readHistory(id);
    assert.equal(history[0].action, "edit");
    assert.ok(history[0].backupId);
  });

  it("refuses an edit composed against an old revision, and leaves the file alone", async () => {
    const before = await fs.readFile(path.join(root, id), "utf8");
    await assert.rejects(
      editMemoryNote(service, { id, expectedRevision: "sha256:0000", body: "# X\n\nlost\n" }),
      (error: unknown) => error instanceof MemoryMutationError && error.status === 409 && Boolean(error.currentRevision),
    );
    assert.equal(await fs.readFile(path.join(root, id), "utf8"), before);
  });

  it("never accepts provenance from the request", async () => {
    await editMemoryNote(service, {
      id,
      expectedRevision: revision(),
      tags: ["pattern", "recipes"],
      ...({ createdBy: "someone-else" } as object),
    });
    assert.match(await fs.readFile(path.join(root, id), "utf8"), /createdBy: "agent:claude"/);
  });

  it("archives and restores, and archived memory is kept out of agent context", async () => {
    await archiveMemoryNote(service, { id, expectedRevision: revision() });
    assert.equal(service.index.detail(id, false)!.archived, true);
    assert.ok(service.index.detail(id, false)!.provenance.archivedAt);

    const context = await retrieveMemoryContext(service, { project: "demo", query: "recipe fallback external lookup generation" });
    assert.ok(!context.sources.some((source) => source.path === id), "archived note not sent");

    await restoreMemoryNote(service, { id, expectedRevision: revision() });
    const restored = service.index.detail(id, false)!;
    assert.equal(restored.archived, false);
    assert.equal(restored.provenance.archivedAt, undefined);
    assert.equal(restored.provenance.createdBy, "agent:claude");

    const again = await retrieveMemoryContext(service, { project: "demo", query: "recipe fallback external lookup generation" });
    assert.ok(again.sources.some((source) => source.path === id));
  });

  it("undoes the newest change, and the undo can itself be undone", async () => {
    const beforeEdit = await fs.readFile(path.join(root, id), "utf8");
    await editMemoryNote(service, { id, expectedRevision: revision(), body: "# Recipe fallback\n\nA mistake.\n" });
    const [latest] = await readHistory(id);

    await undoMemoryChange(service, { id, historyId: latest.id });
    assert.equal(await fs.readFile(path.join(root, id), "utf8"), beforeEdit);

    const history = await readHistory(id);
    assert.equal(history[0].action, "undo");
    assert.ok(history.find((entry) => entry.id === latest.id)?.undoneAt);

    await assert.rejects(undoMemoryChange(service, { id, historyId: latest.id }), (error: unknown) => error instanceof MemoryMutationError && error.status === 409);
  });

  it("refuses to undo over a change made outside AgentOS", async () => {
    await editMemoryNote(service, { id, expectedRevision: revision(), body: "# Recipe fallback\n\nEdited here.\n" });
    const [latest] = await readHistory(id);
    const outside = (await fs.readFile(path.join(root, id), "utf8")) + "\nAdded in Obsidian.\n";
    await fs.writeFile(path.join(root, id), outside);
    await service.reindex(new Set([id]));

    await assert.rejects(undoMemoryChange(service, { id, historyId: latest.id }), (error: unknown) => error instanceof MemoryMutationError && error.status === 409);
    assert.equal(await fs.readFile(path.join(root, id), "utf8"), outside);
  });

  it("updates from a proposal without losing the original source", async () => {
    await updateMemoryFromProposal(service, {
      id,
      expectedRevision: revision(),
      title: "Recipe fallback handling",
      body: "Use internal generation when lookup fails.",
      type: "pattern",
      sourceTask: "PP-040",
    });
    const written = await fs.readFile(path.join(root, id), "utf8");
    assert.match(written, /sourceTask: "PP-031"/);
    assert.match(written, /lastSourceTask: "PP-040"/);
    assert.match(written, /^# Recipe fallback$/m, "the note keeps its title");
    assert.match(written, /Edited here\./, "and its text");
    assert.match(written, /## Update from PP-040 \(\d{4}-\d{2}-\d{2}\)\n\n\*\*Recipe fallback handling\*\* — Use internal generation when lookup fails\./);
  });

  it("records provenance and type on a note a proposal creates", async () => {
    const created = await createMemoryNote(
      service,
      { folder: "projects/demo/memory", title: "MealDB response lesson", body: "MealDB returns null meals, not an empty list.", type: "lesson", tags: ["lesson"] },
      { createdBy: "agent:claude", sourceProject: "demo", sourceTask: "PP-031", sourceRun: "job-1", approvedBy: "human" },
    );
    const detail = service.index.detail(created.id, false)!;
    assert.equal(detail.memoryType, "lesson");
    assert.equal(detail.provenance.createdBy, "agent:claude");
    assert.equal(detail.provenance.approvedBy, "human");
    assert.ok(detail.provenance.createdAt);
    assert.equal((await readHistory(created.id))[0].action, "create");
  });

  it("refuses notes outside the index and unknown types", async () => {
    await assert.rejects(editMemoryNote(service, { id: "../escape.md", expectedRevision: "sha256:x", body: "x" }), MemoryMutationError);
    await assert.rejects(
      editMemoryNote(service, { id, expectedRevision: revision(), type: "gossip" as never }),
      (error: unknown) => error instanceof MemoryMutationError && error.status === 400,
    );
  });
});

describe("duplicate detection", () => {
  const pool: DuplicatePoolEntry[] = [
    { id: "projects/a/memory/Recipe fallback handling.md", title: "Recipe fallback handling", body: "When external lookup returns no suitable recipe, use internal generation.", kind: "note", revision: "r1", archived: false, createdAt: "2026-09-12" },
    { id: "projects/a/memory/Loading states.md", title: "Loading states", body: "Skeletons for every list over 200ms.", kind: "note", revision: "r2", archived: false },
  ];

  it("surfaces a likely repeat and ignores unrelated memory", () => {
    const matches = rankDuplicates({ title: "Recipe fallback pattern", body: "Fall back to internal generation when the recipe lookup fails." }, pool);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, pool[0].id);
    assert.equal(matches[0].createdAt, "2026-09-12");
    assert.deepEqual(rankDuplicates({ title: "MealDB null meals", body: "The API returns null rather than an empty array." }, pool), []);
  });

  it("is deterministic", () => {
    const candidate = { title: "Recipe fallback", body: "internal generation" };
    assert.deepEqual(rankDuplicates(candidate, pool), rankDuplicates(candidate, [...pool].reverse()));
  });
});

describe("memory proposals from a worker's summary", () => {
  it("reads Remember and Status lines and strips them from the summary", () => {
    const parsed = parseCloseoutLines(
      [
        "Chef now falls back to internal generation when external lookup fails.",
        "Artifact: artifacts/notes.md - Implementation Notes (notes)",
        "Remember: pattern | Recipe fallback handling | When external lookup returns no suitable recipe, use the internal generation fallback.",
        "Remember: lesson | MealDB response | MealDB returns `meals: null` rather than an empty array when nothing matches.",
        "Status update: Chef fallback is complete and validated. Next focus is performance and loading UX.",
      ].join("\n"),
    );
    assert.equal(parsed.summary, "Chef now falls back to internal generation when external lookup fails.");
    assert.deepEqual(parsed.proposals.map((proposal) => [proposal.type, proposal.title]), [
      ["pattern", "Recipe fallback handling"],
      ["lesson", "MealDB response"],
    ]);
    assert.match(parsed.statusUpdate ?? "", /Next focus is performance/);
  });

  it("keeps routine detail and temporary debugging out", () => {
    const parsed = parseCloseoutLines(
      [
        "Remember: lesson | Debug output | Added console.log to the fetch handler to trace the failure.",
        "Remember: fact | Workaround | We skip the cache for now until the bug is fixed upstream.",
        "Remember: pattern | Typo | Fixed a typo in the header component title text.",
        "Remember: gossip | Not a type | Something something something.",
        "Remember: pattern | Short | Too short.",
      ].join("\n"),
    );
    assert.equal(parsed.proposals.length, 0);
    assert.equal(parsed.rejected.length, 5);
    assert.equal(proposalNoise({ type: "constraint", title: "Supabase row limit", body: "Free tier caps the database at 500 MB; archive old sessions." }), undefined);
  });
});

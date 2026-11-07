import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { retrieveMemoryContext } from "../retrieval";
import { MemoryService } from "../service";

describe("archived memory in agent context", () => {
  let parent: string;
  let service: MemoryService;
  const query = "zebra migration checklist sunset procedure";

  before(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-archive-"));
    const root = path.join(parent, "vault");
    await fs.mkdir(path.join(root, "projects/demo"), { recursive: true });
    await fs.mkdir(path.join(root, "archive/logs"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/demo/PROJECT.md"), "# Demo\n\nA recipe app.\n");
    await fs.writeFile(path.join(root, "projects/demo/DECISIONS.md"), "# Decisions\n");
    await fs.writeFile(path.join(root, "archive/logs/old.md"), "# Zebra migration checklist\n\nThe zebra migration checklist and sunset procedure, long retired.\n");
    service = new MemoryService({ root, cacheFile: path.join(parent, "cache.json"), probeMs: 60_000, reconcileMs: 60_000 });
    await service.start();
  });

  after(async () => {
    service.stop();
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("is not returned by default, even when it matches the query", async () => {
    const context = await retrieveMemoryContext(service, { project: "demo", query });
    assert.ok(!context.sources.some((source) => source.path.startsWith("archive/")));
  });

  it("is returned when asked for with includeArchive", async () => {
    const context = await retrieveMemoryContext(service, { project: "demo", query, includeArchive: true });
    assert.ok(context.sources.some((source) => source.path === "archive/logs/old.md"));
  });
});

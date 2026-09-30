import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { assertVaultRootPresent, writeAgentOSFile } from "../../agentos/filesystem";
import { writeBenchmarkVault } from "../benchmark-fixture";
import { MemoryIndex } from "../index";
import { searchIndex } from "../search";

describe("memory at 1,000 notes and 3,000 links", () => {
  let root: string;
  after(() => fs.rm(root, { recursive: true, force: true }));

  it("indexes, re-scans, builds the graph and searches within budget", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-bench-"));
    await writeBenchmarkVault(root, 1_000, 3_000);

    const index = new MemoryIndex(root);
    let started = performance.now();
    await index.refresh();
    const cold = performance.now() - started;

    started = performance.now();
    await index.refresh();
    const warm = performance.now() - started;

    started = performance.now();
    const graph = index.graph({ orphans: true });
    const graphMs = performance.now() - started;

    started = performance.now();
    searchIndex(index, "topic 5 links");
    const searchMs = performance.now() - started;

    console.log(
      `[bench] cold index ${cold.toFixed(0)}ms · warm rescan ${warm.toFixed(0)}ms · graph ${graphMs.toFixed(0)}ms (${graph.nodes.length} nodes, ${graph.edges.length} edges) · search ${searchMs.toFixed(0)}ms`,
    );

    assert.equal(index.notes.size, 1_000);
    assert.ok(graph.edges.length >= 2_900, `edges: ${graph.edges.length}`);
    assert.equal(graph.capped, undefined, "no cap at this size");
    // Generous ceilings: a regression, not a stopwatch.
    assert.ok(cold < 5_000 && warm < 1_000 && graphMs < 500 && searchMs < 500);
  });
});

describe("writes to a missing vault", () => {
  it("are refused rather than recreating the vault folder", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "vault-gone-"));
    const previous = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = path.join(parent, "unplugged");
    try {
      await assert.rejects(assertVaultRootPresent(), /not available/);
      await assert.rejects(writeAgentOSFile("inbox/CAPTURE.md", "x"), /not available/);
      await assert.rejects(fs.stat(path.join(parent, "unplugged")));
    } finally {
      if (previous === undefined) delete process.env.AGENTOS_ROOT;
      else process.env.AGENTOS_ROOT = previous;
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});

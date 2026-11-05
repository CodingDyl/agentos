import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";
import { parseGraph, type StructureIndex } from "../graph";
import { excludeOutputFromGit, rebuildEnvironment, StructureRebuilds } from "../rebuild";
import { clearStructureCache, loadStructureGraph, resolveStructureFolder } from "../store";

const run = promisify(execFile);
const roots: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agentos-structure-")));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** The real shape `graphify update` writes (schema 1), reduced to what matters. */
function sampleGraph(overrides: Record<string, unknown> = {}) {
  const node = (id: string, community: number, name: string, file: string, extra: object = {}) => ({
    id,
    label: id,
    community,
    community_name: name,
    file_type: "code",
    source_file: file,
    source_location: "L1",
    ...extra,
  });
  return {
    directed: false,
    graph: { schema_version: 1, graphify_version: "0.9.102" },
    built_at_commit: "abc123",
    nodes: [
      node("jobs", 0, "job-manager.ts", "server/workers/job-manager.ts"),
      node("run", 0, "job-manager.ts", "server/workers/job-manager.ts"),
      node("queue", 0, "job-manager.ts", "server/workers/queue.ts"),
      node("page", 1, "ref_react", "src/features/jobs/page.tsx"),
      node("list", 1, "ref_react", "src/features/jobs/list.tsx"),
      node("hook", 1, "ref_react", "src/features/jobs/hook.ts"),
      node("react", 1, "ref_react", "react", { type: "external" }),
      node("readme", 2, "README.md", "README.md", { file_type: "document" }),
      node("guide", 2, "README.md", "docs/guide.md", { file_type: "document" }),
      node("pkg-a", 3, "package.json", "package.json"),
      node("pkg-b", 3, "package.json", "package.json"),
      { id: 42, label: "malformed row" },
    ],
    links: [
      { source: "page", target: "run", relation: "calls", confidence: "EXTRACTED", source_file: "src/features/jobs/page.tsx", source_location: "L9" },
      { source: "list", target: "run", relation: "calls", confidence: "INFERRED" },
      { source: "hook", target: "jobs", relation: "imports", confidence: "EXTRACTED" },
      { source: "jobs", target: "run", relation: "contains", confidence: "EXTRACTED" },
      { source: "page", target: "react", relation: "imports", confidence: "EXTRACTED" },
      { source: "page", target: "gone", relation: "calls", confidence: "EXTRACTED" },
      { source: "readme", target: "queue", relation: "references", confidence: "EXTRACTED" },
    ],
    ...overrides,
  };
}

function index(overrides: Record<string, unknown> = {}): StructureIndex {
  const parsed = parseGraph(JSON.stringify(sampleGraph(overrides)));
  assert.ok(parsed.ok);
  return parsed.index;
}

const overviewOf = (graph: StructureIndex) => graph.overview({ builtAt: "2026-11-05T12:00:00.000Z", headCommit: "abc123" });

describe("reading graph.json", () => {
  it("explains a file it cannot use instead of throwing", () => {
    const garbage = parseGraph("{ not json");
    assert.equal(garbage.ok, false);
    assert.equal(!garbage.ok && garbage.reason, "unreadable");

    const shape = parseGraph(JSON.stringify({ nodes: "nope" }));
    assert.equal(!shape.ok && shape.reason, "unreadable");
  });

  it("refuses a format it does not know rather than guessing", () => {
    const future = parseGraph(JSON.stringify(sampleGraph({ graph: { schema_version: 2 } })));
    assert.equal(!future.ok && future.reason, "unsupported");
    assert.match(!future.ok ? future.problem : "", /format 2/);
  });

  it("drops a malformed row and a link to a missing node, and keeps the rest", () => {
    const overview = overviewOf(index());
    assert.equal(overview.counts.components, 11);
    assert.equal(overview.counts.links, 6);
    assert.equal(overview.counts.inferredLinks, 1);
  });
});

describe("the overview", () => {
  it("groups components into named subsystems with their home folder", () => {
    const jobs = overviewOf(index()).subsystems.find((entry) => entry.id === 0);
    assert.equal(jobs?.name, "job-manager.ts");
    assert.equal(jobs?.folder, "server/workers");
    assert.equal(jobs?.area, "server");
    assert.equal(jobs?.size, 3);
    assert.equal(jobs?.fileCount, 2);
  });

  it("replaces a name that is only a reference with where the subsystem lives", () => {
    assert.equal(overviewOf(index()).subsystems.find((entry) => entry.id === 1)?.name, "src/features/jobs");
  });

  it("does the same for a name that is only an outside package", () => {
    const graph = sampleGraph();
    const renamed = graph.nodes
      .filter((row) => row.id !== "react")
      .map((row) => ("community" in row && row.community === 1 ? { ...row, community_name: "react" } : row));
    // As the real file has it: a dependency from package.json, with no `external` flag.
    const dependency = { id: "ref_react", label: "react", community: 1, community_name: "react", file_type: "concept", source_file: "package.json" };
    const parsed = parseGraph(JSON.stringify({ ...graph, nodes: [...renamed, dependency] }));
    assert.ok(parsed.ok);
    assert.equal(overviewOf(parsed.index).subsystems.find((entry) => entry.id === 1)?.name, "src/features/jobs");
  });

  it("puts code on the map and leaves docs and config in the list", () => {
    const { subsystems } = overviewOf(index());
    assert.equal(subsystems.find((entry) => entry.id === 2)?.kind, "docs");
    assert.equal(subsystems.find((entry) => entry.id === 2)?.onMap, false);
    assert.equal(subsystems.find((entry) => entry.id === 3)?.kind, "config");
    assert.equal(subsystems.find((entry) => entry.id === 3)?.onMap, false);
    assert.equal(subsystems.find((entry) => entry.id === 0)?.onMap, true);
  });

  it("links subsystems by interaction, with containment left out", () => {
    const { links } = overviewOf(index());
    assert.equal(links.length, 1);
    assert.deepEqual(links[0], { source: 0, target: 1, weight: 3, relation: "calls" });
  });

  it("ranks hubs without external packages or containment", () => {
    const { hubs } = overviewOf(index());
    assert.deepEqual(hubs.slice(0, 2).map((hub) => hub.id), ["page", "run"]);
    assert.equal(hubs.find((hub) => hub.id === "run")?.degree, 2);
    assert.ok(!hubs.some((hub) => hub.id === "react"));
  });

  it("calls a graph stale only when the repository has moved on", () => {
    assert.equal(overviewOf(index()).stale, false);
    assert.equal(index().overview({ builtAt: "x", headCommit: "def456" }).stale, true);
    assert.equal(index().overview({ builtAt: "x" }).stale, false);
  });
});

describe("drilling in", () => {
  it("returns a subsystem's members, its links and who it talks to", () => {
    const detail = index().subsystem(0);
    assert.ok(detail);
    assert.equal(detail.members[0].id, "run");
    assert.deepEqual(detail.links, [{ source: "jobs", target: "run", relation: "contains", inferred: false }]);
    assert.equal(detail.connections[0].subsystem.id, 1);
    assert.equal(detail.connections[0].incoming, 3);
    assert.equal(detail.connections[0].outgoing, 0);
    assert.equal(detail.files[0].path, "server/workers/job-manager.ts");
    assert.equal(index().subsystem(999), undefined);
  });

  it("keeps edge direction and says what was inferred", () => {
    const detail = index().node("run");
    assert.ok(detail);
    assert.equal(detail.totalConnections, 3);
    const inferred = detail.connections.find((connection) => connection.other.id === "list");
    assert.equal(inferred?.direction, "in");
    assert.equal(inferred?.inferred, true);
    const read = detail.connections.find((connection) => connection.other.id === "page");
    assert.equal(read?.relation, "calls");
    assert.equal(read?.inferred, false);
    assert.equal(read?.file, "src/features/jobs/page.tsx");
    assert.equal(read?.location, "L9");
    assert.equal(index().node("missing"), undefined);
  });

  it("searches labels first, then file paths", () => {
    const graph = index();
    assert.equal(graph.search("run")[0].id, "run");
    assert.deepEqual(graph.search("queue.ts").map((node) => node.id), ["queue"]);
    assert.deepEqual(graph.search("   "), []);
    assert.deepEqual(graph.search("nothing-matches"), []);
  });
});

describe("the repository on disk", () => {
  it("explains a link that points nowhere", async () => {
    const missing = await resolveStructureFolder("demo", path.join(os.tmpdir(), "agentos-structure-not-here"));
    assert.ok("status" in missing);
    assert.equal(missing.status, "missing-folder");
  });

  it("refuses to map the home folder or the disk", async () => {
    for (const broad of [os.homedir(), "/"]) {
      const resolved = await resolveStructureFolder("demo", broad);
      assert.ok("status" in resolved);
      assert.match(resolved.problem, /too broad/);
    }
  });

  it("reads the graph, reports an unmapped repository and notices a new build", async () => {
    clearStructureCache();
    const folder = await tempDir();
    assert.equal((await loadStructureGraph(folder)).status, "empty");

    await fs.mkdir(path.join(folder, "graphify-out"));
    const file = path.join(folder, "graphify-out", "graph.json");
    await fs.writeFile(file, JSON.stringify(sampleGraph()));
    const first = await loadStructureGraph(folder);
    assert.ok(first.status === "ready");
    const again = await loadStructureGraph(folder);
    assert.ok(again.status === "ready");
    assert.equal(again.index, first.index, "an unchanged file is not parsed twice");

    await fs.writeFile(file, JSON.stringify(sampleGraph({ built_at_commit: "newer-build" })));
    const second = await loadStructureGraph(folder);
    assert.ok(second.status === "ready");
    assert.equal(second.index.builtAtCommit, "newer-build");
  });

  it("will not follow a graph that points outside the repository", async () => {
    const folder = await tempDir();
    const elsewhere = await tempDir();
    await fs.writeFile(path.join(elsewhere, "graph.json"), JSON.stringify(sampleGraph()));
    await fs.symlink(elsewhere, path.join(folder, "graphify-out"));

    const loaded = await loadStructureGraph(folder);
    assert.equal(loaded.status, "unreadable");
  });
});

describe("rebuilding", () => {
  async function fakeGraphify(script: string): Promise<{ folder: string; binary: string }> {
    const bin = await tempDir();
    const folder = await tempDir();
    const binary = path.join(bin, "graphify");
    await fs.writeFile(binary, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return { folder, binary };
  }

  async function settled(rebuilds: StructureRebuilds, slug: string) {
    const deadline = Date.now() + 10_000;
    while (rebuilds.get(slug).status === "running") {
      if (Date.now() > deadline) throw new Error("the rebuild never finished");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return rebuilds.get(slug);
  }

  it("builds the environment from nothing, so no key or AI CLI is reachable", () => {
    const env = rebuildEnvironment("/opt/tools/graphify", {
      HOME: "/home/me",
      PATH: "/secret/claude/bin",
      ANTHROPIC_API_KEY: "sk-test",
      GEMINI_API_KEY: "test",
      GRAPHIFY_OUT: "/elsewhere",
    });
    assert.deepEqual(env, { PATH: "/opt/tools:/usr/bin:/bin", HOME: "/home/me" });
  });

  it("really runs `update .` in the repository without passing secrets through", async () => {
    const { folder, binary } = await fakeGraphify('printf "%s|%s|%s" "$PWD" "$*" "${ANTHROPIC_API_KEY:-none}" > ran.txt');
    const rebuilds = new StructureRebuilds();
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-must-not-leak";
    try {
      rebuilds.start("demo", { folder, binary });
      assert.deepEqual(await settled(rebuilds, "demo"), { status: "idle" });
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
    assert.equal(await fs.readFile(path.join(folder, "ran.txt"), "utf8"), `${folder}|update .|none`);
  });

  it("runs one at a time per workspace", async () => {
    const { folder, binary } = await fakeGraphify('echo run >> count.txt\nsleep 0.3');
    const rebuilds = new StructureRebuilds();
    const first = rebuilds.start("demo", { folder, binary });
    const second = rebuilds.start("demo", { folder, binary });
    assert.equal(second.startedAt, first.startedAt);
    await settled(rebuilds, "demo");
    assert.equal(await fs.readFile(path.join(folder, "count.txt"), "utf8"), "run\n");
  });

  it("offers force when Graphify refuses to shrink the graph, and passes it on", async () => {
    const { folder, binary } = await fakeGraphify(`case "$*" in *--force*) echo forced > forced.txt ;; *) echo "graph.json NOT written: refusing to overwrite"; exit 1 ;; esac`);
    const rebuilds = new StructureRebuilds();
    rebuilds.start("demo", { folder, binary });
    const refused = await settled(rebuilds, "demo");
    assert.equal(refused.status, "failed");
    assert.equal(refused.canForce, true);

    rebuilds.start("demo", { folder, binary, force: true });
    assert.equal((await settled(rebuilds, "demo")).status, "idle");
    assert.equal((await fs.readFile(path.join(folder, "forced.txt"), "utf8")).trim(), "forced");
  });

  it("reports what failed", async () => {
    const { folder, binary } = await fakeGraphify('echo "parser exploded" >&2\nexit 3');
    const rebuilds = new StructureRebuilds();
    rebuilds.start("demo", { folder, binary });
    const failed = await settled(rebuilds, "demo");
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /parser exploded/);
    assert.equal(failed.canForce, undefined);
  });

  it("stops a rebuild that runs too long", async () => {
    const { folder, binary } = await fakeGraphify("exec sleep 30");
    const rebuilds = new StructureRebuilds();
    rebuilds.start("demo", { folder, binary, timeoutMs: 100 });
    assert.match((await settled(rebuilds, "demo")).error ?? "", /ten minutes/);
  });

  it("keeps the output out of commits without touching a tracked file", async () => {
    const folder = await tempDir();
    await run("git", ["init", "-q"], { cwd: folder });
    await fs.mkdir(path.join(folder, "graphify-out"));
    await fs.writeFile(path.join(folder, "graphify-out", "graph.json"), "{}");

    await excludeOutputFromGit(folder);
    await excludeOutputFromGit(folder);

    const { stdout } = await run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: folder });
    assert.equal(stdout.trim(), "");
    const exclude = await fs.readFile(path.join(folder, ".git", "info", "exclude"), "utf8");
    assert.equal(exclude.split("\n").filter((line) => line === "graphify-out/").length, 1);
    await assert.rejects(fs.access(path.join(folder, ".gitignore")));
  });

  it("leaves a folder that is not a repository alone", async () => {
    const folder = await tempDir();
    await excludeOutputFromGit(folder);
    assert.deepEqual(await fs.readdir(folder), []);
  });
});

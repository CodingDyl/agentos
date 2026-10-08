import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { layoutGraph, parseDecoration, readGitGraph, type RawCommit } from "../git-graph";
import { findMetadataFiles, removeMetadataFiles } from "../metadata-files";

const c = (hash: string, parents: string[], subject = hash): RawCommit => ({ hash, parents, author: "a", date: "2026-01-01T00:00:00Z", subject, decoration: "" });

describe("laying out the commit graph", () => {
  it("keeps a straight history in one lane", () => {
    const { rows, lanes } = layoutGraph([c("c", ["b"]), c("b", ["a"]), c("a", [])]);
    assert.equal(lanes, 1);
    assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0]);
  });

  it("opens a second lane for a branch and closes it at the fork point", () => {
    // m merges main (b) and feature (f); both descend from a.
    const { rows, lanes } = layoutGraph([c("m", ["b", "f"]), c("f", ["a"]), c("b", ["a"]), c("a", [])]);
    assert.equal(lanes, 2);
    assert.equal(rows[0].edges.filter((edge) => edge.kind === "out").length, 2);
    assert.equal(rows[1].lane, 1);
    const last = rows[3];
    assert.equal(last.edges.filter((edge) => edge.kind === "in").length, 2);
  });

  it("draws a lane that waits as a line through the row between", () => {
    const { rows } = layoutGraph([c("m", ["b", "f"]), c("b", ["a"]), c("f", ["a"]), c("a", [])]);
    assert.ok(rows[1].edges.some((edge) => edge.kind === "through" && edge.from === 1));
  });
});

describe("naming what points at a commit", () => {
  it("sorts branches, remotes, tags and worker branches", () => {
    const refs = parseDecoration("HEAD -> main, origin/main, tag: v1, agentos-worker/job_1, feature/x");
    assert.deepEqual(refs.map((ref) => [ref.name, ref.kind, ref.current]), [
      ["main", "branch", true],
      ["origin/main", "remote", false],
      ["v1", "tag", false],
      ["agentos-worker/job_1", "worker", false],
      ["feature/x", "branch", false],
    ]);
  });
});

describe("a real repository", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-graph-"));
  sh(repo, "init", "-b", "main");
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "first");
  sh(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "b.txt"), "b");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "on feature");
  sh(repo, "checkout", "main");
  sh(repo, "branch", "agentos-worker/job_x");

  it("reads both branches and hides worker branches unless asked", async () => {
    const graph = await readGitGraph(repo);
    assert.equal(graph.commits.length, 2);
    assert.ok(graph.commits.flatMap((commit) => commit.refs).some((ref) => ref.name === "feature"));
    assert.ok(!graph.commits.flatMap((commit) => commit.refs).some((ref) => ref.kind === "worker"));
    const withWorkers = await readGitGraph(repo, { includeWorkers: true });
    assert.ok(withWorkers.commits.flatMap((commit) => commit.refs).some((ref) => ref.kind === "worker"));
  });

  it("removes only untracked ._ files, never tracked ones, and keeps git ignoring them", async () => {
    fs.writeFileSync(path.join(repo, "._a.txt"), "x");
    fs.mkdirSync(path.join(repo, "node_modules"));
    fs.writeFileSync(path.join(repo, "node_modules", "._skip"), "x");
    fs.writeFileSync(path.join(repo, "._tracked"), "mine");
    sh(repo, "add", "-f", "._tracked");
    assert.deepEqual(await findMetadataFiles(repo), ["._a.txt"]);
    assert.equal(await removeMetadataFiles(repo), 1);
    assert.ok(!fs.existsSync(path.join(repo, "._a.txt")));
    assert.ok(fs.existsSync(path.join(repo, "._tracked")));
    assert.ok(fs.existsSync(path.join(repo, "node_modules", "._skip")));
    fs.writeFileSync(path.join(repo, "._again"), "x");
    assert.ok(!sh(repo, "status", "--porcelain").toString().includes("._again"));
  });
});

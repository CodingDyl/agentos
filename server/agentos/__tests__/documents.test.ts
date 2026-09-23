import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

/**
 * Step 56: documents identify themselves with front matter, are listed from a
 * scan, are created through the writer, and are registered from a worker's
 * worktree only after the path is checked.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-repo-"));

process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const {
  describeVaultDocument,
  estimateTokens,
  getProjectDocuments,
  isInside,
  listRepoDocuments,
  readProjectDocument,
} = await import("../documents");
const {
  createDocument,
  parseArtifactDeclarations,
  registerJobArtifacts,
  toFilename,
  withFrontMatter,
} = await import("../mutations/documents");
const { readDocumentProposal } = await import("../../hermes/document-proposal");

const PROJECT_DIR = path.join(root, "projects", "pantry-pilot");

const ARTIFACT = `---
title: Chef UX Analysis
type: research
source: hermes
task: PP-024
run: run_238
created: 2026-09-21T09:42:00.000Z
---

# Chef Experience

## Current Problems

The MealDB fallback is slow.
`;

const PLAIN_DOC = `# Product Spec

Just a heading and prose. No front matter.
`;

function write(relative: string, contents: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

beforeEach(() => {
  fs.rmSync(path.join(root, "projects"), { recursive: true, force: true });
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  write("projects/PORTFOLIO.md", "# Project Portfolio\n\n## Projects\n\n### Pantry Pilot\nType: Product\nState: Active\nPriority: High\n");
  write(
    "projects/pantry-pilot/PROJECT.md",
    `# Pantry Pilot\n\n## Purpose\n\nX.\n\n## Connected Systems\n\n- Local repository: ${repo}\n`,
  );
  write("projects/pantry-pilot/artifacts/PP-024/chef-ux-analysis.md", ARTIFACT);
  write("projects/pantry-pilot/docs/PRODUCT_SPEC.md", PLAIN_DOC);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(path.join(repo, "docs", "deep", "deeper"), { recursive: true });
  fs.mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# Pantry Pilot App\n\nThe app.\n");
  fs.writeFileSync(path.join(repo, "docs", "API.md"), "---\ntitle: API Reference\n---\n\n# API\n");
  fs.writeFileSync(path.join(repo, "docs", "deep", "deeper", "NOTES.md"), "# Deep notes\n");
  fs.writeFileSync(path.join(repo, "node_modules", "pkg", "README.md"), "# Not ours\n");
  fs.writeFileSync(path.join(repo, "src.md"), "# stray\n");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("describing vault documents", () => {
  it("reads front matter, infers the task from the folder, and estimates tokens", () => {
    const artifact = describeVaultDocument({
      slug: "pantry-pilot",
      relativePath: "projects/pantry-pilot/artifacts/PP-024/chef-ux-analysis.md",
      raw: ARTIFACT,
    });

    assert.equal(artifact.id, "artifacts/PP-024/chef-ux-analysis");
    assert.equal(artifact.title, "Chef UX Analysis");
    assert.equal(artifact.type, "research");
    assert.equal(artifact.source, "hermes");
    assert.equal(artifact.taskId, "PP-024");
    assert.equal(artifact.runId, "run_238");
    assert.equal(artifact.createdAt, "2026-09-21T09:42:00.000Z");
    assert.equal(artifact.origin, "agentos");
    assert.equal(artifact.tokenEstimate, estimateTokens("# Chef Experience\n\n## Current Problems\n\nThe MealDB fallback is slow.\n".length));
  });

  it("falls back to the heading, human source and folder task when there is no front matter", () => {
    const doc = describeVaultDocument({
      slug: "pantry-pilot",
      relativePath: "projects/pantry-pilot/docs/PRODUCT_SPEC.md",
      raw: PLAIN_DOC,
    });

    assert.equal(doc.title, "Product Spec");
    assert.equal(doc.source, "human");
    assert.equal(doc.type, "notes");
    assert.equal(doc.taskId, undefined);

    const folderTask = describeVaultDocument({
      slug: "pantry-pilot",
      relativePath: "projects/pantry-pilot/artifacts/PP-031/research-summary.md",
      raw: "No heading, no matter.\n",
    });
    assert.equal(folderTask.taskId, "PP-031");
    assert.equal(folderTask.title, "Research summary");
  });

  it("survives malformed front matter", () => {
    const doc = describeVaultDocument({
      slug: "pantry-pilot",
      relativePath: "projects/pantry-pilot/docs/broken.md",
      raw: "---\ntitle: [unclosed\n---\n\n# Still a document\n",
    });
    assert.equal(doc.title, "Still a document");
  });
});

describe("listing and reading", () => {
  it("lists vault and repository documents apart, skipping node_modules and stray files", async () => {
    const documents = await getProjectDocuments("pantry-pilot");

    assert.deepEqual(
      documents.agentos.map((doc) => doc.id).sort(),
      ["artifacts/PP-024/chef-ux-analysis", "docs/PRODUCT_SPEC"],
    );
    assert.deepEqual(
      documents.repo.map((doc) => doc.relativePath).sort(),
      ["README.md", "docs/API.md", "docs/deep/deeper/NOTES.md"],
    );
    assert.equal(documents.repo.find((doc) => doc.relativePath === "docs/API.md")?.title, "API Reference");
    assert.equal(documents.repo.every((doc) => doc.origin === "repo"), true);
  });

  it("reads a vault document body without its front matter", async () => {
    const read = await readProjectDocument("pantry-pilot", "projects/pantry-pilot/artifacts/PP-024/chef-ux-analysis.md", "agentos");

    assert.ok(read);
    assert.match(read.content, /^# Chef Experience/);
    assert.doesNotMatch(read.content, /^---/m);
    assert.equal(read.artifact.title, "Chef UX Analysis");
    assert.ok(read.revision.startsWith("sha256:"));
  });

  it("refuses paths outside docs/artifacts, outside the repo, or that are not Markdown", async () => {
    assert.equal(await readProjectDocument("pantry-pilot", "projects/pantry-pilot/TASKS.md", "agentos"), undefined);
    assert.equal(await readProjectDocument("pantry-pilot", "docs/../../PORTFOLIO.md", "agentos"), undefined);
    assert.equal(await readProjectDocument("pantry-pilot", "../../etc/passwd", "repo"), undefined);
    assert.equal((await readProjectDocument("pantry-pilot", "docs/API.md", "repo"))?.artifact.title, "API Reference");
    assert.equal(isInside("/a/b", "../c"), false);
    assert.equal(isInside("/a/b", "c/d.md"), true);
  });

  it("caps repository docs by depth", async () => {
    const docs = await listRepoDocuments("pantry-pilot", repo);
    assert.equal(docs.some((doc) => doc.relativePath.includes("node_modules")), false);
    assert.equal(docs.some((doc) => doc.relativePath === "src.md"), false);
  });
});

describe("creating documents", () => {
  it("writes front matter and files under the task, never overwriting", async () => {
    const first = await createDocument("pantry-pilot", {
      title: "Implementation Plan",
      type: "plan",
      taskId: "pp-024",
      content: "# Plan\n\nDo the thing.",
      source: "hermes",
      runId: "run_9",
    });

    assert.equal(first.artifact.relativePath, "projects/pantry-pilot/artifacts/PP-024/implementation-plan.md");
    assert.equal(first.artifact.taskId, "PP-024");
    assert.equal(first.artifact.source, "hermes");

    const raw = fs.readFileSync(path.join(root, first.artifact.relativePath), "utf8");
    assert.match(raw, /^---\ntitle: Implementation Plan\ntype: plan\nsource: hermes\ncreated: /);
    assert.match(raw, /task: PP-024\nrun: run_9\n---\n\n# Plan/);

    const second = await createDocument("pantry-pilot", {
      title: "Implementation Plan",
      type: "plan",
      taskId: "PP-024",
      content: "Another.",
    });
    assert.equal(second.artifact.filename, "implementation-plan-2.md");

    const doc = await createDocument("pantry-pilot", { title: "Meeting notes", type: "notes", content: "Hi" });
    assert.equal(doc.artifact.relativePath, "projects/pantry-pilot/docs/meeting-notes.md");
    assert.equal(toFilename("Chef UX: Analysis!"), "chef-ux-analysis.md");
  });

  it("replaces an agent's own front matter rather than stacking headers", () => {
    const out = withFrontMatter("---\ntitle: Old\n---\n\n# Body\n", {
      title: "New",
      type: "report",
      source: "claude",
      created: "2026-09-21T00:00:00.000Z",
    });
    assert.equal(out.split("---").length, 3);
    assert.match(out, /title: New/);
    assert.doesNotMatch(out, /title: Old/);
  });
});

describe("worker artifacts", () => {
  it("parses declaration lines from a summary", () => {
    const declared = parseArtifactDeclarations(`Done. I refactored the search.

Artifact: artifacts/implementation-plan.md — Implementation Plan (plan)
artifact: artifacts/notes.md - Loose notes
Artifact: not-markdown.txt — Ignored
`);

    assert.deepEqual(declared, [
      { path: "artifacts/implementation-plan.md", title: "Implementation Plan", type: "plan" },
      { path: "artifacts/notes.md", title: "Loose notes", type: undefined },
    ]);
  });

  it("registers declared and detected files inside the worktree, and refuses the rest", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-worktree-"));
    fs.mkdirSync(path.join(worktree, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "artifacts", "plan.md"), "# The plan\n\nSteps.\n");
    fs.writeFileSync(path.join(worktree, "TECH_DEBT_REPORT.md"), "# Tech debt\n\nLots.\n");
    fs.writeFileSync(path.join(worktree, "README.md"), "# Repo readme\n");
    fs.writeFileSync(path.join(worktree, "empty.md"), "\n");

    const job = {
      id: "job_test000000000000",
      project: "pantry-pilot",
      worker: "claude",
      objective: "x",
      status: "running",
      createdAt: "2026-09-21T00:00:00.000Z",
    } as WorkerJob;

    const { registered, skipped } = await registerJobArtifacts({
      job,
      worktreePath: worktree,
      declared: [
        { path: "artifacts/plan.md", title: "Implementation Plan", type: "plan" },
        { path: "../outside.md", title: "Escape", type: "plan" },
        { path: "artifacts/missing.md", title: "Ghost", type: "plan" },
      ],
      changedFiles: ["artifacts/plan.md", "TECH_DEBT_REPORT.md", "README.md", "empty.md", "src/index.ts"],
      taskId: "PP-002",
      source: "claude",
    });

    assert.deepEqual(
      registered.map((entry) => [entry.title, entry.type, entry.detected ?? false]),
      [
        ["Implementation Plan", "plan", false],
        ["Tech debt", "report", true],
      ],
    );
    assert.deepEqual(
      skipped.map((entry) => entry.reason).sort(),
      ["does not exist", "empty", "outside the worktree"],
    );

    const registeredPath = registered[0].registeredPath as string;
    const raw = fs.readFileSync(path.join(root, registeredPath), "utf8");
    assert.match(raw, /source: claude/);
    assert.match(raw, /task: PP-002/);
    assert.match(raw, /job: job_test000000000000/);

    const detected = fs.readFileSync(path.join(root, registered[1].registeredPath as string), "utf8");
    assert.match(detected, /detected: true/);

    const documents = await getProjectDocuments("pantry-pilot");
    const plan = documents.agentos.find((doc) => doc.title === "Implementation Plan");
    assert.equal(plan?.jobId, "job_test000000000000");
    assert.equal(plan?.taskId, "PP-002");

    fs.rmSync(worktree, { recursive: true, force: true });
  });
});

describe("Hermes document proposals", () => {
  it("reads a proposal and names the file", () => {
    const proposal = readDocumentProposal(
      '```json\n{"title":"Chef Generation Research","type":"research","content":"# Research\\n\\nFindings."}\n```',
      "PP-024",
    );

    assert.ok(proposal);
    assert.equal(proposal.filename, "chef-generation-research.md");
    assert.equal(proposal.type, "research");
    assert.equal(proposal.taskId, "PP-024");
    assert.equal(readDocumentProposal('{"title":"No body"}'), undefined);
  });
});

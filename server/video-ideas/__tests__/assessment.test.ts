import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import matter from "gray-matter";
import { closeLearningDatabase } from "../../learning/db";
import { ASSESSMENT_SECTIONS, assessmentPrompt, fileAssessment, parseVerdict } from "../assessment";
import { AGENTOS_REPO } from "../studio";
import { createIdea, updateIdea } from "../store";

let root: string;
let studio: string;
const previousRoot = process.env.AGENTOS_ROOT;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-"));
  studio = await fs.mkdtemp(path.join(os.tmpdir(), "studio-"));
  process.env.AGENTOS_ROOT = root;
});

after(async () => {
  closeLearningDatabase();
  if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previousRoot;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(studio, { recursive: true, force: true });
});

describe("assessment", () => {
  it("asks for every section, through the money-and-edge lens, and remembers past declines", () => {
    const idea = createIdea({ id: "ls-as1", externalId: "dQw4w9WgXcQ", title: "Agents that sell" }, "assess");
    const prompt = assessmentPrompt({ ...idea, notePath: "knowledge/videos/x.md" }, "NOTE BODY", [
      { title: "Old idea", verdict: "adopt", decision: "declined", reason: "Already have it" },
    ]);
    let last = -1;
    for (const section of ASSESSMENT_SECTIONS) {
      const at = prompt.indexOf(`## ${section}`);
      assert.ok(at > last, section);
      last = at;
    }
    assert.ok(prompt.includes(AGENTOS_REPO));
    assert.ok(prompt.includes(root));
    assert.ok(prompt.includes("NOTE BODY"));
    assert.match(prompt, /make Dylan money/);
    assert.match(prompt, /ahead of the AI curve/);
    assert.ok(prompt.includes("Old idea — verdict adopt, declined: Already have it"));
    assert.ok(prompt.includes(`ideas/${idea.id}/assessment.md`));
    assert.ok(prompt.includes(`ideas/${idea.id}/verdict.json`));
  });

  it("reads a verdict, ignoring case, and refuses an unknown one", () => {
    assert.deepEqual(parseVerdict('{"verdict":"Adapt","why":"Fits outreach","size":"Medium"}'), { verdict: "adapt", why: "Fits outreach", size: "medium" });
    assert.equal(parseVerdict('{"verdict":"maybe","why":"x"}'), undefined);
    assert.equal(parseVerdict("not json"), undefined);
  });

  it("files the assessment into the vault and waits for a decision", async () => {
    const idea = updateIdea(createIdea({ id: "ls-as2", externalId: "dQw4w9WgXcQ", title: "Agents that sell" }, "assess").id, {
      stage: "assessing",
      notePath: "knowledge/videos/2026-10-29-agents-that-sell.md",
    });
    const out = path.join(studio, "ideas", idea.id);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "assessment.md"), "## What it proposes\nSell with agents.\n");
    await fs.writeFile(path.join(out, "verdict.json"), '{"verdict":"adopt","why":"Direct revenue","size":"small"}');

    const filed = await fileAssessment(idea, [studio]);
    assert.equal(filed.stage, "awaiting_decision");
    assert.equal(filed.verdict, "adopt");
    assert.equal(filed.verdictWhy, "Direct revenue");
    assert.equal(filed.size, "small");
    assert.match(filed.assessmentPath ?? "", /^knowledge\/assessments\/\d{4}-\d{2}-\d{2}-agents-that-sell\.md$/);
    const note = matter(await fs.readFile(path.join(root, filed.assessmentPath!), "utf8"));
    assert.equal(note.data.verdict, "adopt");
    assert.equal(note.data.note, idea.notePath);
    assert.ok(note.content.includes("Sell with agents."));
  });

  it("fails the idea when the worker left no verdict", async () => {
    const idea = updateIdea(createIdea({ id: "ls-as3", externalId: "dQw4w9WgXcQ", title: "No verdict" }, "assess").id, { stage: "assessing" });
    const out = path.join(studio, "ideas", idea.id);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "assessment.md"), "text");
    const closed: (string | undefined)[] = [];
    const filed = await fileAssessment({ ...idea, jobId: "job-y" }, [studio], async (jobId) => {
      closed.push(jobId);
    });
    assert.deepEqual(closed, ["job-y"]);
    assert.equal(filed.stage, "failed");
    assert.equal(filed.failedAt, "assessing");
  });
});

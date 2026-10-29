import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import matter from "gray-matter";
import { closeLearningDatabase, learningDatabase } from "../../learning/db";
import { getNote } from "../../learning/notes";
import { getSource } from "../../learning/library";
import { checkNote, notePrompt, NOTE_HEADINGS, writeKnowledgeNote } from "../note";
import { createIdea, getIdea } from "../store";

const NOTE = `## Brief
They walk through building an agent that reads email.

It covers tools and memory.

## The 20% that explains the 80%
- Agents are loops.

## Explain it like I'm 10
An agent is a helper that keeps trying until the job is done.`;

let root: string;
const previousRoot = process.env.AGENTOS_ROOT;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-"));
  process.env.AGENTOS_ROOT = root;
  const now = new Date().toISOString();
  learningDatabase()
    .prepare(
      `INSERT INTO sources (id, kind, external_id, url, title, author, position_seconds, watch_later, tags, created_at, updated_at)
       VALUES ('ls-note', 'youtube', 'noteTest001', 'https://www.youtube.com/watch?v=noteTest001', 'Build an email agent', 'Some Channel', 0, 0, '[]', ?, ?)`,
    )
    .run(now, now);
});

after(async () => {
  closeLearningDatabase();
  if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previousRoot;
  await fs.rm(root, { recursive: true, force: true });
});

describe("knowledge note", () => {
  it("refuses a note missing a section", () => {
    assert.equal(checkNote(NOTE), undefined);
    assert.match(checkNote(NOTE.replace("## Explain it like I'm 10", "## Simple")) ?? "", /Explain it like I'm 10/);
  });

  it("asks for the three sections, and says when the transcript was trimmed", () => {
    const prompt = notePrompt({ title: "T", url: "https://youtu.be/x" }, "[00:01] hi", true);
    for (const heading of NOTE_HEADINGS) assert.ok(prompt.includes(heading), heading);
    assert.ok(prompt.includes("The transcript was trimmed"));
    assert.ok(!notePrompt({ title: "T", url: "u" }, "x", false).includes("The transcript was trimmed"));
  });

  it("writes the note and transcript to the vault and a stub to Learning", async () => {
    const idea = createIdea({ id: "ls-note", externalId: "noteTest001", title: "Build an email agent" }, "learn");
    const done = await writeKnowledgeNote(idea, getSource("ls-note")!, [{ seconds: 1, text: "hello" }], async () => NOTE);

    assert.equal(done.stage, "noted");
    assert.match(done.notePath ?? "", /^knowledge\/videos\/\d{4}-\d{2}-\d{2}-build-an-email-agent\.md$/);
    assert.equal(done.transcriptPath, done.notePath!.replace(/\.md$/, ".transcript.md"));

    const note = matter(await fs.readFile(path.join(root, done.notePath!), "utf8"));
    assert.deepEqual(note.data.tags, ["learning"]);
    assert.equal(note.data.videoId, "noteTest001");
    assert.equal(note.data.learningSourceId, "ls-note");
    assert.equal(note.data.transcript, done.transcriptPath);
    assert.ok(note.content.includes("## The 20% that explains the 80%"));

    const transcript = await fs.readFile(path.join(root, done.transcriptPath!), "utf8");
    assert.ok(transcript.includes("[00:01] hello"));

    const stub = getNote(done.noteId!)!;
    assert.deepEqual(stub.tags, ["learning"]);
    assert.equal(stub.sourceId, "ls-note");
    assert.equal(stub.content, `They walk through building an agent that reads email.\n\nFull note: ${done.notePath}`);
    assert.equal(done.runs[0]?.step, "note");
  });

  it("fails the idea when the note comes back without its sections twice", async () => {
    const idea = getIdea(createIdea({ id: "ls-note", externalId: "dQw4w9WgXcQ", title: "x" }, "learn").id)!;
    const done = await writeKnowledgeNote({ ...idea, stage: "noting" }, getSource("ls-note")!, [{ seconds: 1, text: "hi" }], async () => "no sections");
    assert.equal(done.stage, "failed");
    assert.equal(done.failedAt, "noting");
    assert.equal(done.error, "The note came back without its sections.");
  });
});

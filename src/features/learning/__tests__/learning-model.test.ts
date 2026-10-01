import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningNote, LearningSource, Notebook } from "@shared/learning-types";
import {
  filterNotes,
  formatElapsed,
  groupLibrary,
  interpolatedProgress,
  notebookSourceList,
  parseTimestampInput,
  playbackPollMs,
  progressShare,
  relatedNotes,
  resumeAt,
} from "../learning-model";

const source = (overrides: Partial<LearningSource>): LearningSource => ({
  id: "ls-1",
  kind: "youtube",
  externalId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Video",
  positionSeconds: 0,
  watchLater: false,
  finished: false,
  archived: false,
  tags: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const note = (overrides: Partial<LearningNote>): LearningNote => ({
  id: "ln-1",
  title: "Memory compaction",
  content: "Compaction vs retrieval",
  sourceType: "youtube",
  tags: [],
  archived: false,
  promotedTo: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

describe("learning model", () => {
  it("reads typed timestamps", () => {
    assert.equal(parseTimestampInput("32:18"), 1938);
    assert.equal(parseTimestampInput("1:02:03"), 3723);
    assert.equal(parseTimestampInput("75"), 75);
    for (const bad of ["", "1:75", "a:b", "1:2:3:4"]) assert.equal(parseTimestampInput(bad), undefined, bad);
  });

  it("resumes where a video was left, unless asked otherwise or finished", () => {
    assert.equal(resumeAt(source({ positionSeconds: 600 })), 600);
    assert.equal(resumeAt(source({ positionSeconds: 600 }), 90), 90);
    assert.equal(resumeAt(source({ positionSeconds: 600, finished: true })), 0);
    assert.equal(resumeAt(source({ positionSeconds: 3 })), 0);
    assert.equal(progressShare(source({ positionSeconds: 600, durationSeconds: 2400 })), 0.25);
    assert.equal(progressShare(source({})), undefined);
  });

  it("groups the library", () => {
    const groups = groupLibrary([
      source({ id: "a", positionSeconds: 100 }),
      source({ id: "b", watchLater: true }),
      source({ id: "c", kind: "spotify" }),
      source({ id: "d", archived: true, watchLater: true }),
      source({ id: "e", finished: true, positionSeconds: 2000, watchLater: true }),
    ]);
    assert.deepEqual(groups.continueWatching.map((entry) => entry.id), ["a"]);
    assert.deepEqual(groups.watchLater.map((entry) => entry.id), ["b"]);
    assert.deepEqual(groups.tracks.map((entry) => entry.id), ["c"]);
    assert.deepEqual(groups.archived.map((entry) => entry.id), ["d"]);
  });

  it("filters notes by text, source, workspace and archive", () => {
    const notes = [note({ id: "1", workspaceId: "agentos", tags: ["memory"] }), note({ id: "2", sourceType: "manual", title: "Pricing" }), note({ id: "3", archived: true })];
    const base = { query: "", sourceType: "all" as const, workspace: "all", archived: false };
    assert.deepEqual(filterNotes(notes, base).map((entry) => entry.id), ["1", "2"]);
    assert.deepEqual(filterNotes(notes, { ...base, query: "MEMORY" }).map((entry) => entry.id), ["1"]);
    assert.deepEqual(filterNotes(notes, { ...base, sourceType: "manual" }).map((entry) => entry.id), ["2"]);
    assert.deepEqual(filterNotes(notes, { ...base, workspace: "agentos" }).map((entry) => entry.id), ["1"]);
    assert.deepEqual(filterNotes(notes, { ...base, archived: true }).map((entry) => entry.id), ["3"]);
  });

  it("polls Spotify gently", () => {
    assert.equal(playbackPollMs({ visible: true, playing: true, inApp: false }), 4_000);
    assert.equal(playbackPollMs({ visible: false, playing: true, inApp: false }), 30_000);
    assert.equal(
      interpolatedProgress({ isPlaying: true, progressMs: 10_000, readAt: "2026-10-01T00:00:00.000Z", track: { durationMs: 12_000 } }, Date.parse("2026-10-01T00:00:05.000Z")),
      12_000,
    );
    assert.equal(formatElapsed(4_328_000), "01:12:08");
  });

  it("lists a notebook's sources and finds related learnings", () => {
    const notebook: Notebook = {
      id: "nb",
      name: "Agentic OS Memory Research",
      provider: "notebooklm",
      externalUrl: "https://notebooklm.google.com/notebook/x",
      sourceIds: ["a"],
      noteIds: ["n1"],
      externalSources: [{ title: "Spec", url: "https://example.com/spec" }],
      createdAt: "",
      updatedAt: "",
    };
    const text = notebookSourceList(notebook, [source({ id: "a", title: "Talk" })], [note({ id: "n1", title: "Insight" })]);
    assert.match(text, /Talk — https:\/\/www.youtube.com/);
    assert.match(text, /Spec — https:\/\/example.com\/spec/);
    assert.match(text, /Learning: Insight/);
    const related = relatedNotes(notebook, [note({ id: "n1" }), note({ id: "n2", sourceId: "a" }), note({ id: "n3", sourceUrl: notebook.externalUrl }), note({ id: "n4" })]);
    assert.deepEqual(related.map((entry) => entry.id), ["n1", "n2", "n3"]);
  });
});

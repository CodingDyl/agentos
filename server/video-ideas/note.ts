import matter from "gray-matter";
import type { LearningSource } from "../../shared/learning-types";
import type { VideoIdea } from "../../shared/video-ideas-types";
import { writeAgentOSFile } from "../agentos/filesystem";
import { createNote } from "../learning/notes";
import { slugify } from "../reengineer/library";
import { runClaudePrint } from "./claude-print";
import { updateIdea } from "./store";
import { transcriptText, type TranscriptLine } from "./transcript";

/**
 * The knowledge note: what was said, the few ideas that unlock the rest, and
 * the same again as if to a ten-year-old. The vault file is the note; the
 * Learning entry is a short stub that points at it, so there is one copy to edit.
 */

export const NOTE_HEADINGS = ["## Brief", "## The 20% that explains the 80%", "## Explain it like I'm 10"] as const;

/** Characters of transcript the note is written from. */
export const TRANSCRIPT_BUDGET = 120_000;

export type AskClaude = (prompt: string) => Promise<string>;

export function notePrompt(meta: { title: string; author?: string; url: string }, transcript: string, trimmed: boolean): string {
  return [
    "You are writing a knowledge note for Dylan from a YouTube video's transcript. He wants to understand it, not re-read it.",
    `Video: ${meta.title}${meta.author ? ` — ${meta.author}` : ""} (${meta.url})`,
    "",
    "Write markdown with exactly these three sections, in this order, using these exact headings:",
    `${NOTE_HEADINGS[0]}\nWhat was discussed, in the order it came up. Short paragraphs. Cite [mm:ss] timestamps for the main turns.`,
    `${NOTE_HEADINGS[1]}\nThe few core ideas (the 20%) that make the rest of the video (the 80%) make sense. A short list; each item says the idea and why it unlocks the rest.`,
    `${NOTE_HEADINGS[2]}\nThe concepts explained plainly, as if to a ten-year-old: everyday words, one comparison per idea, no jargon.`,
    "",
    "Write only what the transcript supports. Do not add a title, front matter or any other section. Start with the first heading.",
    trimmed ? "The transcript was trimmed to fit: say in the Brief that the note covers only the first part of the video." : undefined,
    "",
    "Transcript:",
    transcript,
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

/** Why a note is not usable, or `undefined` when it is. */
export function checkNote(markdown: string): string | undefined {
  const missing = NOTE_HEADINGS.filter((heading) => !markdown.includes(heading));
  return missing.length > 0 ? `The note is missing: ${missing.join(", ")}` : undefined;
}

function firstBriefParagraph(markdown: string): string {
  const brief = markdown.split(NOTE_HEADINGS[0])[1]?.split(NOTE_HEADINGS[1])[0] ?? "";
  return brief.trim().split(/\n\s*\n/)[0]?.trim() ?? "";
}

function basePath(idea: VideoIdea): string {
  return `knowledge/videos/${idea.createdAt.slice(0, 10)}-${slugify(idea.title, idea.videoId)}`;
}

export async function writeTranscript(idea: VideoIdea, lines: readonly TranscriptLine[]): Promise<string> {
  const relativePath = `${basePath(idea)}.transcript.md`;
  const body = matter.stringify(`# Transcript — ${idea.title}\n\n${transcriptText(lines)}\n`, {
    tags: ["learning", "transcript"],
    videoId: idea.videoId,
    source: `https://www.youtube.com/watch?v=${idea.videoId}`,
  });
  await writeAgentOSFile(relativePath, body);
  return relativePath;
}

export async function writeKnowledgeNote(
  idea: VideoIdea,
  source: LearningSource,
  lines: readonly TranscriptLine[],
  ask: AskClaude = runClaudePrint,
): Promise<VideoIdea> {
  const startedAt = new Date().toISOString();
  const transcriptPath = idea.transcriptPath ?? (await writeTranscript(idea, lines));
  const full = transcriptText(lines);
  const trimmed = full.length > TRANSCRIPT_BUDGET;
  const prompt = notePrompt({ title: source.title, author: source.author, url: source.url }, full.slice(0, TRANSCRIPT_BUDGET), trimmed);

  let markdown = await ask(prompt);
  if (checkNote(markdown)) markdown = await ask(prompt);
  const run = { step: "note" as const, worker: "Claude Code (Max plan)", startedAt, endedAt: new Date().toISOString() };
  if (checkNote(markdown)) {
    return updateIdea(idea.id, {
      stage: "failed",
      failedAt: "noting",
      error: "The note came back without its sections.",
      transcriptPath,
      runs: [...idea.runs, { ...run, status: "failed" }],
    });
  }

  const notePath = `${basePath(idea)}.md`;
  const body = matter.stringify(`# ${source.title}\n\n${markdown.trim()}\n`, {
    tags: ["learning"],
    source: source.url,
    channel: source.author ?? null,
    videoId: idea.videoId,
    learningSourceId: source.id,
    transcript: transcriptPath,
    created: startedAt.slice(0, 10),
  });
  await writeAgentOSFile(notePath, body);

  const stub = createNote({
    title: source.title.slice(0, 200),
    content: `${firstBriefParagraph(markdown)}\n\nFull note: ${notePath}`.slice(0, 20_000),
    sourceType: "youtube",
    sourceId: source.id,
    tags: ["learning"],
  });

  return updateIdea(idea.id, {
    stage: "noted",
    error: undefined,
    failedAt: undefined,
    notePath,
    transcriptPath,
    noteId: stub.id,
    runs: [...idea.runs, { ...run, status: "completed" }],
  });
}

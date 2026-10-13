import { LIBRARY_FOLDER, TOUCH_LABELS, type LibraryEmail, type Touch } from "../../shared/outreach-library";
import type { OutreachPath } from "../../shared/outreach-case";
import { CreateNoteError, createMemoryNote } from "../memory/create-note";
import { isArchived } from "../memory/index";
import { memoryService, type MemoryService } from "../memory/service";

/**
 * Reading and writing the email library in the memory vault.
 *
 * Saving only ever creates a note (see `createMemoryNote`), and refuses while
 * the drive is unplugged. Reading uses the vault's index, which is cached, so
 * drafting keeps working with the examples last seen when the drive is away.
 *
 * What is saved is made safe to reuse: the business's name, the person's
 * name, links, email addresses and the signature are replaced with
 * placeholders, so an example cannot carry one business's details into the
 * next email.
 */

let override: MemoryService | undefined;

/** The vault the library lives in: the shared memory service, unless a test supplies its own. */
export function libraryService(): MemoryService {
  return override ?? memoryService();
}

/** For tests, so they never touch the real vault. */
export function setLibraryServiceForTests(service: MemoryService | undefined): void {
  override = service;
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

const MAX_EXAMPLE_CHARS = 1200;
export const MAX_EXAMPLES = 3;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the last `--` signature line starts (a line of its own, at the start or after a newline), or -1. */
export function signatureStart(body: string): number {
  const last = [...body.matchAll(/(^|\n)--[ \t]*\n/g)].at(-1);
  return last?.index ?? -1;
}

/** Everything from the last `--` signature line on. The signature is added by AgentOS at send time. */
export function stripSignature(body: string): string {
  const at = signatureStart(body);
  return (at >= 0 ? body.slice(0, at) : body).trim();
}

export interface RedactFacts {
  company?: string;
  contact?: string;
  website?: string;
}

/** Replaces the facts that belong to one business with placeholders. */
export function redactForLibrary(text: string, facts: RedactFacts): string {
  let out = text
    .replace(/https?:\/\/[^\s)>\]]+/gi, "[link]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");

  const host = facts.website?.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];
  if (host && host.includes(".")) out = out.replace(new RegExp(escape(host), "gi"), "[their site]");

  const company = facts.company?.trim();
  if (company && company.length >= 2) out = out.replace(new RegExp(escape(company), "gi"), "[Company]");

  const contact = facts.contact?.trim();
  if (contact) {
    out = out.replace(new RegExp(escape(contact), "gi"), "[Name]");
    const first = contact.split(/\s+/)[0];
    if (first.length >= 3) out = out.replace(new RegExp(`\\b${escape(first)}\\b`, "gi"), "[Name]");
  }
  return out;
}

export interface SaveToLibraryInput {
  subject: string;
  body: string;
  touch: Touch;
  path?: OutreachPath;
  gotReply: boolean;
  note: string;
  facts: RedactFacts;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Saves one email to the vault. Returns the note's id. */
export async function saveToLibrary(service: MemoryService, input: SaveToLibraryInput, now: Date = new Date()): Promise<{ id: string }> {
  const subject = redactForLibrary(input.subject, input.facts).replace(/\s+/g, " ").trim();
  const body = redactForLibrary(stripSignature(input.body), input.facts);
  if (!subject || !body) throw new LibraryError("There is nothing to save.");

  const tags = [
    "email-library",
    `touch-${input.touch}`,
    ...(input.path ? [input.path === "build_first" ? "build-first" : "cold-pitch"] : []),
    ...(input.gotReply ? ["got-a-reply"] : []),
  ];
  const note = redactForLibrary(input.note, input.facts).trim();
  const content = [`## Subject\n\n${subject}`, `## Email\n\n${body}`, ...(note ? [`## Notes\n\n${note}`] : [])].join("\n\n");

  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const titles = [`${TOUCH_LABELS[input.touch]} - ${subject.slice(0, 60)} - ${day}`, `${TOUCH_LABELS[input.touch]} - ${subject.slice(0, 60)} - ${day} ${pad(now.getHours())}${pad(now.getMinutes())}`];

  for (const [index, title] of titles.entries()) {
    try {
      const created = await createMemoryNote(service, { folder: LIBRARY_FOLDER, title, body: content, tags, type: "pattern" });
      return { id: created.id };
    } catch (error) {
      // Same subject saved twice in a day: try once more with the time in the name.
      if (error instanceof CreateNoteError && error.status === 409 && index === 0) continue;
      if (error instanceof CreateNoteError) throw new LibraryError(error.message, error.status);
      throw error;
    }
  }
  throw new LibraryError("That email is already in the library.", 409);
}

function section(body: string, heading: string): string {
  const match = new RegExp(`^## ${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body);
  return match?.[1].trim() ?? "";
}

/** Every email in the library, newest first. Archived notes are left out. */
export function listLibrary(service: MemoryService): LibraryEmail[] {
  const emails: LibraryEmail[] = [];
  for (const record of service.index.notes.values()) {
    if (!record.id.startsWith(`${LIBRARY_FOLDER}/`) || isArchived(record)) continue;
    const tags = record.parsed.tags;
    const touchTag = tags.find((tag) => /^touch-[123]$/.test(tag));
    const subject = section(record.parsed.body, "Subject");
    const body = section(record.parsed.body, "Email");
    if (!touchTag || !subject || !body) continue;

    const created = record.parsed.frontmatter.createdAt;
    emails.push({
      id: record.id,
      title: record.parsed.title,
      subject,
      body,
      touch: Number(touchTag.slice(-1)) as Touch,
      path: tags.includes("build-first") ? "build_first" : tags.includes("cold-pitch") ? "cold_pitch" : undefined,
      gotReply: tags.includes("got-a-reply"),
      note: section(record.parsed.body, "Notes"),
      savedAt: typeof created === "string" ? created : new Date(record.mtimeMs).toISOString(),
    });
  }
  return emails.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * The examples to show the drafter for one email. A chosen one is used alone.
 * Otherwise the same step of the sequence only (a first email is never a model
 * for a follow-up), ones that got a reply first, then the same approach, then
 * the newest.
 */
export function pickExamples(library: readonly LibraryEmail[], options: { touch: number; path?: OutreachPath; chosenId?: string }): LibraryEmail[] {
  if (options.chosenId) {
    const chosen = library.find((email) => email.id === options.chosenId);
    if (chosen) return [chosen];
  }
  const touch = Math.min(options.touch, 3);
  return library
    .filter((email) => email.touch === touch)
    .sort(
      (a, b) =>
        Number(b.gotReply) - Number(a.gotReply) ||
        Number(options.path !== undefined && b.path === options.path) - Number(options.path !== undefined && a.path === options.path) ||
        b.savedAt.localeCompare(a.savedAt),
    )
    .slice(0, MAX_EXAMPLES);
}

/** The examples as the drafter sees them, fenced as data. */
export function exampleLines(examples: readonly LibraryEmail[]): string[] {
  if (examples.length === 0) return [];
  return [
    "SAVED EXAMPLES (match their length, rhythm and warmth; never reuse a sentence or a detail; [Company], [Name] and [link] are placeholders for facts you must take from THIS business's notes):",
    "<<<EXAMPLES",
    ...examples.flatMap((email, index) => [
      `--- Example ${index + 1}${email.gotReply ? " (got a reply)" : ""} ---`,
      `Subject: ${email.subject}`,
      email.body.slice(0, MAX_EXAMPLE_CHARS),
      "",
    ]),
    "EXAMPLES>>>",
  ];
}

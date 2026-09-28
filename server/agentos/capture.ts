import { getBullets, getFirstSection } from "./markdown";
import { editFile, type EditResult } from "./mutations/writer";

/**
 * Capture: the one write in AgentOS that must never wait on anything.
 *
 * A note lands as a bullet under `## Inbox` in `inbox/CAPTURE.md` — the file
 * Hermes already reads and files from. No classification happens here, and no
 * AI is in the path: a thought that has to wait for a model to answer is a
 * thought that gets lost. Filing is a separate, later step.
 *
 * ```markdown
 * ## Inbox
 *
 * - Need to update the checkout copy (for Story Keeper)
 * - Book the car service
 * - [Decision] Hermes is the orchestrator   ← a kind, as Hermes files them
 * ```
 *
 * The workspace rides at the end as `(for …)` rather than in brackets:
 * brackets are already Hermes' mark for what *kind* of thing a line is.
 */

export const CAPTURE_PATH = "inbox/CAPTURE.md";

const INBOX_HEADING = "## Inbox";

const EMPTY_CAPTURE = `# Capture Inbox

Temporary location for unprocessed thoughts, tasks and ideas.

---

${INBOX_HEADING}
`;

/** One line, no Markdown structure a note could smuggle in. */
export function captureLine(note: string, workspace?: string): string {
  const text = note.replace(/\s+/g, " ").trim();
  const tag = workspace?.replace(/[()\n]/g, "").trim();
  return tag ? `- ${text} (for ${tag})` : `- ${text}`;
}

/**
 * Appends the line to the end of `## Inbox`, creating the section — or the
 * whole file — when it is missing. Everything else in the file is untouched.
 */
export function appendCapture(markdown: string | undefined, line: string): string {
  const source = markdown ?? EMPTY_CAPTURE;
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((entry) => /^##\s+inbox\s*$/i.test(entry.trim()));

  if (start === -1) {
    return `${source.replace(/\s*$/, "")}\n\n${INBOX_HEADING}\n\n${line}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s/.test(lines[index])) {
      end = index;
      break;
    }
  }

  // Insert after the section's last non-blank line, so the list stays a list.
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim().length === 0) insertAt -= 1;

  const before = lines.slice(0, insertAt);
  if (insertAt === start + 1) before.push("");
  const after = lines.slice(insertAt);

  return [...before, line, ...after].join("\n").replace(/\n*$/, "\n");
}

export async function captureNote(note: string, workspace?: string): Promise<EditResult & { line: string }> {
  const line = captureLine(note, workspace);
  const result = await editFile({
    relativePath: CAPTURE_PATH,
    label: "capture.add",
    apply: (current) => appendCapture(current, line),
  });

  return { ...result, line };
}

export interface CapturedItem {
  text: string;
  /** Hermes' classification, when it has written one: `[Decision]`. */
  kind?: string;
  workspace?: string;
}

/** What is waiting to be filed, newest last — the order it was captured in. */
export function parseCaptures(markdown: string | undefined): CapturedItem[] {
  const section = markdown ? getFirstSection(markdown, ["Inbox"]) : undefined;
  if (!section) return [];

  return getBullets(section).map((bullet) => {
    let text = bullet.trim();
    const item: CapturedItem = { text };

    const kind = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
    if (kind) {
      item.kind = kind[1];
      text = kind[2];
    }

    const target = /^(.*?)\s*\(for ([^)]+)\)$/.exec(text);
    if (target) {
      item.workspace = target[2].trim();
      text = target[1];
    }

    item.text = text;
    return item;
  });
}

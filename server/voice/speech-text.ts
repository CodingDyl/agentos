/**
 * Turns a Hermes reply (markdown, often long) into something worth saying.
 *
 * The full reply always stays on screen. Speech is a summary of it: prose
 * only, no code, tables or links read aloud, and a hard limit at a sentence
 * boundary. Nothing is rewritten or paraphrased, only removed or cut.
 */

const DEFAULT_LIMIT = 600;
const HANDOFF = "The rest is on screen.";

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, "$2")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/([.!?:])\s*\.\s+/g, "$1 ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

export interface SpeechText {
  text: string;
  /** True when the reply was cut, so the spoken version ends with a handoff. */
  truncated: boolean;
}

export function toSpeechText(markdown: string, limit = DEFAULT_LIMIT): SpeechText {
  const plain = stripMarkdown(markdown);
  if (plain.length <= limit) return { text: plain, truncated: false };

  const window = plain.slice(0, limit);
  const lastStop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  const cut = lastStop > limit * 0.4 ? window.slice(0, lastStop + 1) : window.replace(/\s+\S*$/, "") + ".";

  return { text: `${cut} ${HANDOFF}`, truncated: true };
}

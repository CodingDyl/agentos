/**
 * House style for text a model writes: no em dashes.
 *
 * Hermes is told this in a system message on every call AgentOS makes
 * (`server/hermes/client.ts`). Models still slip, so this is the guarantee
 * behind the instruction: whatever Hermes writes is passed through here
 * before it is stored or shown.
 *
 * Only prose is touched. Fenced code blocks and inline code are left exactly
 * as written, since a dash inside code may be meaningful. Text a person wrote
 * (vault documents, their own messages) never goes through this.
 */

export const NO_EM_DASH_RULE =
  "House style: never use em dashes (—) or en dashes used as dashes (–). Write a comma, a colon, parentheses, or a new sentence instead. Use a plain hyphen only inside words and number ranges.";

const DASH = /[—―]|(?<=\s)–(?=\s)/;

function cleanProse(text: string): string {
  if (!DASH.test(text)) return text;
  return (
    text
      // A range between numbers ("2019—2021", "5 – 10") keeps its meaning as a hyphen.
      .replace(/(\d)\s*[—―–]\s*(\d)/g, "$1-$2")
      // A dash opening a line (a list marker or a quote attribution) becomes a hyphen.
      .replace(/^([ \t]*)[—―](?=\s)/gm, "$1-")
      // A dash just before a line break ends the clause.
      .replace(/[ \t]*[—―][ \t]*(?=\n|$)/g, ":")
      // Everywhere else it joins two clauses: a comma reads naturally.
      .replace(/[ \t]*[—―][ \t]*/g, ", ")
      .replace(/(?<=\s)–(?=\s)/g, ",")
      // Tidy what the replacements can leave behind.
      .replace(/ ,/g, ",")
      .replace(/,\s*([.,;:!?])/g, "$1")
  );
}

/** Removes em dashes from model-written text, leaving code untouched. */
export function withoutEmDashes(text: string): string {
  if (!DASH.test(text)) return text;

  // Split on fenced blocks first, then on inline code inside the prose parts.
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .split(/(`[^`\n]*`)/g)
            .map((piece, inner) => (inner % 2 === 1 ? piece : cleanProse(piece)))
            .join(""),
    )
    .join("");
}

/**
 * Invisible characters that have no place in an email and are the usual
 * carriers of text "watermarks": zero-width spaces and joiners, word joiners,
 * bidi controls, soft hyphens, the byte-order mark, and the Mongolian vowel
 * separator. A zero-width joiner *inside* an emoji sequence (a person emoji joined to a laptop) is kept,
 * since removing it splits the emoji.
 */
const INVISIBLE = /[\u00AD\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const STRAY_ZWJ = /(?<!\p{Extended_Pictographic}\uFE0F?)\u200D|\u200D(?!\p{Extended_Pictographic})/gu;

/** Spaces that look ordinary but are not: no-break, thin, narrow, figure, ideographic. */
const ODD_SPACE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Lines a model puts around an answer that a person never would. */
const PREAMBLE = /^(?:sure[,!.]?\s*)?(?:here(?:'s| is| are)\b[^\n]*?(?:version|email|draft|rewrite|revision)[^\n]*?:|certainly[!.,][^\n]*)\s*\n+/i;
const SIGN_OFF_NOTE = /\n+(?:let me know if|i hope this helps|feel free to (?:adjust|tweak|edit))[^\n]*\s*$/i;

/**
 * Makes model-written email text read as a person typed it: no em dashes,
 * no invisible marker characters, straight quotes, three-dot ellipses, plain
 * spaces, no markdown emphasis, and no "Here is the polished version:" wrapper.
 */
export function withoutAiArtifacts(text: string): string {
  return withoutEmDashes(
    text
      .replace(INVISIBLE, "")
      .replace(STRAY_ZWJ, "")
      .replace(ODD_SPACE, " ")
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/\u2026/g, "...")
      // A hyphen look-alike between words or numbers is a plain hyphen.
      .replace(/(?<=\S)[\u2010\u2011\u2012](?=\S)/g, "-")
      .replace(/(\d)\s*\u2013\s*(\d)/g, "$1-$2")
      // Markdown emphasis does not render in a plain-text email.
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\r\n/g, "\n"),
  )
    .replace(PREAMBLE, "")
    .replace(SIGN_OFF_NOTE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

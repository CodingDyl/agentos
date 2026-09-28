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

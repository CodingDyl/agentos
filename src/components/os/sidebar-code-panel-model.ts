/**
 * The small editor that lives in the sidebar: snippets, typing, and the
 * reduced-motion static frame. Kept pure so the animation can be tested
 * without a DOM or timers.
 */

export type SyntaxKind = "keyword" | "ident" | "string" | "comment" | "punct" | "plain" | "type" | "fn";

export interface CodeToken {
  kind: SyntaxKind;
  text: string;
}

export interface CodeSnippet {
  filename: string;
  lines: CodeToken[][];
}

export interface CodeFrame {
  snippetIndex: number;
  lines: CodeToken[][];
  cursor: { line: number; column: number };
  done: boolean;
}

const kw = (text: string): CodeToken => ({ kind: "keyword", text });
const id = (text: string): CodeToken => ({ kind: "ident", text });
const str = (text: string): CodeToken => ({ kind: "string", text });
const cm = (text: string): CodeToken => ({ kind: "comment", text });
const p = (text: string): CodeToken => ({ kind: "punct", text });
const pl = (text: string): CodeToken => ({ kind: "plain", text });
const ty = (text: string): CodeToken => ({ kind: "type", text });
const fn = (text: string): CodeToken => ({ kind: "fn", text });

export const CODE_SNIPPETS: readonly CodeSnippet[] = [
  {
    filename: "today.ts",
    lines: [
      [kw("const"), pl(" queue "), p("="), pl(" "), kw("await"), pl(" "), fn("traction"), p("."), fn("today"), p("()")],
      [kw("if"), pl(" "), p("("), id("queue"), p("."), id("length"), p(")"), pl(" "), p("{")],
      [pl("  "), cm("// go get the next one")],
      [pl("  "), fn("run"), p("("), id("queue"), p("["), pl("0"), p("]"), p(")")],
      [p("}")],
    ],
  },
  {
    filename: "memory.ts",
    lines: [
      [kw("function"), pl(" "), fn("remember"), p("("), id("note"), p(":"), pl(" "), ty("string"), p(")"), pl(" "), p("{")],
      [pl("  "), id("vault"), p("."), fn("write"), p("("), id("note"), p(")")],
      [pl("  "), kw("return"), pl(" "), str("\"kept\"")],
      [p("}")],
    ],
  },
  {
    filename: "agentos.ts",
    lines: [
      [kw("type"), pl(" "), ty("Agent"), pl(" "), p("="), pl(" "), p("{")],
      [pl("  "), id("name"), p(":"), pl(" "), ty("string")],
      [pl("  "), id("state"), p(":"), pl(" "), str("\"ready\""), pl(" "), p("|"), pl(" "), str("\"running\"")],
      [p("}")],
    ],
  },
];

function lineText(tokens: readonly CodeToken[]): string {
  return tokens.map((token) => token.text).join("");
}

export function totalChars(lines: readonly CodeToken[][]): number {
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line, index) => sum + lineText(line).length + (index > 0 ? 1 : 0), 0);
}

export function sliceTokens(
  lines: readonly CodeToken[][],
  chars: number,
): { lines: CodeToken[][]; cursor: { line: number; column: number } } {
  if (chars <= 0 || lines.length === 0) return { lines: [], cursor: { line: 0, column: 0 } };

  const visible: CodeToken[][] = [];
  let remaining = chars;

  for (let index = 0; index < lines.length; index++) {
    if (index > 0) {
      remaining -= 1;
      if (remaining < 0) {
        const previous = visible[index - 1] ?? [];
        return { lines: visible, cursor: { line: index - 1, column: lineText(previous).length } };
      }
      visible.push([]);
      if (remaining === 0) return { lines: visible, cursor: { line: index, column: 0 } };
    } else {
      visible.push([]);
    }

    for (const token of lines[index]) {
      if (remaining >= token.text.length) {
        visible[index].push(token);
        remaining -= token.text.length;
        continue;
      }
      if (remaining > 0) visible[index].push({ kind: token.kind, text: token.text.slice(0, remaining) });
      return { lines: visible, cursor: { line: index, column: lineText(visible[index]).length } };
    }
  }

  const last = visible.length - 1;
  return { lines: visible, cursor: { line: last, column: lineText(visible[last] ?? []).length } };
}

export function frameAt(
  elapsedMs: number,
  options: { charMs: number; pauseMs: number; reducedMotion: boolean },
): CodeFrame {
  const first = CODE_SNIPPETS[0];
  const finished = (snippet: CodeSnippet, index: number): CodeFrame => {
    const last = snippet.lines.length - 1;
    return {
      snippetIndex: index,
      lines: snippet.lines.map((line) => [...line]),
      cursor: { line: Math.max(0, last), column: lineText(snippet.lines[last] ?? []).length },
      done: true,
    };
  };

  if (options.reducedMotion) return finished(first, 0);

  const durations = CODE_SNIPPETS.map((snippet) => totalChars(snippet.lines) * options.charMs + options.pauseMs);
  const cycle = durations.reduce((sum, duration) => sum + duration, 0);
  let remaining = cycle === 0 ? 0 : ((elapsedMs % cycle) + cycle) % cycle;
  let index = 0;
  while (index < durations.length - 1 && remaining >= durations[index]) {
    remaining -= durations[index];
    index += 1;
  }

  const snippet = CODE_SNIPPETS[index];
  const length = totalChars(snippet.lines);
  const typed = Math.min(length, Math.floor(remaining / options.charMs));
  const sliced = sliceTokens(snippet.lines, typed);
  return {
    snippetIndex: index,
    lines: sliced.lines,
    cursor: sliced.cursor,
    done: typed >= length,
  };
}

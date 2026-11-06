import type { ReviewVerdict } from "../../shared/website-rebuild-types";

/**
 * Reading what a reviewer and a worker wrote, so the stage can say it plainly.
 *
 * The review brief asks for a `Verdict:` line and `## Blocker` / `## Major` /
 * `## Minor` sections with numbered findings. Older reviews that put the
 * verdict in bold ("**Verdict: not yet ready for the client.**") read the same.
 */

const SEVERITY = { blocker: /^#{2,3}\s*blockers?\b/i, major: /^#{2,3}\s*majors?\b/i, minor: /^#{2,3}\s*minors?\b/i } as const;
type Severity = keyof typeof SEVERITY;

/** The body of each severity section: its lines up to the next heading of the same or higher level. */
function sections(markdown: string): Record<Severity, string[]> {
  const found: Record<Severity, string[]> = { blocker: [], major: [], minor: [] };
  let current: Severity | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line)) {
      current = (Object.keys(SEVERITY) as Severity[]).find((key) => SEVERITY[key].test(line.trim()));
      continue;
    }
    if (current) found[current].push(line);
  }
  return found;
}

/** Top-level findings: numbered items, or bullets when the reviewer used those instead. */
function countFindings(lines: readonly string[]): number {
  const numbered = lines.filter((line) => /^\d+[.)]\s+\S/.test(line)).length;
  if (numbered > 0) return numbered;
  return lines.filter((line) => /^[-*]\s+\S/.test(line) && !/^[-*]\s+_?none\b/i.test(line)).length;
}

export function parseReviewVerdict(markdown: string): ReviewVerdict {
  const found = sections(markdown);
  const verdictLine = markdown.split(/\r?\n/).find((line) => /verdict\s*:/i.test(line)) ?? "";
  // Only the verdict itself, not the reason after it: "Ready. Nothing is not covered" is still ready.
  const said = verdictLine.replace(/^.*?verdict\s*:\s*/i, "").replace(/[*`_]/g, "").split(/[.;:,(]|\s[-–—]\s/)[0];
  const ready = /\bnot\b/i.test(said) ? false : /\bready\b/i.test(said) ? true : null;
  return { ready, blockers: countFindings(found.blocker), majors: countFindings(found.major), minors: countFindings(found.minor) };
}

/** The Blocker and Major sections, for the next revision's brief. Minor findings are left to the reviewer's judgement. */
export function mustFixFindings(markdown: string, limit = 6000): string | undefined {
  const found = sections(markdown);
  const parts = [
    ["Blocker", found.blocker],
    ["Major", found.major],
  ].flatMap(([label, lines]) => {
    const body = (lines as string[]).join("\n").trim();
    return body && countFindings(lines as string[]) > 0 ? [`## ${label as string}\n\n${body}`] : [];
  });
  if (parts.length === 0) return undefined;
  const text = parts.join("\n\n");
  return text.length > limit ? `${text.slice(0, limit)}\n\n(The review continues in the repo.)` : text;
}

/** One sentence for a stage summary: what the reviewer concluded. */
export function describeVerdict(verdict: ReviewVerdict, reviewer: string): string {
  const counts = [
    verdict.blockers > 0 ? `${verdict.blockers} blocker${verdict.blockers === 1 ? "" : "s"}` : "",
    verdict.majors > 0 ? `${verdict.majors} major` : "",
    verdict.minors > 0 ? `${verdict.minors} minor` : "",
  ].filter(Boolean);
  const said = verdict.ready === true ? "ready for the client" : verdict.ready === false ? "not ready yet" : "no clear verdict";
  return `${reviewer} review: ${said}${counts.length > 0 ? ` (${counts.join(", ")})` : ""}.`;
}

export interface FeatureTally {
  pass: number;
  fail: number;
  blocked: number;
  /** Of the passes, how many work on sample data (demo mode). Demo working is a pass for the preview. */
  demo: number;
}

/**
 * The Status column of the worker's functionality table. Rows whose status is
 * none of Pass, Fail, Blocked or Demo are not counted: the person reads the report.
 * A pass whose Mode is Demo counts as a pass and as a demo.
 */
export function tallyFeatures(report: string): FeatureTally {
  const tally: FeatureTally = { pass: 0, fail: 0, blocked: 0, demo: 0 };
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith("|") && /\|\s*status\b/i.test(line));
  if (start < 0) return tally;
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const column = cells(lines[start]).findIndex((cell) => /^status\b/i.test(cell));
  const modeColumn = cells(lines[start]).findIndex((cell) => /^mode\b/i.test(cell));
  // Only this table: the next non-table line ends it, so a later table of checks is not counted.
  const end = lines.findIndex((line, index) => index > start && !line.trim().startsWith("|"));
  for (const row of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const value = (cells(row)[column] ?? "").replace(/[*_`]/g, "").toLowerCase();
    if (/^-+$|^:?-+:?$/.test(value)) continue;
    const mode = modeColumn < 0 ? "" : (cells(row)[modeColumn] ?? "").replace(/[*_`]/g, "").toLowerCase();
    // "Demo" or "Demo pass" in the status column is a pass on sample data too.
    if (value.startsWith("demo") || (value.startsWith("pass") && mode.startsWith("demo"))) {
      tally.pass += 1;
      tally.demo += 1;
    } else if (value.startsWith("pass")) tally.pass += 1;
    else if (value.startsWith("fail")) tally.fail += 1;
    else if (value.startsWith("blocked")) tally.blocked += 1;
  }
  return tally;
}

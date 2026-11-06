#!/usr/bin/env node
// Repo rules from CLAUDE.md that a script can check, so they do not depend on
// anyone remembering them. Pure functions first, then a CLI for CI and `npm run
// check:rules`.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @typedef {{ rule: string, file?: string, message: string }} RuleFailure */

const SECRET_PATTERN = /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|x-access-token:/;
const SECRET_EXEMPT = [/(^|\/)__tests__\//, /^e2e\/fixtures\//, /^scripts\/checks\/repo-rules\.mjs$/];
const SHELL_TRUE_ALLOWED = new Set(["server/workers/validation.ts", "server/visual-verification/preview.ts", "scripts/browser-check.mjs"]);
const TEST_FILE = /(^|\/)__tests__\/|\.test\.|\.spec\.|^e2e\//;

/** Tracked files that must never be in the repository. @returns {RuleFailure[]} */
export function checkTrackedFiles(paths) {
  const failures = [];
  for (const file of paths) {
    const base = file.split("/").pop() ?? "";
    if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base)) {
      failures.push({ rule: "env-file", file, message: `${file} is tracked. Env files hold secrets: remove it from git and keep it out of the repo.` });
    }
  }
  return failures;
}

/**
 * Rules about what a change adds.
 * @param {{ added: Array<{ file: string, line: string }>, addedFiles: string[], allFiles: string[], branch?: string, prBody?: string }} diff
 * @returns {RuleFailure[]}
 */
export function checkDiff(diff) {
  const failures = [];

  for (const { file, line } of diff.added) {
    if (!SECRET_EXEMPT.some((pattern) => pattern.test(file)) && SECRET_PATTERN.test(line)) {
      failures.push({ rule: "secret", file, message: `${file} adds something shaped like a credential. Secrets stay server-side and out of git.` });
    }
    if (/shell:\s*true/.test(line) && !SHELL_TRUE_ALLOWED.has(file)) {
      failures.push({ rule: "shell-true", file, message: `${file} adds "shell: true". Run commands with execFile/spawn and an argument array.` });
    }
  }

  for (const file of diff.addedFiles) {
    const module = /^server\/([^/]+)\/([^/]+)\.ts$/.exec(file);
    if (module && !file.endsWith(".d.ts") && !["index", "types"].includes(module[2])) {
      const [, feature, name] = module;
      const testsDir = `server/${feature}/__tests__/`;
      const covered =
        diff.addedFiles.some((other) => other.startsWith(testsDir)) ||
        diff.allFiles.some((other) => other.startsWith(testsDir) && new RegExp(`(^|[/.-])${name}([.-][^/]*)?\\.test\\.ts$`).test(other));
      if (!covered) {
        failures.push({ rule: "module-needs-test", file, message: `${file} is a new server module with no test. Add one under ${testsDir}.` });
      }
    }

    if (/^server\/.*\.ts$/.test(file) && !TEST_FILE.test(file)) {
      const lines = diff.added.filter((entry) => entry.file === file).map((entry) => entry.line);
      const hasWrite = lines.some((line) => /\.(post|put|patch)\(/.test(line));
      const parses = lines.some((line) => /\.(parse|safeParse)\(/.test(line));
      if (hasWrite && !parses) {
        failures.push({ rule: "route-needs-zod", file, message: `${file} adds a write route without parsing the body. Validate every route body with zod.` });
      }
    }
  }

  if (diff.branch?.startsWith("fix/")) {
    const touched = [...diff.added.map((entry) => entry.file), ...diff.addedFiles];
    const hasTest = touched.some((file) => TEST_FILE.test(file));
    const excused = (diff.prBody ?? "").split(/\r?\n/).some((line) => line.startsWith("Not testable:"));
    if (!hasTest && !excused) {
      failures.push({
        rule: "fix-needs-test",
        message: `${diff.branch} is a fix but changes no test. Add a test that fails without the fix, or put a "Not testable: <why>" line in the PR description.`,
      });
    }
  }

  return failures;
}

/** Added lines from `git diff --unified=0`, with their file. */
export function parseUnifiedDiff(text) {
  const added = [];
  let file;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      file = target === "/dev/null" ? undefined : target.replace(/^b\//, "");
    } else if (raw.startsWith("+") && file) {
      added.push({ file, line: raw.slice(1) });
    }
  }
  return added;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const failures = checkTrackedFiles(git("ls-files").split("\n").filter(Boolean));

  // A push to production has already been reviewed in its PR: check only what is tracked.
  const onProductionPush = event === "push";
  if (!onProductionPush) {
    const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/production";
    const range = `${base}...HEAD`;
    failures.push(
      ...checkDiff({
        added: parseUnifiedDiff(git("diff", "--unified=0", "--no-color", range)),
        addedFiles: git("diff", "--name-only", "--diff-filter=A", range).split("\n").filter(Boolean),
        allFiles: git("ls-files").split("\n").filter(Boolean),
        branch: process.env.GITHUB_HEAD_REF || git("branch", "--show-current").trim() || undefined,
        prBody: process.env.PR_BODY,
      }),
    );
  }

  for (const failure of failures) console.error(`[${failure.rule}] ${failure.message}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} repo rule${failures.length === 1 ? "" : "s"} broken.`);
    return 1;
  }
  console.log("Repo rules: all clear.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

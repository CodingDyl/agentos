#!/usr/bin/env node
// PreToolUse hook for Bash: refuses the commands CLAUDE.md says to ask the
// owner about, so the rule does not depend on a model remembering it.
//
// A block exits 2 and writes the reason to stderr. Everything else, including
// malformed input or a crash in this script, fails open (exit 0): a broken
// guard must never stop all work. The one exception is `gh pr merge`, which
// fails closed: if the checks cannot be read, the merge is not allowed.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Splits a command into segments of tokens, the way a shell would, enough to
 * tell a command from text that only mentions one. Quoted text stays inside
 * its token, heredoc bodies are skipped, and `&&`, `||`, `;`, `|`, `&` and
 * newlines end a segment.
 */
function lex(command) {
  const segments = [];
  let tokens = [];
  let token = "";
  let inToken = false;
  const pendingHeredocs = [];

  const endToken = () => {
    if (inToken) tokens.push(token);
    token = "";
    inToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i];

    if (ch === "\n") {
      endSegment();
      i += 1;
      // Skip each heredoc body up to its delimiter line.
      while (pendingHeredocs.length > 0) {
        const { delimiter, stripTabs } = pendingHeredocs.shift();
        while (i < command.length) {
          let end = command.indexOf("\n", i);
          if (end === -1) end = command.length;
          let line = command.slice(i, end);
          i = Math.min(end + 1, command.length);
          if (stripTabs) line = line.replace(/^\t+/, "");
          if (line === delimiter) break;
        }
      }
      continue;
    }

    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      token += command.slice(i + 1, stop);
      inToken = true;
      i = stop + 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length) j += 1;
        token += command[j];
        j += 1;
      }
      inToken = true;
      i = j + 1;
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      token += command[i + 1];
      inToken = true;
      i += 2;
      continue;
    }

    if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const match = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>]+))/.exec(command.slice(i));
      if (match) {
        pendingHeredocs.push({ delimiter: match[2] ?? match[3] ?? match[4], stripTabs: match[1] === "-" });
        endToken();
        i += match[0].length;
        continue;
      }
    }

    if (ch === ";" || ch === "|" || ch === "&") {
      endSegment();
      i += 1;
      while (i < command.length && (command[i] === ch) && ch !== ";") i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      endToken();
      i += 1;
      continue;
    }

    token += ch;
    inToken = true;
    i += 1;
  }
  endSegment();
  return segments;
}

const isFlag = (token) => token.startsWith("-");
const isShortFlagWith = (token, letter) => /^-[a-zA-Z]+$/.test(token) && !token.startsWith("--") && token.includes(letter);

/** The git subcommand and its arguments, past env assignments and global options. */
function gitCall(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  if (tokens[i] !== "git") return undefined;
  i += 1;
  while (i < tokens.length && isFlag(tokens[i])) {
    i += tokens[i] === "-C" || tokens[i] === "-c" ? 2 : 1;
  }
  if (i >= tokens.length) return undefined;
  return { sub: tokens[i], args: tokens.slice(i + 1) };
}

const isEnvFile = (token) => {
  const base = token.split("/").pop() ?? "";
  return /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base);
};

function blockForGit({ sub, args }) {
  switch (sub) {
    case "push": {
      for (const arg of args) {
        if (arg === "--force" || arg.startsWith("--force-with-lease") || isShortFlagWith(arg, "f")) {
          return "Force-pushing is not allowed without the owner's say-so.";
        }
        if (arg === "--delete" || arg === "--mirror" || isShortFlagWith(arg, "d")) {
          return "Deleting remote branches is not allowed without the owner's say-so.";
        }
        if (!isFlag(arg) && (arg.startsWith("+") || arg.startsWith(":"))) {
          return "A force or delete refspec (+branch or :branch) is not allowed without the owner's say-so.";
        }
      }
      return undefined;
    }
    case "branch":
      if (args.includes("-D") || (args.includes("--delete") && (args.includes("--force") || args.includes("-f")))) {
        return "Force-deleting a branch is not allowed without the owner's say-so.";
      }
      return undefined;
    case "rebase":
      return "Rewriting history with rebase is not allowed without the owner's say-so.";
    case "reset":
      return args.includes("--hard") ? "git reset --hard throws work away and is not allowed without the owner's say-so." : undefined;
    case "filter-branch":
    case "filter-repo":
      return "Rewriting history is not allowed without the owner's say-so.";
    case "add":
      return args.some((arg) => !isFlag(arg) && isEnvFile(arg)) ? "Never stage .env files: they hold secrets." : undefined;
    case "remote":
      return args.some((arg) => /^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i.test(arg))
        ? "Never put a credential in a git remote URL."
        : undefined;
    default:
      return undefined;
  }
}

/** `gh pr checks`, run safely. Anything other than all-passing is not green. */
function defaultPrChecks(args) {
  return new Promise((resolve) => {
    execFile("gh", args, { timeout: 20_000 }, (error) => resolve(error ? "not-green" : "green"));
  });
}

/**
 * Decides whether a Bash command may run.
 *
 * @param {string} command
 * @param {{ prChecks?: (args: string[]) => Promise<"green" | "not-green"> }} [deps]
 * @returns {Promise<{ allow: true } | { allow: false, reason: string }>}
 */
export async function decideBash(command, deps = {}) {
  const prChecks = deps.prChecks ?? defaultPrChecks;

  for (const tokens of lex(command)) {
    const git = gitCall(tokens);
    if (git) {
      const reason = blockForGit(git);
      if (reason) return { allow: false, reason };
      continue;
    }

    if (tokens[0] === "gh" && tokens[1] === "pr" && tokens[2] === "merge") {
      const target = tokens.slice(3).find((token) => !isFlag(token));
      const args = target ? ["pr", "checks", target] : ["pr", "checks"];
      let verdict;
      try {
        verdict = await prChecks(args);
      } catch {
        verdict = "not-green";
      }
      if (verdict !== "green") {
        return { allow: false, reason: "Not every check on this pull request is green (or they could not be read), so it cannot be merged." };
      }
    }
  }

  return { allow: true };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let command;
  try {
    const input = JSON.parse(await readStdin());
    if (input?.tool_name && input.tool_name !== "Bash") return 0;
    command = input?.tool_input?.command;
  } catch {
    return 0;
  }
  if (typeof command !== "string" || command.length === 0) return 0;

  let decision;
  try {
    decision = await decideBash(command);
  } catch {
    return 0;
  }
  if (decision.allow) return 0;
  process.stderr.write(`${decision.reason}\nAsk the owner before working around this.\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}

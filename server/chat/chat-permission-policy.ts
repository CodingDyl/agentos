import path from "node:path";

/**
 * What a chat may do without asking, and what it must stop and ask about.
 *
 * The operator chose "full access, approve risky": read anything, change the
 * AgentOS project freely, and ask before anything that deletes, pushes,
 * installs, touches a secret, or reaches outside the project.
 *
 * It is an allowlist, deliberately. A denylist of dangerous commands is a
 * list of the ways someone already thought of; anything this does not
 * recognise as safe is asked about, so a new tool or an unusual command can
 * never slip through on the strength of not being on a list. The cost is a
 * few more prompts, and the operator can always say yes.
 */

export type PolicyDecision = { decision: "allow" } | { decision: "ask"; reason: string };

export interface PolicyContext {
  /** The AgentOS repository: edits inside it are routine. */
  projectRoot: string;
}

const ALLOW: PolicyDecision = { decision: "allow" };
const ask = (reason: string): PolicyDecision => ({ decision: "ask", reason });

/** Tools that only look. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "BashOutput",
  "TaskOutput",
  "ExitPlanMode",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
]);

/** Tools that hand work to a sub-agent or a skill, whose own tool calls come back through this policy. */
const DELEGATING_TOOLS = new Set(["Task", "Agent", "Skill"]);

/** Tools that write one file, named by `file_path` or `notebook_path`. */
const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Files whose contents are credentials. Reading one is asked about even
 * though reading is otherwise free: the risk is not the read but what a
 * hijacked prompt does with the result.
 */
const SECRET_PATH =
  /(^|[\\/])(\.env(\.[^\\/]*)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|credentials(\.json)?|\.git-credentials)$|[\\/]\.(ssh|aws|gnupg|kube|docker)[\\/]|[\\/]Keychains?[\\/]/i;

export function isSecretPath(file: string): boolean {
  return SECRET_PATH.test(file);
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(root, file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Commands that only read, by first word. Subcommands are checked separately
 * for the few programs that can also write (git, npm).
 */
const READ_ONLY_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "find", "fd", "file", "stat", "du", "df",
  "echo", "printf", "which", "whoami", "date", "uname", "sort", "cut", "tr", "diff", "jq",
  "basename", "dirname", "realpath", "true",
]);

/**
 * Flags that turn an otherwise read-only program into one that writes a file
 * or runs another program. Not on the list at all, for the same reason:
 * `env`, `xargs`, `uniq` (its second argument is an output file), `tree -o`.
 */
const UNSAFE_FLAGS: Record<string, RegExp> = {
  find: /\s-(delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/,
  fd: /\s(-x|-X|--exec|--exec-batch)\b/,
  rg: /\s--pre\b/,
  sort: /\s(-o\b|--output)/,
  git: /\s--output\b|\s--ext-diff\b/,
};

const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "blame", "remote", "describe", "shortlog", "grep"]);

/** npm scripts that check rather than change. `npm run <anything>` is not this. */
const READ_ONLY_NPM_SCRIPTS = new Set(["lint", "typecheck", "test", "build"]);

const READ_ONLY_NPX = new Set(["tsc", "eslint", "vitest", "prettier"]);

/** A word that means "this runs something else", which the first-word check cannot see into. */
const ESCAPES = /\$\(|`|<\(|>\(/;

/** Any redirection that writes a file. `2>&1` and `> /dev/null` write nothing anyone keeps. */
function writesAFile(command: string): boolean {
  const stripped = command.replace(/\d?>&\d/g, "").replace(/\d?>>?\s*\/dev\/null/g, "");
  return /(^|[^<])>/.test(stripped);
}

function segmentIsReadOnly(segment: string): boolean {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  // Leading `VAR=value` assignments change the environment of what follows, not what it is.
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();

  const [program, sub, third] = words;
  if (!program) return true;
  if (UNSAFE_FLAGS[program]?.test(` ${words.slice(1).join(" ")}`)) return false;

  if (program === "git") return sub !== undefined && READ_ONLY_GIT.has(sub) && !(sub === "branch" && /\s-[dDmM]\b/.test(segment)) && !(sub === "remote" && third !== undefined && third !== "-v");
  if (program === "npm") return (sub === "test" || (sub === "run" && third !== undefined && READ_ONLY_NPM_SCRIPTS.has(third)) || sub === "ls" || sub === "view");
  if (program === "npx") return sub !== undefined && READ_ONLY_NPX.has(sub) && !/\s--(fix|write)\b/.test(segment);
  if (program === "node") return sub === "--version" || sub === "-v";

  return READ_ONLY_COMMANDS.has(program);
}

export function classifyBashCommand(command: string): PolicyDecision {
  const trimmed = command.trim();
  if (!trimmed) return ALLOW;

  if (/(^|[\s;&|])sudo\b/.test(trimmed)) return ask("Runs a command as administrator (sudo).");
  if (ESCAPES.test(trimmed)) return ask("Runs a command built from another command's output, which can't be checked in advance.");
  if (writesAFile(trimmed)) return ask("Writes a file through a shell redirect.");

  // Every piece of a pipeline or chain has to be safe on its own.
  const segments = trimmed.split(/&&|\|\||;|\||\n/);
  const unsafe = segments.find((segment) => !segmentIsReadOnly(segment));
  if (unsafe !== undefined) {
    const program = unsafe.trim().split(/\s+/)[0] ?? "";
    return ask(`Runs ${program}, which isn't on the read-only list.`);
  }

  return ALLOW;
}

function filePathOf(input: Record<string, unknown>): string | undefined {
  const value = input.file_path ?? input.notebook_path ?? input.path;
  return typeof value === "string" ? value : undefined;
}

export function decideToolUse(toolName: string, input: Record<string, unknown>, context: PolicyContext): PolicyDecision {
  if (READ_ONLY_TOOLS.has(toolName)) {
    const file = filePathOf(input);
    if (file && isSecretPath(file)) return ask("Reads a file that holds credentials.");
    return ALLOW;
  }

  if (DELEGATING_TOOLS.has(toolName)) return ALLOW;

  if (FILE_WRITE_TOOLS.has(toolName)) {
    const named = filePathOf(input);
    if (!named) return ask("Writes a file it didn't name.");
    // Relative paths are relative to the chat's working directory, the project.
    const file = path.resolve(context.projectRoot, named);
    if (isSecretPath(file)) return ask("Changes a file that holds credentials.");
    if (!isInside(context.projectRoot, file)) return ask("Changes a file outside the AgentOS project.");
    if (isInside(path.join(context.projectRoot, ".git"), file)) return ask("Changes git's own records directly.");
    return ALLOW;
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    return classifyBashCommand(command);
  }

  // Stops a background command this chat started: undoing its own work.
  if (toolName === "KillShell" || toolName === "KillBash" || toolName === "TaskStop") return ALLOW;

  if (toolName.startsWith("mcp__")) return ask("Uses an external connector, which can act outside this machine.");

  return ask(`Uses ${toolName}, which AgentOS doesn't recognise as safe.`);
}

/** One line for the screen: the command, the file, or the query. */
export function summariseToolInput(toolName: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };

  const detail =
    toolName === "Bash"
      ? pick("command")
      : pick("file_path", "notebook_path", "path", "pattern", "url", "query", "description", "prompt", "skill");

  const line = (detail ?? "").split("\n")[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/**
 * A file change, from an agent that names files rather than tools (Codex).
 * Every file has to pass on its own; one outside the project is enough to ask.
 */
export function decideFileChanges(paths: readonly string[], context: PolicyContext): PolicyDecision {
  if (paths.length === 0) return ask("Changes files it didn't name.");
  for (const file of paths) {
    const verdict = decideToolUse("Edit", { file_path: file }, context);
    if (verdict.decision === "ask") return verdict;
  }
  return ALLOW;
}

/** What an ACP agent (Gemini CLI, Hermes) says it is about to do. */
export interface AcpToolCall {
  kind?: string | null;
  title?: string | null;
  locations?: ReadonlyArray<{ path: string }> | null;
  rawInput?: unknown;
}

function commandOf(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object") return undefined;
  const input = rawInput as Record<string, unknown>;
  const value = input.command ?? input.cmd ?? input.script;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join(" ");
  return undefined;
}

/**
 * The same rules, read from ACP's tool kinds. Deleting and moving always ask:
 * the operator listed deleting as risky in itself, and a move is a delete of
 * the old path.
 */
export function decideAcpToolCall(call: AcpToolCall, context: PolicyContext): PolicyDecision {
  const paths = (call.locations ?? []).map((location) => location.path).filter(Boolean);

  switch (call.kind) {
    case "read":
    case "search":
    case "fetch":
    case "think":
      if (paths.some(isSecretPath)) return ask("Reads a file that holds credentials.");
      return ALLOW;
    case "edit":
      return decideFileChanges(paths, context);
    case "delete":
      return ask("Deletes files.");
    case "move":
      return ask("Moves or renames files.");
    case "execute": {
      const command = commandOf(call.rawInput);
      return command === undefined ? ask("Runs a command it didn't show.") : classifyBashCommand(command);
    }
    default:
      return ask(`Uses ${call.title ?? call.kind ?? "a tool"}, which AgentOS doesn't recognise as safe.`);
  }
}

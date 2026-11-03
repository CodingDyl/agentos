import { execFileSync } from "node:child_process";

/**
 * Who AgentOS commits as.
 *
 * Vercel only builds a private repo's commit when its author is a member of
 * the Vercel team; anyone else gets `BLOCKED` (COMMIT_AUTHOR_REQUIRED). So
 * commits AgentOS makes carry the owner's own identity, not a placeholder:
 * `AGENTOS_GIT_AUTHOR_NAME` / `AGENTOS_GIT_AUTHOR_EMAIL` when set, otherwise
 * the global git `user.name` / `user.email`. The placeholder is only the last
 * resort, so a machine with no git identity can still commit.
 */

export const FALLBACK_AUTHOR = { name: "AgentOS", email: "agentos@localhost" } as const;

export interface GitAuthor {
  name: string;
  email: string;
}

function globalConfig(key: string): string | undefined {
  try {
    const value = execFileSync("git", ["config", "--global", "--get", key], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

let cached: GitAuthor | undefined;

export function gitAuthor(): GitAuthor {
  if (cached) return cached;
  const name = process.env.AGENTOS_GIT_AUTHOR_NAME?.trim() || globalConfig("user.name");
  const email = process.env.AGENTOS_GIT_AUTHOR_EMAIL?.trim() || globalConfig("user.email");
  cached = name && email ? { name, email } : { ...FALLBACK_AUTHOR };
  return cached;
}

/** `-c user.name=… -c user.email=…`, to put before a git subcommand that writes a commit. */
export function gitAuthorArgs(): string[] {
  const author = gitAuthor();
  return ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`];
}

/** Tests change the environment; this makes the next call read it again. */
export function resetGitAuthorForTests(): void {
  cached = undefined;
}

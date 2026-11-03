import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FALLBACK_AUTHOR, gitAuthor, gitAuthorArgs, resetGitAuthorForTests } from "../git-author";

const KEYS = ["AGENTOS_GIT_AUTHOR_NAME", "AGENTOS_GIT_AUTHOR_EMAIL", "GIT_CONFIG_GLOBAL"] as const;

describe("the identity AgentOS commits as", () => {
  let saved: Partial<Record<(typeof KEYS)[number], string>>;
  let dir: string;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-author-"));
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, "gitconfig");
    resetGitAuthorForTests();
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
    resetGitAuthorForTests();
  });

  it("uses the owner's global git identity, so Vercel recognises the commit author", () => {
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL!, "[user]\n\tname = Dylan Petzer\n\temail = 1+owner@users.noreply.github.com\n");
    assert.deepEqual(gitAuthor(), { name: "Dylan Petzer", email: "1+owner@users.noreply.github.com" });
    assert.deepEqual(gitAuthorArgs(), ["-c", "user.name=Dylan Petzer", "-c", "user.email=1+owner@users.noreply.github.com"]);
  });

  it("prefers the AGENTOS_GIT_AUTHOR_* settings over git config", () => {
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL!, "[user]\n\tname = Someone\n\temail = someone@example.com\n");
    process.env.AGENTOS_GIT_AUTHOR_NAME = "Owner";
    process.env.AGENTOS_GIT_AUTHOR_EMAIL = "owner@example.com";
    assert.deepEqual(gitAuthor(), { name: "Owner", email: "owner@example.com" });
  });

  it("falls back to the AgentOS placeholder when no identity is configured", () => {
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL!, "");
    assert.deepEqual(gitAuthor(), FALLBACK_AUTHOR);
  });

  it("does not mix a configured name with a missing email", () => {
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL!, "[user]\n\tname = Dylan Petzer\n");
    assert.deepEqual(gitAuthor(), FALLBACK_AUTHOR);
  });
});

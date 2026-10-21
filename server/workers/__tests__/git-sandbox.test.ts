import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codexSandboxFlags, geminiIncludeFlags } from "../git-sandbox";
import { judgeImplementationAttempt, baselineValidation } from "../attempt-honesty";
import { preflightMessage } from "../preflight";
import { detectPackageManager } from "../worktree-deps";

describe("sandbox flags for git metadata outside the worktree", () => {
  it("passes the gitdir and common dir as Codex writable roots", () => {
    const flags = codexSandboxFlags("/tmp/worktrees/job_1", [
      "/Volumes/DylanSSD/AgentOS/.git/worktrees/job_1",
      "/Volumes/DylanSSD/AgentOS/.git",
    ]);

    assert.ok(flags.includes("--add-dir"));
    assert.ok(flags.includes("/Volumes/DylanSSD/AgentOS/.git/worktrees/job_1"));
    assert.ok(flags.includes("/Volumes/DylanSSD/AgentOS/.git"));
    const config = flags[flags.indexOf("-c") + 1];
    assert.match(config, /sandbox_workspace_write.writable_roots=/);
    assert.match(config, /worktrees\/job_1/);
  });

  it("does not re-add the worktree itself", () => {
    const flags = codexSandboxFlags("/tmp/wt", ["/tmp/wt", "/tmp/wt/.git"]);
    assert.equal(flags.includes("/tmp/wt"), false);
    assert.ok(flags.includes("/tmp/wt/.git"));
  });

  it("hands Gemini the extra directories it may read", () => {
    assert.deepEqual(geminiIncludeFlags(["/gitdir", "/common"]), [
      "--include-directories",
      "/gitdir,/common",
    ]);
    assert.deepEqual(geminiIncludeFlags([]), []);
  });
});

describe("implementation attempts that changed nothing", () => {
  it("fails a coding job with an empty diff and skips build checks", () => {
    const judged = judgeImplementationAttempt({
      worktreePath: "/tmp/wt",
      changedFiles: [],
      implementsCode: true,
    });

    assert.equal(judged.failed, true);
    assert.equal(judged.skipValidation, true);
    assert.match(judged.detail, /no file changes/);
    assert.match(judged.blocker ?? "", /baseline/);
  });

  it("does not fail a simulated worker, or a text job with no worktree", () => {
    assert.equal(
      judgeImplementationAttempt({
        simulated: true,
        worktreePath: "/tmp/wt",
        changedFiles: [],
        implementsCode: true,
      }).failed,
      false,
    );
    assert.equal(
      judgeImplementationAttempt({
        worktreePath: undefined,
        changedFiles: [],
        implementsCode: false,
      }).failed,
      false,
    );
  });

  it("passes a coding job that actually changed files", () => {
    const judged = judgeImplementationAttempt({
      worktreePath: "/tmp/wt",
      changedFiles: ["src/page.tsx"],
      implementsCode: true,
    });
    assert.equal(judged.failed, false);
    assert.equal(judged.skipValidation, false);
    assert.match(judged.detail, /1 file/);
  });

  it("labels a baseline check so it cannot read as PASS", () => {
    const row = baselineValidation("npm run build");
    assert.equal(row.success, false);
    assert.match(row.detail ?? "", /baseline \(no changes\)/);
  });
});

describe("preflight copy", () => {
  it("joins fixable sentences", () => {
    assert.match(
      preflightMessage([
        { code: "deps_missing", message: "Dependencies are not installed in the worktree." },
        { code: "git_not_writable", message: "Git metadata is not writable." },
      ]),
      /Dependencies[\s\S]*Git metadata/,
    );
  });
});

describe("package manager detection", () => {
  it("prefers the lockfile that is present", () => {
    assert.equal(detectPackageManager(".", ["pnpm-lock.yaml", "package.json"]), "pnpm");
    assert.equal(detectPackageManager(".", ["yarn.lock"]), "yarn");
    assert.equal(detectPackageManager(".", ["bun.lockb"]), "bun");
    assert.equal(detectPackageManager(".", ["package-lock.json"]), "npm");
    assert.equal(detectPackageManager(".", ["package.json"]), "npm");
  });
});

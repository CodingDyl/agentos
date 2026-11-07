import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideBash } from "../../../scripts/hooks/guard-bash.mjs";

describe("decideBash", () => {
  it("blocks the commands CLAUDE.md says to ask about", async () => {
    for (const blocked of [
      "git push --force origin production", "git push -f", "git push --force-with-lease",
      "git push origin +feature", "git push origin --delete old", "git push origin :old",
      "git branch -D old", "git rebase production", "git reset --hard HEAD~1",
      "git filter-branch --all", "git add .env", "git add .env.local",
      "git fetch && git push --force", "git remote set-url origin https://abc123@github.com/x/y.git",
    ]) assert.equal((await decideBash(blocked)).allow, false, blocked);
  });

  it("lets ordinary commands through, including ones that only mention a banned command", async () => {
    for (const allowed of [
      'git commit -m "never git rebase or git push --force here"',
      "git add .env.example", "git push -u origin feat/x", "npm test", "git branch -d merged",
      "git commit -F- <<'EOF'\ngit reset --hard is banned\nEOF",
    ]) assert.equal((await decideBash(allowed)).allow, true, allowed);
  });

  it("explains a block, and tells the agent to ask the owner", async () => {
    const decision = await decideBash("git push --force");
    assert.equal(decision.allow, false);
    if (!decision.allow) assert.match(decision.reason, /force/i);
  });

  it("allows a merge only when every check is green, and fails closed", async () => {
    assert.equal((await decideBash("gh pr merge 12 --merge", { prChecks: async () => "not-green" })).allow, false);
    assert.equal((await decideBash("gh pr merge 12 --merge", { prChecks: async () => "green" })).allow, true);
    assert.equal((await decideBash("gh pr merge 12 --merge", { prChecks: async () => { throw new Error("gh missing"); } })).allow, false);
  });

  it("asks about the PR it was given, not whichever branch is checked out", async () => {
    let asked: string[] = [];
    await decideBash("gh pr merge 12 --merge", { prChecks: async (args) => { asked = args; return "green"; } });
    assert.deepEqual(asked, ["pr", "checks", "12"]);
  });
});

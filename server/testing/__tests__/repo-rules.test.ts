import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDiff, checkTrackedFiles, parseUnifiedDiff, type RuleDiff } from "../../../scripts/checks/repo-rules.mjs";

const diff = (overrides: Partial<RuleDiff> = {}): RuleDiff => ({ added: [], addedFiles: [], allFiles: [], ...overrides });
const rules = (failures: Array<{ rule: string }>) => failures.map((failure) => failure.rule);
// Built at runtime so this file never contains a token-shaped string.
const githubToken = `ghp_${"a".repeat(36)}`;

describe("env-file", () => {
  it("fails a tracked .env file and passes the example", () => {
    assert.deepEqual(rules(checkTrackedFiles([".env.production"])), ["env-file"]);
    assert.deepEqual(checkTrackedFiles([".env.example", "server/.env.sample"]), []);
  });
});

describe("secret", () => {
  it("fails an added line with a token-shaped string", () => {
    for (const line of [`const t = "${githubToken}";`, `x = "github_pat_${"1".repeat(20)}"`, `k = "${"sk-" + "ant-"}abc"`, `url = "${"x-access-" + "token:"}abc@github.com"`]) {
      assert.deepEqual(rules(checkDiff(diff({ added: [{ file: "server/a.ts", line }] }))), ["secret"], line);
    }
  });
  it("exempts tests, e2e fixtures and the rule file itself", () => {
    for (const file of ["server/x/__tests__/a.test.ts", "e2e/fixtures/vault/a.md", "scripts/checks/repo-rules.mjs"]) {
      assert.deepEqual(checkDiff(diff({ added: [{ file, line: githubToken }] })), [], file);
    }
  });
});

describe("shell-true", () => {
  it("fails an added shell: true, except in the three known files", () => {
    const line = "spawn(cmd, { shell: true });";
    assert.deepEqual(rules(checkDiff(diff({ added: [{ file: "server/a/run.ts", line }] }))), ["shell-true"]);
    for (const file of ["server/workers/validation.ts", "server/visual-verification/preview.ts", "scripts/browser-check.mjs"]) {
      assert.deepEqual(checkDiff(diff({ added: [{ file, line }] })), [], file);
    }
  });
});

describe("module-needs-test", () => {
  it("fails a new server module with no test", () => {
    const failures = checkDiff(diff({ addedFiles: ["server/thing/x.ts"], allFiles: ["server/thing/x.ts"] }));
    assert.deepEqual(rules(failures), ["module-needs-test"]);
  });
  it("passes when a test is added in the same feature, or one already names the module", () => {
    assert.deepEqual(checkDiff(diff({ addedFiles: ["server/thing/x.ts", "server/thing/__tests__/any.test.ts"] })), []);
    assert.deepEqual(checkDiff(diff({ addedFiles: ["server/thing/x.ts"], allFiles: ["server/thing/__tests__/x.test.ts"] })), []);
  });
});

describe("route-needs-zod", () => {
  const route = (extra: string[] = []) =>
    diff({
      addedFiles: ["server/thing/__tests__/r.test.ts", "server/thing/routes.ts"],
      added: [{ file: "server/thing/routes.ts", line: 'router.post("/x", (req, res) => {' }, ...extra.map((line) => ({ file: "server/thing/routes.ts", line }))],
    });
  it("fails a new route file that never parses its body", () => {
    assert.deepEqual(rules(checkDiff(route())), ["route-needs-zod"]);
  });
  it("passes once it parses", () => {
    assert.deepEqual(checkDiff(route(["const body = Schema.parse(req.body);"])), []);
    assert.deepEqual(checkDiff(route(["const body = Schema.safeParse(req.body);"])), []);
  });
});

describe("fix-needs-test", () => {
  it("fails a fix/ branch with no test in the diff", () => {
    assert.deepEqual(rules(checkDiff(diff({ branch: "fix/thing", added: [{ file: "server/a.ts", line: "x" }] }))), ["fix-needs-test"]);
  });
  it("passes with a test, with a Not testable line, or on another branch", () => {
    assert.deepEqual(checkDiff(diff({ branch: "fix/thing", added: [{ file: "server/a/__tests__/a.test.ts", line: "x" }] })), []);
    assert.deepEqual(checkDiff(diff({ branch: "fix/thing", addedFiles: ["e2e/a.spec.ts"] })), []);
    assert.deepEqual(checkDiff(diff({ branch: "fix/thing", prBody: "## What\nNot testable: copy change only" })), []);
    assert.deepEqual(checkDiff(diff({ branch: "feat/thing" })), []);
  });
});

describe("parseUnifiedDiff", () => {
  it("returns added lines with their file", () => {
    const text = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,0 +2,2 @@", "+one", "+two", "-gone"].join("\n");
    assert.deepEqual(parseUnifiedDiff(text), [{ file: "a.ts", line: "one" }, { file: "a.ts", line: "two" }]);
  });
});

# Outcomes, Regressions and Memory Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan workstream by workstream. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentOS able to answer three questions with evidence: did agent work earn money, did a correction stay fixed, and which memory is right.

**Architecture:** Six small workstreams, each its own PR into `production`. They extend what already exists (friction inbox, business ledger, usage database, Compass, job store, vault policy) rather than adding parallel systems. Anything that spends money or sends data stays manual.

**Tech Stack:** TypeScript, Express, zod, React, node:test, Playwright, GitHub Actions, Claude Code hooks, Promptfoo in its own package.

**Spec:** The owner's research findings, reproduced in Part 1.

---

## Part 1: Task breakdown

### The findings against what exists today

| Finding | Already there | Real gap | Workstream |
|---|---|---|---|
| Measure agent work against paid results, owner hours and R100k | Ledger payments, usage by project, job records, Compass G1 with its target | Nothing joins them. Owner hours aren't recorded anywhere. | D |
| Every correction becomes a regression test | Friction inbox, 25 mail corrections, worker reject and revise | Corrections vanish into job history, and nothing asks for a test | E |
| Playwright checks in CI | 72 browser tests that run only by hand | No CI job, and 7 tests already fail on `production` unnoticed | A |
| Decide what Honcho, the vault and Notion own | `me/MEMORY_POLICY.md` in the vault | No ownership or conflict rule. Policy says archive is never loaded by default, but `retrieval.ts` only discounts it. The 30-day log archive isn't built. | C |
| Skills with deterministic hooks | Worker validation, global personal hooks | Repo rules in `CLAUDE.md` rely on the model remembering them. No committed `.claude/settings.json`. | B |
| Promptfoo or Langfuse evals | Nothing | No way to tell whether an agent change helped | F |
| Curated file memory beside Honcho or Mem0 | The vault, proposal gate and Claude's file memory already do this | Only the ownership rule is missing | C |

### Decisions already made

- **Promptfoo, not Langfuse.** It runs locally with no server. Langfuse would store prompts and responses, which `server/usage/db.ts` deliberately refuses to do.
- **Promptfoo gets its own `evals/` package.** It is about 33 MB with 76 direct dependencies, and the root tree has just been cleared of audit findings.
- **Mem0 is not adopted.** The vault plus the `Remember:` proposal gate is already curated file memory.
- **Corrections extend the friction inbox.** A second inbox would be the kind of duplicate `CLAUDE.md` warns about.
- **The repo is public.** Real mail, client names and corrections never get committed. CI uses synthetic data only. Real data stays in `~/.agentos-ui`.
- **Live evals are never in CI.** They need a key and spend credits, so CI tests only the plumbing.
- **Memory ownership defaults** are in Workstream C. The owner can change them by editing one table.

### Order

A → B → C → D → E → F. Safety nets go first so everything after them is checked by them. D is the highest-value feature, and E needs B's rule script.

---

## Global Constraints

- One branch and one PR per workstream, from the latest `origin/production`, following every rule in `CLAUDE.md`, including merging without asking once checks are green.
- Never create a git worktree. Work in the main checkout.
- AgentOS runs live from this checkout under `tsx watch`, and saving `server/` files restarts it and kills running jobs. Before switching branches or editing `server/`, run `curl -s localhost:8787/api/worker-jobs` and check that no job is running. If one is, wait for it.
- Commit only synthetic data. No real client names, email addresses, mail content or amounts in code, fixtures, tests or PR text.
- Never send email, start a real worker job, or call a paid API during implementation or tests, except the synthetic eval run in Task F.
- Invoke the `impeccable` and `ui-ux-pro-max` skills before touching any `.tsx` or `.css`. Follow `DESIGN.md`.
- Validate route bodies with zod. Use `execFile` or `spawn` with argument arrays. Tests go in `__tests__/` beside the code.
- Absent is not zero: an unknown rate or cost is `null` and displays as `—`, never `0`.
- Rand amounts are integer minor units (cents). AI cost stays in USD. There is no FX source, so never convert it.
- Copy on screen follows `PRODUCT.md`: plain words a non-engineer can read.

## Review Focus

1. **A commit message or PR body that mentions a forbidden git command** (`git commit -m "avoid git rebase"`) must not be blocked. Pinned in Task B.
2. **A payment whose client has no workspace link** still counts toward the R100k total and appears as Unattributed. Pinned in Task D.
3. **A Compass target that can't be parsed or is missing** gives `target: null` and a prompt to set it, never a R0 target or a hardcoded R100k. Pinned in Task D.
4. **Month edges in South African time:** `2026-10-31T22:30:00Z` is already November for the owner, while CI runs in UTC. Pinned in Task D.
5. **Existing `friction.json` items** with no `kind` load as plain friction and can still be marked fixed without a test. Pinned in Task E.

---

## Part 2: Implementation plan

### Task A: Browser tests in CI

**Files:**
- Modify: `.github/workflows/ci.yml`, `playwright.config.ts`, `CLAUDE.md`

**Baseline on `production` at e503f31 (2026-11-06): 65 passed, 7 failed, in 5.8 minutes.** These fail before any change:

- `e2e/connectors.spec.ts:17`: sits under System, between Automations and Operations
- `e2e/dashboard-layout.spec.ts:17`: puts the plan, the summary and today's work first
- `e2e/dashboard-layout.spec.ts:52`: reads priorities, brief, list, focus, then business at one column
- `e2e/operator.spec.ts:33`: is first under Work, opens on a new chat
- `e2e/step-59.spec.ts:125`: Knowledge filters by workspace, in the URL
- `e2e/step-59.spec.ts:195`: a worker's finished job can be cancelled from the workers page
- `e2e/traction-places.spec.ts:80`: searches a niche and area, lists the weakest web presence first

Separately, running the suite rewrites tracked images in `docs/collective/screenshots/`, which leaves the checkout dirty.

**Interfaces:**
- Produces: a CI check named `Browser tests`, which later workstreams must keep green.

- [ ] **Step 0a: Re-run the suite on a clean checkout, then diagnose what still fails with `superpowers:systematic-debugging`.** The baseline ran while another agent installed packages in the same checkout, which can make Vite reload mid-test, so the list above may include false failures. For each real failure, decide whether the test is out of date (the app changed on purpose, check `git log` on the feature) or the app has a real bug. Fix the test or the app accordingly. Never delete, skip or `test.fixme` a test to get green. If one can't be resolved without an owner decision, stop and report it.
- [ ] **Step 0b: Stop test runs rewriting tracked files.** Screenshots from `e2e/collective.spec.ts` are written only when `UPDATE_DOC_SCREENSHOTS=1` is set, otherwise to `test-results/`. Expected: after `npm run test:e2e`, `git status --short` is empty.
- [ ] **Step 1: Add the job.** Name it `Browser tests`, `timeout-minutes: 30`, Node 22, `npm ci`, the same git identity step as `Tests`, then `npx playwright install --with-deps chromium` and `npx playwright test`. Upload `test-results/` with `actions/upload-artifact@v4` under `if: failure()`, retention 7 days.
- [ ] **Step 2: Set `forbidOnly: !!process.env.CI`** in `playwright.config.ts`. Keep `retries: 0`. A flaky test gets fixed, not retried.
- [ ] **Step 3: Update `CLAUDE.md`** so the merge rule lists `Lint, typecheck, build`, `Tests` and `Browser tests`, and local checks include `npm run test:e2e`.
- [ ] **Step 4: Open the PR and read the CI run.** Expected: the job passes on Linux. If a test passes locally and fails on CI, find the cause (timezone, fonts, missing tool) and fix it. Do not skip the test.
- [ ] **Step 5: Merge** once green, then confirm CI on `production`.

### Task B: Deterministic rules and hooks

**Files:**
- Create: `.claude/settings.json`, `scripts/hooks/guard-bash.mjs`, `scripts/checks/repo-rules.mjs`
- Create: `server/testing/__tests__/guard-bash.test.ts`, `server/testing/__tests__/repo-rules.test.ts`
- Modify: `.github/workflows/ci.yml`, `package.json`, `CLAUDE.md`, `.gitignore` if it hides `.claude/settings.json`

**Interfaces:**
- Produces: `decideBash(command: string, deps?: { prChecks?: (args: string[]) => Promise<"green" | "not-green"> }): Promise<{ allow: true } | { allow: false; reason: string }>`
- Produces: `checkTrackedFiles(paths: string[]): RuleFailure[]`, `checkDiff(diff: { added: Array<{ file: string; line: string }>; addedFiles: string[]; allFiles: string[]; branch?: string; prBody?: string }): RuleFailure[]`, where `RuleFailure = { rule: string; file?: string; message: string }`
- Produces: `npm run check:rules`

- [ ] **Step 1: Write failing tests for `decideBash`.**

```ts
for (const blocked of [
  "git push --force origin production", "git push -f", "git push --force-with-lease",
  "git push origin +feature", "git push origin --delete old", "git push origin :old",
  "git branch -D old", "git rebase production", "git reset --hard HEAD~1",
  "git filter-branch --all", "git add .env", "git add .env.local",
  "git fetch && git push --force", "git remote set-url origin https://abc123@github.com/x/y.git",
]) assert.equal((await decideBash(blocked)).allow, false, blocked);

for (const allowed of [
  'git commit -m "never git rebase or git push --force here"',
  "git add .env.example", "git push -u origin feat/x", "npm test", "git branch -d merged",
  "git commit -F- <<'EOF'\ngit reset --hard is banned\nEOF",
]) assert.equal((await decideBash(allowed)).allow, true, allowed);

assert.equal((await decideBash("gh pr merge 12 --merge", { prChecks: async () => "not-green" })).allow, false);
assert.equal((await decideBash("gh pr merge 12 --merge", { prChecks: async () => "green" })).allow, true);
```

- [ ] **Step 2: Run** `npx tsx --test server/testing/__tests__/guard-bash.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `guard-bash.mjs`.** Strip heredocs and quoted strings before matching, and split on `&&`, `;`, `||`, `|`. For `gh pr merge`, the default `prChecks` runs `gh pr checks` through `execFile` with a 20-second timeout. Anything other than all-pass is `not-green`, so merges fail closed. Every other failure, including malformed hook stdin, fails open with exit 0. A block exits 2 and writes the reason plus "ask the owner" to stderr.
- [ ] **Step 4: Add `.claude/settings.json`** with a `PreToolUse` hook, matcher `Bash`, command `node "$CLAUDE_PROJECT_DIR/scripts/hooks/guard-bash.mjs"`, timeout 30.
- [ ] **Step 5: Write failing tests for `repo-rules`.** Each case asserts the `rule` name:
  - `env-file`: tracked `.env.production` fails, `.env.example` passes.
  - `secret`: an added line containing `ghp_` + 36 characters, `github_pat_`, `sk-ant-` or `x-access-token:` fails. Files under `__tests__/`, `e2e/fixtures/` and the rule file itself are exempt.
  - `shell-true`: an added `shell: true` fails, except in `server/workers/validation.ts`, `server/visual-verification/preview.ts` and `scripts/browser-check.mjs`.
  - `module-needs-test`: a newly added `server/<feature>/x.ts` fails unless a test under `server/<feature>/__tests__/` is in the diff or names `x`.
  - `route-needs-zod`: a newly added server file with `.post(`, `.put(` or `.patch(` and no `.parse(` or `.safeParse(` fails.
  - `fix-needs-test`: a branch starting `fix/` with no test file in the diff fails, unless the PR body has a line starting `Not testable:`.
- [ ] **Step 6: Implement `repo-rules.mjs` and add `check:rules`.** Exported pure functions, plus a CLI that reads `git ls-files` and `git diff --unified=0 <base>...HEAD`. Base is `origin/${GITHUB_BASE_REF}` on a PR, otherwise `origin/production`. On a push to `production` only tracked-file rules run. The CI step reads the PR body from `github.event.pull_request.body`, passed through `env:`, never interpolated into the script.
- [ ] **Step 7: Add the CI step** `Repo rules` to the `checks` job, with `fetch-depth: 0` on that job's checkout.
- [ ] **Step 8: Update `CLAUDE.md`:** state which rules are now enforced by script and that a blocked command means ask the owner, not work around it.
- [ ] **Step 9: Run all local checks, open the PR, merge when green.**

### Task C: Memory ownership

**Files:**
- Create: `shared/memory-ownership.ts`, `docs/memory-ownership.md`, `server/memory/maintenance.ts`, `server/memory/__tests__/maintenance.test.ts`
- Modify: `server/memory/retrieval.ts`, `server/memory/routes.ts`, `server/workers/context-builder.ts`, the Assistant chat system prompt in `server/chat/`, `CLAUDE.md`
- Modify outside the repo: `me/MEMORY_POLICY.md` in the real vault, adding one `## Sources of truth` section only

**Decision to record (the table in `docs/memory-ownership.md`):**

| Rank | Store | Owns | Never holds | Kept for |
|---|---|---|---|---|
| 0 | Live source: code, `git`, ledger, job store, inbox | What is true right now, and all money figures | | As each system defines |
| 1 | Vault (`AGENTOS_ROOT`) | Goals, decisions, project and business truth, notes | Secrets, client code | Forever. Archive, never delete. Daily logs move after 30 days. |
| 2 | Claude file memory (`~/.claude/projects/…/memory`) | How agents should work with the owner, pointers | Project truth it could read instead | Until wrong, then corrected or deleted |
| 3 | Honcho (not connected today) | Inferred preferences for Claude Code sessions only | Client data, money, decisions, secrets | Treated as stale after 90 days |
| 4 | Notion (not connected today) | Nothing. Copies shared with other people, via Composio. | Anything that exists only there | Disposable |

**Conflict rule (exact text):** "When two memories disagree, the lower rank number wins. Fix or flag the loser. Never silently overwrite the vault: propose the change with a `Remember:` line."

**Interfaces:**
- Produces: `MEMORY_STORES`, `MEMORY_CONFLICT_RULE` in `shared/memory-ownership.ts`
- Produces: `planDailyLogArchive(vaultRoot: string, now: Date): Promise<{ moves: Array<{ from: string; to: string }>; skipped: Array<{ file: string; reason: string }> }>`, `applyDailyLogArchive(vaultRoot: string, now: Date): Promise<{ moved: number; skipped: number }>`

- [ ] **Step 1: Write failing retrieval test:** a note under `archive/` that matches the query is not returned by default, and is returned with `includeArchive: true`.
- [ ] **Step 2: Implement it** in `retrieval.ts`, replacing the `0.3` discount at line 179. Human search in `search.ts` stays inclusive. Update any test that asserted the old discount.
- [ ] **Step 3: Write failing maintenance tests:** a `YYYY-MM-DD*.md` log 31 days old is planned to `archive/logs/daily/YYYY-MM/`; 29 days old is not; `._*` sidecars and undated names are skipped; an existing destination is skipped and never overwritten; a missing vault root refuses and creates nothing.
- [ ] **Step 4: Implement `maintenance.ts`** using `assertVaultRootPresent` and realpath containment. It renames only and has no delete path.
- [ ] **Step 5: Add routes:** `GET /api/memory/maintenance` returns the plan. `POST /api/memory/maintenance/archive-logs` takes zod body `{ confirm: true }`. There is no schedule. The owner triggers it, from an `Archive old logs` row in Operations → System showing the planned count (invoke the frontend skills first).
- [ ] **Step 6: Add `MEMORY_CONFLICT_RULE`** to the worker brief and the Assistant system prompt, each pinned by a test asserting the text is present.
- [ ] **Step 7: Write the doc and `CLAUDE.md` pointer.** Add the `## Sources of truth` section to the real vault policy, linking the table's rule in three lines. Do not run the archive on the real vault.
- [ ] **Step 8: Run all local checks, open the PR, merge when green.**

### Task D: Outcomes scorecard

**Files:**
- Create: `shared/outcomes-types.ts`, `server/outcomes/compute.ts`, `server/outcomes/sources.ts`, `server/outcomes/hours-store.ts`, `server/outcomes/routes.ts`, `server/outcomes/__tests__/compute.test.ts`, `server/outcomes/__tests__/hours-store.test.ts`, `src/features/operations/outcomes-tab.tsx`, `src/lib/agentos/outcomes.ts`, `e2e/outcomes.spec.ts`
- Modify: `server/index.ts`, `src/features/operations/operations-page.tsx`, `e2e/fixtures/vault` only if the fixture Compass lacks a money goal

**Interfaces:**
- Produces, in `shared/outcomes-types.ts`:

```ts
OwnerHoursEntrySchema: { id, on: "YYYY-MM-DD", minutes: 1..1440, clientId?, workspace?, kind: "delivery"|"review"|"sales"|"admin"|"learning", note?: max 300, createdAt }
LogOwnerHoursRequestSchema: the same without id and createdAt

interface OutcomesResponse {
  month: string;                          // YYYY-MM in Africa/Johannesburg
  target: { goalId: string; minor: number } | null;
  paidMinor: number;
  gapMinor: number | null;                // null when no target
  trailingAverageMinor: number | null;    // last 3 full months; null with no payments ever
  clients: ClientOutcome[];               // highest paid first
  unattributed: { paidMinor: number; landedJobs: number; ownerMinutes: number };
  agentWork: { landedJobs: number; onPayingClients: number; firstPassRate: number | null };
  ownerHours: { monthMinutes: number; weekMinutes: number; byKind: Record<string, number>; entries: OwnerHoursEntry[] };
  warnings: string[];
}
interface ClientOutcome {
  clientId: string; name: string; workspace: string | null;
  paidMinor: number; paidTrailing90Minor: number;
  landedJobs: number; sendBacks: number;
  aiCostUsd: number | null; ownerMinutes: number;
  randPerHourMinor: number | null;        // null with no logged hours
}
```

- Produces: `parseTargetMinor(target: string): number | null`, `currentMonth(now: Date): string`, `computeOutcomes(input: OutcomeInputs, now: Date): OutcomesResponse`, where `OutcomeInputs` holds plain arrays and no I/O happens inside `compute.ts`.

- [ ] **Step 1: Write failing `compute` tests.**

```ts
assert.equal(parseTargetMinor("R100,000+"), 10_000_000);
assert.equal(parseTargetMinor("R100k"), 10_000_000);
assert.equal(parseTargetMinor("a lot"), null);
assert.equal(currentMonth(new Date("2026-10-31T22:30:00Z")), "2026-11");
```

Further cases, by name:
- `counts an unlinked client's payment in the total and under unattributed`
- `no money goal gives target null and gap null`
- `a payment on the last day of the month counts in that month only`
- `randPerHour is null with no logged hours, never zero`
- `aiCost is null when no run reported a cost`
- `firstPassRate is null with no landed jobs`
- `jobs on a workspace with no paying client count as landed but not onPayingClients`
- `a client who paid only outside the last 90 days does not count as paying`

- [ ] **Step 2: Implement `compute.ts`.** A landed job is status `completed`. Send-backs are `attempt - 1`. First-pass rate is landed jobs with `attempt === 1` over landed jobs. A paying client is one with a payment in the trailing 90 days. Only money goals count as target, matched by `measure` against `/monthly income/i`. Client payments only: salary is not counted, and the screen says so.
- [ ] **Step 3: Write and pass `hours-store` tests,** mirroring `server/friction/store.ts`: `owner-hours.json` in `uiStateDir()`, atomic write, serialised, unreadable entries skipped.
- [ ] **Step 4: Implement `sources.ts`.** Read Compass, ledger `payment` records for all entities, `BusinessClient` links, `listJobs`, and usage by project through the existing `server/usage` helpers. Check how ledger client ids relate to `BusinessClient.id` before writing the join: use the ledger record's source id, then an exact name match, and never a fuzzy match. Anything unmatched goes to `unattributed`, and its count goes in `warnings`.
- [ ] **Step 5: Add routes:** `GET /api/outcomes`, `POST /api/outcomes/hours`, `DELETE /api/outcomes/hours/:id`.
- [ ] **Step 6: Invoke `impeccable` and `ui-ux-pro-max`, then build `outcomes-tab.tsx`,** using Paper components and Quiet Terminal tokens:
  - A headline: paid this month against target, gap, and 3-month average.
  - A client table: paid, 90 days, jobs landed, send-backs, AI cost, your hours, rand per hour.
  - One line stating how many landed agent jobs were for paying clients.
  - A quick hours form: duration chips for 15m, 30m, 1h and 2h, a client or workspace select, and a kind select.
  - An honest empty state when no hours are logged, and a link to Compass when there is no target.
  - Add `outcomes` to `TABS` in `operations-page.tsx`, placed first in the list. Leave the default tab as `usage`.
- [ ] **Step 7: Write and pass `e2e/outcomes.spec.ts`:** the tab opens, shows the target from the fixture Compass, logs 30 minutes, and the total updates. Add a phone-width overflow check.
- [ ] **Step 8: Run all local checks, QA against the real data in the running app without changing any, open the PR, merge when green.**

### Task E: Corrections become regression tests

**Files:**
- Create: `server/friction/corrections.ts`, `server/friction/__tests__/corrections.test.ts`, `.claude/skills/correction-to-regression/SKILL.md`, `e2e/corrections.spec.ts`
- Modify: `shared/friction-types.ts`, `server/friction/store.ts`, `server/friction/routes.ts`, the reject, revise and visual-revision routes in `server/index.ts`, `src/features/agent/report-friction-dialog.tsx`, `src/features/operations/friction-tab.tsx`, `src/lib/agentos/friction.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `fix-needs-test` rule from Task B.
- Produces, additions to `FrictionItemSchema`, all optional so old items still parse:

```ts
kind: z.enum(["friction", "correction"]).default("friction"),
expected: z.string().max(1000).optional(),
source: z.object({ type: z.enum(["manual", "job-rejected", "job-revision", "visual-revision"]), jobId: z.string().optional(), project: z.string().optional() }).optional(),
regression: z.object({ status: z.enum(["needed", "in-progress", "covered", "not-testable"]), testPath: z.string().optional(), jobId: z.string().optional(), reason: z.string().optional() }).optional(),
```

- Produces: `recordJobCorrection(job: WorkerJob, type: "job-rejected" | "job-revision" | "visual-revision", note?: string): Promise<FrictionItem | undefined>`, `reconcileRegressions(items: FrictionItem[], readJob): Promise<FrictionItem[]>`

- [ ] **Step 1: Write failing tests,** by name:
  - `a legacy item with no kind loads as friction and can be marked fixed`
  - `a correction cannot be marked fixed while its regression is needed`
  - `a correction can be marked fixed once covered, or not-testable with a reason`
  - `not-testable without a reason is refused`
  - `one job and attempt records one correction, however many times the route is called`
  - `a job with a test file in its changes marks the regression covered with that path`
  - `a completed job that changed no test returns the regression to needed and says why`
  - `a failed job returns the regression to needed`
  - `a testPath containing .. or an absolute path is refused`
- [ ] **Step 2: Implement the store and `corrections.ts`.** The gate lives in the status update and the route returns 409 with the reason. A test file matches `__tests__/`, `.test.`, or `.spec.`. Add `POST /api/friction/:id/regression` for manual `covered` or `not-testable`.
- [ ] **Step 3: Wire capture into the reject, revise and visual-revision routes,** after the job action has succeeded, inside its own try/catch. A failed capture is logged and never fails the owner's decision. Only owner routes capture: the automatic review loop's send-backs are not owner corrections.
- [ ] **Step 4: Add `POST /api/friction/:id/regression-job`.** It uses the existing `routeJob` and `startJob` the way `server/agentos/task-delegation.ts` does, with the objective built from description and expected, and acceptance criteria requiring a test that fails on the wrong behaviour. Project comes from `source.project`, otherwise the AgentOS repo. It starts only on this explicit request, and is never called automatically or from tests with a real worker: use the `mock` worker in tests.
- [ ] **Step 5: Call `reconcileRegressions` on `GET /api/friction`.**
- [ ] **Step 6: Invoke `impeccable` and `ui-ux-pro-max`, then update the UI.** In the ⌘K dialog, add a choice for "An agent got this wrong", which requires "What should have happened?". In the Friction tab, each correction shows regression state with `Write the test`, `Mark covered` and `Can't be tested` actions, and corrections needing tests sort first.
- [ ] **Step 7: Add the skill and rule.** `SKILL.md` covers: when the owner corrects a coding session, write the failing test first, confirm it fails, fix, confirm it passes, use a `fix/` branch. Add one line to `CLAUDE.md` pointing at it.
- [ ] **Step 8: Write and pass `e2e/corrections.spec.ts`:** report a correction, see it refuse to be marked fixed, mark it not testable with a reason, then mark it fixed.
- [ ] **Step 9: Run all local checks, open the PR, merge when green.**

### Task F: Promptfoo evals for mail triage

**Files:**
- Create: `evals/package.json`, `evals/package-lock.json`, `evals/README.md`, `evals/mail.promptfooconfig.yaml`, `evals/providers/mail-classifier.ts`, `evals/datasets/mail-synthetic.json`
- Create: `scripts/evals/run.ts`, `scripts/evals/export-mail-corrections.ts`, `server/evals/history.ts`, `server/evals/routes.ts`, `server/evals/__tests__/history.test.ts`, `server/evals/__tests__/dataset.test.ts`
- Modify: `package.json`, `.gitignore`, `eslint.config.js`, `server/index.ts`, `src/features/operations/outcomes-tab.tsx`

**Interfaces:**
- Consumes: `classifyThread` and the bucketing in `server/mail/`.
- Produces: `appendEvalRun(run: { at: string; suite: string; commit: string; passed: number; total: number }): Promise<void>`, `readEvalHistory(suite?: string): Promise<EvalRun[]>`, `compareToPrevious(runs: EvalRun[]): { verdict: "better" | "worse" | "same" | "first"; line: string }`, `GET /api/evals/history`
- Produces: `npm run eval:install`, `npm run eval:mail`, `npm run eval:mail:real`

- [ ] **Step 1: Write failing tests:**
  - `compareToPrevious` returns `first` for one run, `better` for 10/12 → 11/12, `worse` for the reverse, and compares pass rate when totals differ.
  - History holds only the listed fields: asserting a run with extra `prompt` text does not store it.
  - `dataset.test.ts`: every committed address in `mail-synthetic.json` uses an `example.com`, `example.org` or `example.net` domain, and every case has an expected category or bucket.
- [ ] **Step 2: Implement `history.ts`.** JSONL at `~/.agentos-ui/evals/history.jsonl`, with no prompt or response content.
- [ ] **Step 3: Build the suite.** Pin `promptfoo` at exactly `0.125.1` in `evals/package.json`. Check the custom provider and assertion syntax against current docs through context7 before writing it. The provider calls the real classifier. Write about 12 synthetic threads covering each bucket and category.
- [ ] **Step 4: Implement `run.ts`.** Launch with `execFile` and these env vars: `PROMPTFOO_DISABLE_TELEMETRY=1`, `PROMPTFOO_DISABLE_UPDATE=1`, `PROMPTFOO_CONFIG_DIR=~/.agentos-ui/evals/promptfoo`. Refuse with a clear message when `JEV_API_KEY` is missing. Never use `promptfoo share`. Record the run and print the comparison line.
- [ ] **Step 5: Implement `export-mail-corrections.ts`.** It reads corrected rows from `mail.db` and writes `~/.agentos-ui/evals/mail-corrections.json`, mode `0600`, never inside the repo. Evaluate leave-one-out: a thread's own correction is removed from the examples sent with it, otherwise the score is meaningless.
- [ ] **Step 6: Keep it out of the app.** Add `evals/node_modules` and `evals/output` to `.gitignore` and exclude `evals/` from eslint. Confirm root `npm audit` is unchanged.
- [ ] **Step 7: Run `npm run eval:mail` once** (synthetic data, one small real Jev spend), then a second time to see the comparison line. Report both scores. Do **not** run `eval:mail:real`: it sends real mail metadata, so it's the owner's call.
- [ ] **Step 8: Invoke `impeccable` and `ui-ux-pro-max`, then add one quiet line to the Outcomes tab:** latest score, change from the previous run, and when it ran. If there are no runs, show the command to start one.
- [ ] **Step 9: Write `evals/README.md`:** how to run it, read it, and add a suite. Run all local checks, open the PR, merge when green.

---

## Not in this plan

- **Branch protection on `production`.** It would make these CI checks binding on GitHub, but it changes repository settings, so it's the owner's call.
- **Setting up Honcho.** `/honcho:setup` needs the owner's key.
- **Connecting Notion.** Nothing in the vault depends on it.
- **Evals for worker jobs.** Each case would be a full paid agent run. Corrections cover that area through real tests instead.
- **Automatic hour tracking.** Anything inferred would be a guess presented as a measurement.

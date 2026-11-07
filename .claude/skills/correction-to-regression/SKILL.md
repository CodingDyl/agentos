---
name: correction-to-regression
description: Use when the owner corrects what a coding session did ("that's wrong", "it should have…", a rejected or sent-back job). Turns the correction into a failing test first, then the fix, so it stays fixed.
---

# Correction to regression test

A correction that only lives in chat gets made again. When the owner tells you something you built is wrong, the test comes before the fix.

## Steps

1. **Say what was wrong and what should have happened**, in one sentence each. If the owner already filed it (Operations → Friction, kind "Correction"), use their words.
2. **Work on a `fix/` branch** from the latest `origin/production`. The repo's `Repo rules` check fails a `fix/` branch that changes no test.
3. **Write the failing test first.** Put it in a `__tests__/` folder beside the code. Use the real code path, with synthetic data only: no real client names, addresses, mail or amounts, because the repo is public.
4. **Run it and watch it fail** for the right reason: the wrong behaviour, not a typo or a missing import. If it passes, the test doesn't capture the correction; fix the test.
5. **Make the fix.** The smallest change that turns the test green.
6. **Run it again and watch it pass**, then the whole suite (`npm test`, plus `npm run test:e2e` for anything on screen).
7. **Mark the correction covered** in Operations → Friction with the test's path. A correction can't be marked fixed until it is covered, or marked "Can't be tested" with a reason.

## When there truly is no test

Some corrections are wording or taste. Don't invent a test that asserts nothing. Mark it "Can't be tested" with the reason in the friction item, and put a `Not testable: <why>` line in the PR description so the `fix-needs-test` rule accepts the branch.

## Don't

- Don't delete, skip or `test.fixme` a test to get green.
- Don't start a worker job to write the test unless the owner asked: "Write the test" in the Friction tab is their button, not yours.

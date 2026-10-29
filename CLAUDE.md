# AgentOS: rules for agents

AgentOS is the owner's personal tool and only they use it. Merging to `production` is how work gets tested, so finished work must always reach it.

## Git workflow (standing permission: don't ask each time)

- **`production` is the single source of truth.** There are no other long-lived branches.
- **Start:** `git fetch origin production` and branch from the latest `origin/production`. Never start from an old feature branch.
- **Stay current:** merge `origin/production` into your branch before opening a PR and again before merging. Several agents work in parallel, so expect `production` to move.
- **Commit and push** with clear messages, without asking.
- **Merge without asking** once all of these hold:
  1. `npm run lint`, `npm run typecheck`, `npx vite build` and `npm test` pass locally. If a test only hangs in a cloud sandbox and also hangs on unmodified `production`, rely on CI and say so.
  2. A PR into `production` is open and CI (`Lint, typecheck, build` and `Tests`) is green on its latest commit.
  3. There are no merge conflicts.
- **After merging,** confirm CI on `production` is green. If it's red, fix it immediately or revert the merge.
- **Never leave finished work unmerged.** If you can't merge (a conflict you can't resolve safely, CI you can't fix, no permission), stop and say exactly why, in the PR and to the owner.
- **Ask first** before: force-pushing, deleting branches, rewriting history, or anything that sends email, moves money, or touches live client data.

## Definition of done

A task is done when it's merged to `production` with CI green. Your final message states:
- the PR link and merge commit;
- what was tested, and how;
- what is **untested** (e.g. against a real mailbox, Vercel or a bank);
- anything the owner must do locally, usually "pull and restart AgentOS".

## Code conventions

- **Stack:** Vite + React + TypeScript frontend (`src/`), Node/Express server (`server/`), shared zod types (`shared/`), Tauri shell (`src-tauri/`).
- **Placement:** put new features in `src/features/<feature>/` and `server/<feature>/`, with tests in a `__tests__/` folder next to the code. Every new server module gets tests.
- **Validation:** validate every route body with zod.
- **Commands:** run commands with `execFile`/`spawn` and argument arrays, never `shell: true` or interpolated input.
- **Paths:** resolve project paths with `realpath` and confirm they're inside the expected root.
- **Secrets:** stay server-side. Never put them in a git remote URL, a log, an API response or a committed file. Never stage `.env*` files.
- **Client code** lives in its own repo, never in the vault.
- **Before building, search for an existing implementation.** Production moves fast, and duplicates (a second dev-server runner, a second router) are a recurring problem.
- **PR descriptions** have What / Security / Testing sections, and include "Not tested" when something wasn't.

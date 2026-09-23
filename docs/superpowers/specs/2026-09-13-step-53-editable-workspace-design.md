# Step 53 — Editable Workspace / Project Management

Goal: run the whole personal development workflow from AgentOS without opening
`~/AgentOS` by hand. Humans mutate the vault directly through a validated,
atomic, revision-checked API; agents still go through approval.

## Already built before this spec
Mutation layer (`server/agentos/mutations/*`: writer, revision, task-ids,
tasks, decisions, status, projects, prose/portfolio documents), project
create/patch/archive/restore, task CRUD + reorder + complete + delete,
decisions CRUD, prose-field edits, source view, backups + undo, conflict bar,
`CreateProject`, `TaskBoard`, `DecisionsEditor`, `InlineEdit`, `SourceViewer`.

## Decisions
- Settings live in `PROJECT.md` under `## Configuration` as `Key: value`
  fields (`Local repository` stays in `## Connected Systems`).
- Archived tasks live in a `## Archived` section at the end of `TASKS.md`.
- Drag-and-drop uses `@dnd-kit/core` + `@dnd-kit/sortable`; move buttons stay.
- Global search is unified into ⌘K; Quick Create is the palette's Create group.
- Plan with Hermes mirrors task-scoping: structured JSON via `sendToHermes`,
  nothing persisted until "Create project from plan".
- Project tabs: Overview / Tasks / Designs / Decisions / Activity / Agents.
  Sessions fold into Activity; Git becomes a card on Overview.

## Section 1 — Vault format and backend contracts

### `PROJECT.md` `## Configuration`
```
Task prefix: PP
Default branch: main
Worker preference: auto
Visual verification: ui-tasks
Design board: Chef Board
Validation:
- npm test
- npm run lint
```
`server/agentos/mutations/configuration.ts`: `parseConfiguration(markdown)`,
`applyConfiguration(lines, config)`; absent section → defaults.
`ProjectConfigurationSchema` in `shared/agentos-types.ts`:
`taskPrefix?`, `defaultBranch?`, `workerPreference: auto|grok|claude`,
`visualVerification: off|ui-tasks|always`, `designBoard?`,
`validationCommands: string[]`.

`PATCH /api/projects/:slug` gains `description`, `repoPath`, `configuration`,
and `expectedRevisions: { portfolio?, project? }`. Name/type/state/priority →
`PORTFOLIO.md`; description/repo/configuration → `PROJECT.md`.
`ProjectDetail` gains `configuration`, `repoPath`, `description`.
Consumers: `taskPrefix()` prefers configured prefix; delegation seeds
validation commands / visual acceptance / requested worker / branch from
configuration when Hermes gives none.

### `TASKS.md` `## Archived`
`TaskSectionName` gains `archived`. `POST .../tasks/:id/archive`,
`POST .../tasks/:id/restore` (→ later). Open counts exclude archived.

### Bulk
`POST /api/projects/:slug/tasks/bulk { taskIds, action: complete|move|archive,
section?, expectedRevision }` — one read/write/backup/undo id.

### Search
`GET /api/search?q=&limit=` → `{ groups: [{ kind, hits: [{ id, title,
detail, project?, href }] }] }`, kinds project|task|decision|design|job|session.
In-memory substring scan over existing readers; title match ranks first.

### Plan with Hermes
`POST /api/projects/plan { brief }` → `ProjectPlan { name, slug, goal, scope,
milestones[], initialTasks[{title, section}], risks[], plannedBy }`.
Hermes down → 503. `POST /api/projects` accepts optional `tasks[]`,
`decisions[]`, `configuration` for one-shot create-from-plan.

All new bodies are zod schemas in `shared/`, parsed at the route.

## Section 2 — Project page as workshop
Header actions: `Start session` · `+ Task` · `Delegate` · `⋯` (Settings,
View source, Open designs, Archive/Restore).
Tabs: Overview (inline status/purpose/next-milestone, Git card, designs strip),
Tasks (board), Designs (`ProjectDesigns` promoted), Decisions, Activity
(project-filtered timeline + sessions), Agents (Hermes + workers status,
Ask Hermes / Delegate / Start session, this project's jobs).
Settings sheet (`src/features/workspace/project-settings.tsx`): name,
description, status, priority, repository, task prefix, design board, default
branch, worker preference, visual verification, validation commands; one PATCH
with both revisions; archive at the bottom. Projects list folds archived
projects under a collapsed row with Restore.

## Section 3 — Task board
dnd-kit sortable within sections and droppable across sections; drop calls the
existing reorder / patch-section mutations with the current revision. Keyboard
sensor enabled; move buttons stay in the row menu. Selection mode via row
checkboxes → sticky bulk bar (`Move to…`, `Mark complete`, `Archive`) calling
the bulk route once. Archived section collapsed by default with count; rows
offer Restore and Delete. Delete on open tasks stays confirm-once.

## Section 4 — Palette, Quick Create, Mission Control
Palette empty state groups: Create (New task, New project, New decision,
Upload design, Delegate work, Capture note), Navigate (Mission control,
Projects, each project, Designs, Operations, Workers, Activity), Agents
(Ask Hermes, Delegate task, View active workers), then Hermes skills.
Typing searches commands and, debounced, `GET /api/search` → result groups.
Create actions open the matching form as a modal from anywhere (`QuickCreate`
host in the provider; New task asks for project when none in context).
`+` button in the app shell opens the palette in Create mode. Mission Control
focus block gains `+ Task`, `+ Project`, `Capture` beside `Start work`.

## Section 5 — Plan with Hermes UI, errors, tests
Create Project modal offers `Create manually` / `Plan with Hermes`. Plan mode:
brief textarea → review screen with every field editable, tasks list with
section pickers → `Create project from plan`. Hermes unavailable → notice and
fall back to manual with the brief as goal.
Errors: 400 invalid → inline field error; 404 → error state; 409 → conflict
bar with reload; 503 Hermes → notice with retry. Every human mutation records
activity and leaves a backup for undo.
Tests: node:test for configuration parse/apply round-trip, archive/restore,
bulk, search ranking, plan parsing/fallback, taskPrefix precedence; model tests
for palette grouping/search merge and board DnD ordering helpers.

## Phases
1 Workshop tabs/header/agents/activity · 2 Settings + configuration ·
3 Tasks archive/DnD/bulk · 4 Palette/Quick Create/Mission Control ·
5 Search · 6 Plan with Hermes. Each phase ends green on typecheck + tests.

## Status — 2026-09-13: built and verified

All six phases landed on the working branch. Verified in the browser against
the live vault: drag PP-004 Next→Now and undo; bulk move + restore via
backups; ⌘K Create/Navigate/Agents groups and search groups (tasks,
decisions, designs); Settings sheet reads both files; Plan with Hermes
returned a full plan (not persisted). Lint, typecheck and 771 tests green.

Notes for later:
- `restoreBackup` is the safety net when the undo bar times out; the API is
  `GET /api/backups` → `POST /api/backups/:id/restore`.
- Hermes skills `/plan-project` is referenced in the planning packet; the
  packet is self-contained so it works before the skill exists in Hermes.
- Sessions in search link to `/agent?project=` — the console has no
  per-session route yet.

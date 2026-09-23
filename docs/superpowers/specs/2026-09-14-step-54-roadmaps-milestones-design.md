# Step 54 — Roadmaps, Milestones & Releases

Goal: planning above the task level. PROJECT → MILESTONE → TASKS → AGENTS →
DELIVERED WORK, with deterministic progress and health, and Hermes as a
proposal-only planner.

## Decisions
- Milestones live in `projects/<slug>/MILESTONES.md`, one `## Title` section
  per milestone with `Id:`, `Status:`, `Target:`, `Outcome:` paragraph,
  `Criteria:` checkbox list, `Tasks:` id list, optional `### Review` body.
  Ids are slugs of the title fixed at creation; never reused.
- Task-level `ready` and `after` (dependencies) live inline on the task line
  in `TASKS.md` as a readable tail: `- [ ] [PP-024] Chef polish · ready · after PP-021`.
- Execution status is derived: `done` from `[x]`; `blocked` when any `after`
  id is open; `review`/`in_progress` from the worker-job link; `ready` from the
  flag; else `backlog`. Sections (Now/Next/Later) stay planning horizons.
- Progress = completed milestone tasks / milestone tasks. Completion is a
  human action with a review step; 100% never auto-closes.
- Health is deterministic: `blocked` (a Now or ready task is blocked),
  `at_risk` (target past, or within 14 days with < 60% done), `no_target`,
  else `on_track`.
- Hermes plans a milestone (criteria, tasks, risks, dependencies, uncovered
  outcomes) from goal/status/decisions/outcome/tasks; `Apply plan` creates
  tasks and criteria. Hermes may draft the completion review; saved under the
  milestone.
- Blocked tasks are refused by delegation (400 with reason).

## Contracts
- `GET /api/projects/:slug/roadmap` → milestones with progress, execution
  status per task, unplanned tasks, health, revision.
- `POST /api/projects/:slug/milestones`, `PATCH .../:id`, `POST .../reorder`,
  `POST .../:id/complete { review? }`, `POST .../:id/pause|resume|archive|restore`,
  `PUT .../:id/criteria/:index { done }`, `POST .../:id/tasks { taskId }`,
  `DELETE .../:id/tasks/:taskId`.
- `PATCH /api/projects/:slug/tasks/:taskId` gains `ready`, `after`, `milestone`.
- `GET /api/projects/:slug/milestones/:id` → detail with agent work and AI cost.
- `POST /api/projects/:slug/milestones/:id/plan` → `MilestonePlan` (proposal).
- `POST /api/projects/:slug/milestones/:id/review-draft` → Hermes review text.
- `ProjectSummary` gains `milestone { id, title, progress }` and `health`.
- Mission Control focus gains milestone progress, days to target, next ready task.

## UI
- Tabs: Overview / Tasks / Roadmap / Designs / Decisions / Activity / Agents.
- Roadmap: Now (active) / Next (planned) / Later, numbered rows with progress
  bar, target, `+ Milestone`; unplanned count; detail panel with criteria
  toggles, tasks with status dots, agent work, AI cost, Ask/Plan with Hermes,
  Complete → review modal (Keep active / Complete anyway).
- Task row: milestone chip + picker, ready toggle, blocked badge, `after` editor.
- Header health pill; Projects list milestone bars; Mission Control focus.

## Status — 2026-09-14: built and verified

Backend: `mutations/milestone-document.ts`, `mutations/milestones.ts`,
`roadmap.ts` (derived status/progress/health), `hermes/milestone-planning.ts`,
routes under `/api/projects/:slug/roadmap|milestones`, task-line tail markers,
delegation guard for blocked tasks, milestone summary on project rows and the
Mission Control focus. UI: Roadmap tab (rows, detail, plan panel, review
modal, unplanned list), task-row planning controls, health pill, portfolio
bars, focus block. 789 tests green.

Verified live on Pantry Pilot: created "Chef Experience" (kept — real and
active), assigned PP-003/PP-004, set and cleared a dependency (board showed
"Blocked by"), health moved No target → At risk, Mission Control and the
portfolio picked it up, Hermes returned a full milestone plan (not applied),
review modal rendered. Hermes prefixes invented ids on task titles; stripped.

Left for later: milestone rows reorder by buttons only; `after` accepts ids
only (no titles); no per-milestone Gantt/timeline by design.

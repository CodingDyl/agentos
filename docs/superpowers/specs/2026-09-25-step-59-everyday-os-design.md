# Step 59 — Everyday OS restructure

> AgentOS should organise around the user's work, not around the agents doing the work.

Presentation-layer restructure. The vault stays canonical: `projects/<slug>/`
and its five files are untouched, and nothing is moved or renamed on disk.

## Decisions (2026-09-25)

- **Visual style:** new screens go paper — Workspaces index, workspace page
  (header, tabs, Overview) and Knowledge. Today stays Editorial Terminal. The
  shell stays dark. `paper.tsx` is promoted to `src/components/paper/`.
- **Storage:** workspace type and modules live in `PROJECT.md`'s existing
  `## Configuration` section:

  ```markdown
  Workspace type: business
  Modules: tasks, roadmap, documents, clients, creative, decisions, activity
  ```

  Absent → derived defaults. Hermes reads the same lines the UI does.
- **Type defaults:** exact match of the portfolio `Type:` only (`Product` →
  product, `Software` → software, …). Anything else (`Agency / Client Work`,
  `AI SaaS`) is `general` until set in Settings. Never guessed.

## Model (`shared/workspace.ts`)

- `WorkspaceType`: product · business · client · software · personal · research · general
- `WorkspaceModule`: tasks · roadmap · documents · creative · repository ·
  decisions · activity · agents · clients · seo
- Default modules per type. Configured `Modules:` replaces the default list.
  Modules not enabled stay reachable under **More** — nothing becomes
  unreachable, and any `?tab=` deep link still renders.
- Client workspaces label Roadmap as "Milestones"; Repository is added to a
  client/business/general workspace's tabs only when a repository is linked.

## Routes

| Route | Screen |
| --- | --- |
| `/` (`/today` alias) | Today (Mission Control, reordered) |
| `/inbox` (`/mail` redirects) | Inbox (Gmail; classifier manual \| jev) |
| `/workspaces`, `/workspaces/:slug` | Workspaces (paper) |
| `/projects`, `/projects/:slug` | redirect, query string kept |
| `/knowledge` | Knowledge (paper) |
| `/designs/*` | Creative (route unchanged) |
| `/operations` | Operations, + System tab and links to Hermes console / worker jobs |
| `/agent`, `/workers`, `/workers/jobs/:id` | unchanged; highlight Operations |

## Sidebar

`Today · Inbox` / **Work** `Workspaces (+ pinned) · Knowledge · Creative` /
**System** `Automations · Operations · Activity` / footer `Agents · Design system`.
Pins are a per-device preference (localStorage); with none set, active
high-priority workspaces show.

## Today

Greeting + date → Today (planned Now tasks, captured notes) → Needs you →
Focus → Workspaces (active, milestone %, waiting) → Active work → Recent
activity / documents → cost line. Worker/automation/system strips move to
Operations → System.

## Capture & Quick Create

- `POST /api/capture` appends `- [Workspace] note` under `## Inbox` in
  `inbox/CAPTURE.md`. No AI in the path. The form can instead create a task.
  "File with Hermes" remains a secondary option.
- ⌘K Create: New task · New workspace · New document · Capture note · Add
  decision · Upload creative asset. Work: Start focus · Delegate task · Ask
  Hermes. Navigate: screens, recent workspaces first, then all.

## Knowledge

`GET /api/knowledge` — every vault and repo document across workspaces, plus
decisions. Filters: workspace, type, creator, date. Opens in the workspace's
document viewer (`?tab=documents&doc=…`), whose sidebar links back to the task.

## Non-goals

CRM, accounting, calendar, Jev review, filesystem migration, worker rewrite.

## Tests

Playwright against a fixture vault (`AGENTOS_ROOT`) on spare ports: Today →
attention → workspace; Workspaces → Pantry Pilot → task CRUD; Virtara
(business) has no Repository tab and a business Overview; AgentOS (software)
has Repository + Agents; Knowledge → document → back to task; `/projects/x`
redirect.

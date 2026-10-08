# AgentOS

A personal agentic workspace: a calm operator interface over the AgentOS vault.

- `DESIGN.md` — the Editorial Terminal visual language. Authority for all UI.
- `PRODUCT.md` — product context, users, and principles.

## Architecture

State is read locally and cheaply. Reasoning is the only thing that costs an
agent call.

```text
~/AgentOS  ──►  data adapter  ──►  typed JSON  ──►  React Query  ──►  UI
 markdown       localhost:8787      no markdown crosses this line

                Hermes  ◄──  same adapter  ◄──  agent console
             localhost:8642     holds the key

READ STATE                          REASON / ACT
    ↓                                    ↓
local adapter                          Hermes
cheap + instant                     only on request
```

Opening a screen never starts agent work. `/agent` asks Hermes what it supports
and which skills it has — reads that start no run and produce no output — and
other screens contact Hermes only once the command palette is opened. Reasoning
happens only when you send a message or run a command.

| Layer | Responsibility |
| --- | --- |
| `server/agentos/filesystem.ts` | Reads files, confined to the vault root |
| `server/agentos/markdown.ts` | Understands AgentOS markdown conventions |
| `server/agentos/projects.ts` | Portfolio and per-project detail |
| `server/agentos/sessions.ts` | Work sessions written by `/stop-work` |
| `server/agentos/git.ts` | Read-only local branch and working-tree state |
| `server/hermes/client.ts` | The only place the Hermes API key exists |
| `server/hermes/capabilities.ts` | Feature discovery — fails closed |
| `server/hermes/skills.ts` | Skill discovery — normalises Hermes' skill list |
| `server/hermes/approvals.ts` | Records approval decisions — the only write path |
| `server/hermes/runs.ts` | Agent runs: start, poll, stop, steer, stream |
| `server/hermes/sessions.ts` | Hermes session management (`/api` base) |
| `server/hermes/automations.ts` | Hermes' scheduled jobs, read through its CLI |
| `server/connectors/catalog.ts` | Every connector and capability, with its risk and default policy |
| `server/connectors/policy.ts` | The guard each client calls: switched on? policy allows this caller? |
| `server/connectors/probes.ts` | Set-up checks (no network) and "Test connection" (one read) per connector |
| `server/connectors/registry.ts` | Catalog + machine + operator decisions, as `/api/connectors` serves them |
| `server/connectors/env-file.ts` | The only writer of `.env`: allow-listed names, no line breaks, atomic, mode 0600 |
| `server/supabase/setups.ts` | Named Supabase setups and their workspace links; keys stay in `.env` |
| `server/supabase/client.ts` | PostgREST only: listed tables, known columns, one row at a time by primary key |
| `server/connectors/recommendations.ts` | Which connectors a workspace's actual tasks would benefit from |
| `server/operator/intent-router.ts` | `IntentRouter`: `RuleBasedRouter` (default), `HermesRouter` (opt-in); Jev slots in later |
| `server/jarvis/jev-request-router.ts` | Jev: profiles each Jarvis request with a quick Ollama model, then answers, clarifies, or routes to the strong model or a worker. See `docs/jarvis-routing.md` |
| `server/jarvis/default-jarvis-workers.ts` | The Jarvis worker registry: overdue invoices, draft and revise, send a draft (confirm-gated), Hermes handoff |
| `server/operator/runbooks.ts` | The normal flow per request kind: New SaaS, SEO Audit, Business Venture, Workspace task, Ask |
| `server/operator/engine.ts` | Plan → approve → execute → record; Stop halts, cancels jobs, rolls nothing back |
| `server/operator/operations.ts` | What Operator can do today, each an existing AgentOS operation |
| `server/operator/project-folder.ts` | New project folders: only `<AGENTOS_PROJECTS_ROOT>/<slug>`; a missing root (unplugged SSD) is reported, never created |
| `src/features/voice/push-to-talk.ts` | Hold Control alone to talk, let go to send; any other key makes it a shortcut and discards the recording |
| `src/features/voice/small-talk.ts` | Greetings, thanks, goodbye: answered instantly in Jarvis's voice, time-aware, no model call |
| `src/features/operator/jarvis-operator.ts` | Jarvis on Operator: voice commands, the spoken approve → confirm gate, run narration |
| `server/workers/worker.ts` | The provider-neutral worker contract |
| `server/workers/registry.ts` | Which workers exist; the only place one is named |
| `server/workers/job-manager.ts` | Validates, isolates, runs, records |
| `server/workers/worktree.ts` | Isolation: a worker never edits the live checkout |
| `server/workers/context-builder.ts` | The scoped handoff packet |
| `server/designs/media.ts` | Image storage, outside the vault |
| `server/designs/library.ts` | What an image means: project, tags, boards |
| `server/activity/` | Aggregates every source into one timeline |
| `server/activity/ui-events.ts` | Append-only record of decisions and outcomes |
| `server/agentos/session-store.ts` | Project → session mappings (the only write) |
| `server/agentos/session-resolver.ts` | One durable session per project |
| `server/agentos/dashboard.ts` | Turns files into dashboard data |
| `server/agentos/mutations/writer.ts` | The only path that writes project state |
| `server/agentos/mutations/revision.ts` | What "the file I read" means; conflict detection |
| `server/agentos/mutations/task-document.ts` | `TASKS.md` as a line-preserving document |
| `server/agentos/mutations/tasks.ts` | Task CRUD |
| `server/agentos/mutations/projects.ts` | Creating, configuring and archiving projects |
| `server/agentos/mutations/decisions.ts` | Decisions, as revisable topic sections |
| `server/usage/db.ts` | The telemetry store — SQLite, disposable, never authoritative |
| `server/usage/ledger.ts` | Every execution's tokens and cost, in one shape |
| `server/usage/collector.ts` | Where a call site turns into a ledger entry |
| `server/usage/metrics.ts` | Breakdowns, agent records, anomalies |
| `server/usage/operations.ts` | Assembles the Operations screen |
| `server/usage/providers/` | One module per runner: its usage, normalised |
| `server/validation-sprint/store.ts` | What a person noticed; the only thing the sprint writes |
| `server/validation-sprint/sprint.ts` | Joins that onto the job record and scores it |
| `server/traction/store.ts` | Prospects, ICP, offers, experiments — the local CRM, outside the vault |
| `server/traction/engine.ts` | The daily queue, warnings and weekly figures — deterministic, no model |
| `server/traction/crm-provider.ts` | `CrmProvider`: local today, Virtec later, no UI change |
| `server/virtec/client.ts` | The only place the Virtec keys exist; HTTPS, no redirects; two fixed PATCH routes behind a separate write key |
| `server/virtec/writes.ts` | Each write-back, the action that causes it, and its reported outcome |
| `server/virtec/normalise.ts` | Virtec's payloads read tolerantly; only fields a screen uses are kept |
| `server/virtec/snapshot.ts` | All six Virtec reads, settled independently, cached five minutes |
| `server/traction/case-studies.ts` | Which finished projects deserve a case study, and what Hermes is told about one |
| `server/traction/case-study-draft.ts` | The one Traction agent call that writes back — into empty sections only |
| `server/traction/crm.ts` | Virtec in Traction's terms: follow-ups as queue items, leads/clients as prospects |
| `docs/traction/ROADMAP.md` | What Traction has, what is next, and what is parked |
| `shared/agentos-types.ts` | The wire contract (zod schemas + derived types) |
| `src/lib/agentos/` | React client and queries |

The adapter reads `~/AgentOS` **read-only** and binds to `127.0.0.1` only. The
frontend never sends a path — the server decides which vault files may be read.

React never writes AgentOS files. Every mutation takes one route:

```text
UI  ──►  Hermes  ──►  approval  ──►  AgentOS
```

The console can propose and approve; only Hermes writes. The approval endpoint
sends a decision and nothing else — no file content, no patch — so there is no
path by which the browser could change the vault even if it tried.

Its one write is `~/.agentos-ui/sessions.json`, private UI state holding
project → Hermes session ids. Nothing machine-generated is written into the
vault, and no transcript is written anywhere — Hermes owns those.

| Layer | Owns |
| --- | --- |
| `~/AgentOS/*.md` | Project and business state |
| Hermes sessions | Conversation history |
| `~/.agentos-ui` | Small UI mappings |
| React | Presentation only |

When Tauri is enabled, native commands replace the Node layer behind
`src/features/dashboard/use-dashboard-data.ts`. No component changes.

## Development

```bash
npm run dev
```

Starts the Vite app on <http://localhost:1420> and the data adapter on
<http://127.0.0.1:8787>. Vite proxies `/api` to the adapter, so no CORS is
involved. Run them separately with `npm run dev:web` and `npm run dev:data`.

| Script | Purpose |
| --- | --- |
| `npm run dev` | App + data adapter together |
| `npm run typecheck` | App and server projects |
| `npm test` | Adapter parser and filesystem tests |
| `npm run lint` | ESLint across app and server |
| `npm run build` | Typecheck, then production bundle |

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTOS_ROOT` | `~/AgentOS` | Vault the adapter reads |
| `AGENTOS_PORT` | `8787` | Adapter port (Vite proxies to it) |
| `HERMES_BASE_URL` | `http://127.0.0.1:8642/v1` | Hermes, OpenAI-compatible |
| `HERMES_API_KEY` | — | Required to use `/agent` |
| `HERMES_MODEL` | `hermes` | Model name sent to Hermes |
| `HERMES_API_BASE_URL` | `<origin>/api` | Session management base (Hermes serves it separately from `/v1`) |
| `AGENTOS_UI_DIR` | `~/.agentos-ui` | Where project → session mappings live |
| `VIRTEC_BASE_URL` | — | Virtec deployment, `https://` (read-only CRM data for Traction) |
| `VIRTEC_API_KEY` | — | The value Virtec holds as `AGENTOS_API_KEY`; server-only |
| `VIRTEC_WRITE_API_KEY` | — | Optional write-back: Virtec's `AGENTOS_WRITE_API_KEY`, a different secret; server-only |
| `AGENTOS_PROJECTS_ROOT` | — | Where Operator creates new project folders (e.g. `/Volumes/SSD/Developer`). Settable in Connectors → Local filesystem. Must already exist |
| `AGENTOS_OPERATOR_ROUTER` | `rules` | `hermes` to classify requests with Hermes; falls back to rules on any failure |
| `AGENTOS_VISUAL_PREVIEW_COMMAND` | — | How to serve a worktree for visual verification; `{port}` is substituted |

Copy `.env.example` to `.env` and add your key:

```bash
cp .env.example .env
```

`.env` is gitignored. The key is read by the Node server only — it is never
given to Vite, never sent to the browser, and never appears in a response, an
error message, or the built bundle. React posts to `/api/agent/message`; the
adapter adds the `Authorization` header.

### Vault files read

`me/CURRENT_FOCUS.md`, `projects/PORTFOLIO.md`, `projects/<slug>/PROJECT.md`,
`projects/<slug>/STATUS.md`, `projects/<slug>/TASKS.md`,
`projects/<slug>/DECISIONS.md`, `logs/work-sessions/<slug>/*.md`,
`logs/daily/*.md`, `inbox/CAPTURE.md`.

A project's `## Connected Systems` may link a `Local repository:` path. Only
`git branch --show-current` and `git status --short` are ever run against it,
through `execFile` with an argument array and never a shell.

Every one is optional. A missing file or section drops a single field rather
than failing the request — but a failed read is shown, never replaced with
placeholder content.

The dashboard reads detail only for live, high/medium-priority projects, so
parked work costs nothing beyond its portfolio entry. The projects screen exists
to browse everything, so it reads detail for the whole portfolio.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Mission Control — what matters, what needs you, what is running, what is broken |
| `/operator` | Operator as a conversation, led by Jarvis: Ask / Plan / Run, progress then a breakdown per request |
| `/operator/runs/:id` | The conversation with one run's full record open: decisions, plan, approval, steps, audit |
| `/traction` | Customer acquisition: today's queue, prospects, pipeline, waiting on, clients & referrals, case studies, Virtec, offers, experiments, weekly review |
| `/projects` | Portfolio, grouped by state |
| `/projects/:slug` | Project workspace (Overview, Tasks, Decisions, Sessions, Git) |
| `/agent` | Hermes operator console |
| `/automations` | Hermes' scheduled jobs, and their health |
| `/automations/:id` | One automation: schedule, last run, run history |
| `/activity` | Unified timeline across every source |
| `/designs` | The visual library; `?project=` filters, `?asset=` opens one |
| `/designs/boards` | Every board |
| `/designs/boards/:id` | One board, its references and its notes |
| `/workers` | The roster, and recent delegated jobs |
| `/workers/jobs/:id` | One job: activity, result, worktree |
| `/operations` | Usage, agents, models, projects, cost |
| `/operations/agents/:id` | One agent: configuration, spend, jobs |
| `/design-system` | Visual foundation reference |

| Endpoint | Returns |
| --- | --- |
| `/api/health` | Adapter status and vault root |
| `/api/dashboard` | Focus, next action, and the live portfolio |
| `/api/mission-control` | Everything Mission Control shows, in one read |
| `/api/projects` | The whole portfolio |
| `/api/projects/:slug` | One project's detail; 404 for an unknown slug |
| `/api/workers` | Every worker, and whether each can be used |
| `/api/workers/:id/health` | One worker's health; fails closed |
| `/api/worker-jobs` | Delegates a job (POST); lists them (GET) |
| `/api/worker-jobs/:id` | One job |
| `/api/worker-jobs/:id/events` | SSE: recorded events replay, then live ones |
| `/api/worker-jobs/:id/cancel` | Stops a running job (POST) |
| `/api/worker-jobs/:id/steer` | Passes guidance to a running job (POST) |
| `/api/worker-jobs/:id/visual` | The visual verdict and every earlier revision's; re-photographs the work (POST) |
| `/api/worker-jobs/:id/visual/:revision/:filename` | One captured screenshot |
| `/api/worker-jobs/:id/visual-revision` | Sends the visual findings back to the worker (POST) |
| `/api/designs` | The whole library: assets and boards |
| `/api/designs/assets` | Adds one image (POST); the body is the file |
| `/api/designs/assets/:id/media` | Serves an image; `?size=thumbnail` for the rendition |
| `/api/designs/assets/:id` | Updates (PATCH) or removes (DELETE) one asset |
| `/api/designs/boards` | Creates a board (POST) |
| `/api/designs/boards/:id` | Updates (PATCH) or removes (DELETE) a board |
| `/api/designs/boards/:id/assets/:assetId` | Adds (PUT) or removes (DELETE) membership |
| `/api/projects` | Creates a project (POST) |
| `/api/projects/:slug` | Changes name, goal, type, state or priority (PATCH) |
| `/api/projects/:slug/archive` | Puts it away (POST); `/restore` brings it back |
| `/api/projects/:slug/tasks` | Tasks with their revision (GET); adds one (POST) |
| `/api/projects/:slug/tasks/reorder` | Reorders a section (POST) |
| `/api/projects/:slug/tasks/:taskId` | Edits (PATCH) or removes (DELETE) one |
| `/api/projects/:slug/decisions` | Reads (GET), records or revises (POST) |
| `/api/projects/:slug/prose` | Status and purpose, with revisions (GET); `/prose/:field` writes (PUT) |
| `/api/projects/:slug/source/:file` | The markdown underneath |
| `/api/backups` | Recent human edits; `/:id/restore` undoes one |
| `/api/operations` | Usage, cost, agents, models, projects, budgets |
| `/api/operations/agents/:id` | One agent in full; 404 for an unknown one |
| `/api/usage/summary` | The compact figures Mission Control shows |
| `/api/usage/tasks/:taskId` | What one task cost, step by step |
| `/api/subscriptions` | Recorded services (GET); adds or updates one (POST) |
| `/api/subscriptions/:id` | Removes one (DELETE) |
| `/api/budgets` | Ceilings (GET); sets one (PUT) |
| `/api/validation` | The validation sprint: tasks, scorecard, friction |
| `/api/validation/tasks` | Starts tracking a task (POST) |
| `/api/validation/tasks/:id` | Records an outcome, a verdict, or one intervention (PATCH) |
| `/api/validation/friction` | Files one friction report (POST) |
| `/api/traction` | Traction in one read: queue, pipeline, warnings, week, experiments |
| `/api/traction/prospects` | Adds a prospect (POST); `/:id` edits (PATCH) or removes (DELETE) |
| `/api/traction/queue/:itemId` | Marks a queue item done or snoozes it (POST) |
| `/api/traction/icp` · `/targets` | The active ICP and the weekly commitment (PUT) |
| `/api/traction/offers` · `/experiments` | Adds (POST); `/:id` replaces (PUT) or removes (DELETE) |
| `/api/traction/waiting` | Adds a Waiting On item (POST); `/:id` replaces (PUT) or removes (DELETE); `/:id/resolve` (POST) |
| `/api/traction/crm/refresh` | Reads Virtec again now, past the cache (POST) |
| `/api/traction/crm/import` | Imports one Virtec lead or client as a prospect, by id (POST); 409 if already imported; a new lead moves to `reviewing` in Virtec when write-back is on |
| `/api/traction/crm/follow-ups/:id` | Marks a Virtec follow-up `sent` or `dismissed` in Virtec (POST); needs write-back |
| `/api/traction/crm/leads/:id/not-a-fit` | Marks a Virtec lead `disqualified` (POST); needs write-back |
| `/api/traction/case-studies` | Starts one — from an opportunity (`{ fromOpportunity }`) or blank (POST); `/:id` replaces (PUT) or removes (DELETE) |
| `/api/traction/case-studies/:id/draft` | One Hermes call; fills empty sections only (POST) |
| `/api/traction/case-studies/:id/testimonial-request` | Puts the testimonial ask on Waiting On (POST) |
| `/api/traction/case-studies/:id/export.md` | The study as Markdown, image paths matching the ZIP |
| `/api/traction/case-studies/:id/export.zip` | `case-study.md` and `images/`, ready for the Virtara site |
| `/api/traction/case-studies/dismiss` | "Not this one" for a finished project (POST) |
| `/api/traction/mail-links` | Confirms a Gmail thread belongs to a prospect, with an optional confirmed stage move (POST); `/dismiss` (POST); `/:threadId` unlinks (DELETE) |
| `/api/activity` | The unified timeline; `?source=`, `?project=`, `?limit=` |
| `/api/activity` | Records an outcome only the browser witnessed (POST) |
| `/api/automations` | Hermes' scheduled jobs, with `cron doctor`'s verdict |
| `/api/automations/:id` | One automation and its execution history; 404 for an unknown id |
| `/api/agent/status` | Whether Hermes is configured (never contacts Hermes) |
| `/api/agent/capabilities` | What this Hermes build supports |
| `/api/agent/skills` | The skills this Hermes has, normalised |
| `/api/agent/message` | One synchronous message (fallback when runs are unsupported) |
| `/api/agent/runs` | Starts a run (POST) |
| `/api/agent/runs/:id` | One run's status |
| `/api/agent/runs/:id/events` | SSE proxy for the run's event stream |
| `/api/agent/runs/:id/stop` | Stops a run (POST) |
| `/api/agent/runs/:id/steer` | Queues guidance into a live run (POST) |
| `/api/agent/runs/:id/approval` | Records a decision on a pending approval (POST) |
| `/api/agent/session` | The project's active session, created on first use |
| `/api/agent/session/messages` | That session's canonical transcript |
| `/api/agent/session/new` | Starts a fresh session (POST); keeps the old one |
| `/api/agent/session/fork` | Branches the current session (POST) |
| `/api/agent/sessions` | Recent sessions, for the history control |

## Agent console

`/agent` sends messages to Hermes through the adapter. Commands are the slash
commands that already exist in Hermes rather than logic reimplemented here.
Selecting a project scopes every request to it.

Agent replies are markdown. They are rendered as React elements — never
injected as HTML — so a reply cannot execute script or smuggle a
`javascript:` link.

### Commands

The console does not keep a list of what Hermes can do. `/api/agent/skills`
asks Hermes, and the adapter normalises the answer: `/start-day`, `start_day`
and `startDay` collapse to one command, a category is read from Hermes or from
the name, and a skill that takes a project is marked as such. React never reads
a Hermes payload. **Adding a skill to Hermes puts it in the console on reload —
no frontend change.**

An entry that cannot be named is dropped and the rest of the list still arrives,
so a renamed field cannot empty the palette. A Hermes that cannot be asked at
all leaves the console on a small built-in baseline, labelled as such rather
than presented as discovered.

Not every skill becomes a button — the design system is explicit about that.
Six earn a permanent place; the rest live in the command palette.

### Command palette

`⌘K` opens it from any screen. Commands are searchable by name, description or
category, and ranked by where the operator already is — on a project screen the
project commands come first, already scoped to that project; elsewhere the daily
ones do. That ranking is route context, not an agent call.

Choosing a project command with no project in context asks which one rather than
guessing. Selecting anything hands the command to `/agent`, which runs it through
the same run system the input uses — the palette never talks to Hermes itself.
The command travels as a search parameter and is consumed once, so a reload
cannot replay a run.

### Sessions

Each project has one durable Hermes session, so a conversation continues across
restarts instead of starting over. The lane is resolved **on the server** from
the project — React never chooses a session id, which is what keeps one
project's conversation out of another's.

`NEW SESSION` starts a fresh lane and leaves the previous session intact in
Hermes; `FORK` branches the current one. Neither deletes anything.

Transcripts are read from Hermes and never cached in `localStorage`. A finished
run reloads the canonical history rather than trusting the streamed tokens as a
record of what happened.

### Approvals and proposals

Two different questions get asked, and the console keeps them apart:

| | Asks | Vocabulary |
| --- | --- | --- |
| **System approval** | May Hermes execute this action? | once / session / always / deny |
| **AgentOS proposal** | Is this change to project state correct? | apply once / reject |

A safe shell command is not the same thing as a correct project decision, so
they are never merged. When Hermes proposes a change, the proposal card shows
the change file by file *and* the exact command that will run, and applying it
answers the gate for that one action only — a proposal can never be approved
for a session or permanently. `Always allow` exists for system approvals alone,
behind an overflow, because it removes a gate forever.

An `approval.request` event stops the run at `WAITING FOR APPROVAL` until a
decision is recorded. The decision is sent to Hermes and the gate is marked
answered only once Hermes acknowledges it — a failed decision leaves the request
pending and says so, rather than showing a run as resumed when it is not.

Proposals are read out of Hermes' reply, from the section the mutation skills
emit before they write: `/project-update`, `/portfolio-update`, `/stop-work`,
`/inbox-review` and `/memory-hygiene` each end with a `Proposed … Update`
heading and one block per file. It is a summary, not a patch protocol: nothing
in the console describes how to apply a change, and nothing applies one.

The skills live in `~/.hermes/skills/productivity/`, not in this repo. A skill
that stops emitting the section still runs correctly — its proposal is simply
shown as prose rather than as a card.

When a run ends, the vault reads are invalidated and the adapter re-reads the
files. Nothing is updated optimistically — the screens can only show a change
that actually happened on disk. Capabilities, skills and sessions are left
alone, since a run does not change them.

### Runs

When Hermes advertises run support, a message starts an *agent run* rather than
a single request. Progress streams back over SSE: tool steps, delegated
subagents, and the reply itself token by token. While a run is live the input
steers it instead of starting a second conversation, and it can be stopped.

Every feature is gated on `/api/agent/capabilities` — nothing assumes support.
A Hermes without runs falls back to plain messaging automatically. Approval
cards require both an advertised capability *and* an actual `approval.request`
event, since Hermes may handle guarded commands itself without surfacing one.

The browser cannot attach a bearer token to a stream, so the adapter proxies it
and forwards the bytes untouched. Event types are interpreted in the browser by
family (`tool.*`, `subagent.*`, `text.*`), and an unrecognised type is kept and
counted rather than dropped or thrown on — a new Hermes event cannot break the
console.

## Automations

Automations are Hermes' own cron jobs. The console reads them; it does not
schedule, edit or delete them — creating a schedule stays in Hermes, where the
scheduler lives.

```text
hermes cron list --all  ─┐
hermes cron doctor      ─┼──►  server/hermes/automations.ts  ──►  Automation[]
hermes cron runs <id>   ─┘        translates CLI output          typed, no CLI
```

The CLI's output format is not contractual, so every reader is tolerant: an
unfamiliar line is skipped, a job that cannot be named is dropped, and the rest
of the listing still reaches the screen. Nothing is flattered — a run whose
outcome Hermes never established is shown as `unknown`, not as a success, and a
result that was produced but never delivered counts as a failure.

Displaying automations costs no model call. **Run now** starts nothing new: it
hands the automation's skill to the agent console through the same `?run=`
handover the command palette uses, so one Runs system streams every execution.

A failing automation reaches Home's Watch section with the reason Hermes gave.
A job you paused or turned off does not — that is a decision, not a problem.

## Mission Control

The screen you open in the morning. It answers four questions in the order they
matter:

```text
PRIMARY FOCUS        what today is for
NEEDS YOU            what cannot proceed without a person
ACTIVE NOW           what is executing
WORKERS · AUTOMATIONS
RECENT ACTIVITY
SYSTEM               the floor it all stands on
```

It replaces the old Dashboard at `/` rather than sitting beside it. Two screens
both answering "what should I do now?" is two screens nobody fully trusts.

**It owns nothing.** Every field is read from a system that already holds it —
the vault for focus, the job store for work, Hermes for schedules, the activity
log for history. It cannot approve, review, revise or schedule anything; every
card is a deep link into the system that owns that decision. If Mission Control
were deleted tomorrow, nothing else would notice.

**Attention is derived, not asked for.** "What needs me?" has a correct answer,
computed from job statuses and automation health with ordinary code. A screen
that asked a model would give a slightly different answer every refresh, which
is exactly the property an operations screen must not have. It also means the
page costs nothing to open and can be polled.

The order is the advice:

```text
1. failed / blocked        something is broken
2. approval required       a decision only a person can make
3. changes required        work that needs sending back
4. review required         work nobody has looked at yet
5. automation attention    a schedule that is not running
6. system warnings         everything else
```

Ties break on age, oldest first. One job produces at most one item: it can be
unreviewed, unverified and waiting for approval at once, but the operator has
exactly one next move on it.

**A calm screen is the goal, not an empty state.** Nothing waiting is a real
answer, and nothing here invents work to fill the space. Amber is a budget —
spent on genuine attention and nowhere else — so a healthy system is quiet and
the one row that matters is visible.

**One source failing is not the page failing.** Five systems are read and
settled independently; a failure degrades its own section and `sources` says
which, because a silently empty list reads as good news.

```text
sources: { vault: "ready", workers: "ready",
           automations: "unknown", hermes: "offline" }
```

**One status vocabulary.** `ready · running · waiting · attention · failed ·
unknown · offline`, shared by workers, automations, and system health. Cron
used to say `healthy`, workers `available` and Hermes `configured` for what an
operator reads as the same fact. `unknown` is never drawn as healthy: a check
that could not be run has not passed.

Refreshed by polling every ten seconds — no SSE. A page aggregating five
subsystems does not need five permanent streams; the live detail lives on each
job's and run's own screen, where a stream already exists.

The sidebar carries the count of things waiting on you, on every screen. It is
decisions requiring a person — never a notification count, so it does not go up
because a machine did some work.

### What "active now" can honestly claim

A worker job's execution is observable: the job manager knows whether a process
is running. A Hermes run is not — its start is recorded by the adapter, but its
end is reported by whoever holds the event stream, so closing the tab mid-run
leaves a start with no end.

Rather than add a registry (which would make Mission Control a source of
truth), unterminated runs are derived from the activity log and marked
uncertain past half an hour, then dropped entirely past six. A job recorded as
running with no live process — the usual cause is a restart — says so too. The
section is only worth having if it is true.

## Workers

Delegated execution, built provider-neutral from the start.

```text
        Hermes            plans, scopes, delegates, reviews
           │
    Worker Manager        validate → resolve → isolate → run → record
      /    |    \
   Grok  Claude  Mock     one scoped job each
      \    |    /
    isolated worktrees
           │
      Hermes review  →  your approval
```

Nothing in `shared/worker-types.ts` knows that any particular runner exists. A
worker implements one small contract — health, start, optionally steer and
cancel — and an adapter's whole job is to make its runner look like that. The
UI never needs to know that one speaks JSON-RPC and another speaks SDK events.

**Grok and Claude are declared, not integrated.** They appear on `/workers`,
say why they cannot be used, and refuse to run. Hiding them would make the
system look smaller than it is designed to be; pretending they work would be
worse. `auto` worker selection is refused for the same reason — routing does
not exist yet, and quietly picking a worker would be a confusing thing to debug
later.

### Isolation is not optional

A coding job with a repository gets its own git worktree on its own branch,
under `~/.agentos-ui/worktrees/`, branched from a resolved commit rather than
"whatever HEAD was". The worker never touches the live working copy, so what it
did can be reviewed as a diff, kept, or thrown away. What changed is read back
**from git**, not taken on the worker's word.

### Scope is the safety property

`context-builder.ts` is the only place that decides what crosses to a worker:
an objective, the few files that bear on it, constraints, acceptance criteria,
and validation commands. Never the vault, the portfolio, or another project.
Standing constraints (stay in the worktree, do not touch AgentOS files, do not
commit or push) are added to every job whether it asked for them or not.

### Jobs are execution history, not knowledge

```text
~/.agentos-ui/jobs/
├── job_abc123.json           the job and its result
└── job_abc123.events.jsonl   what happened, in order
```

Kept out of the vault: the vault records decisions a person made, and a job log
is not one of those. If a result turns out to matter, Hermes can promote it into
AgentOS deliberately.

Events are delivered to subscribers **synchronously** and persisted through a
queue, because order is part of what a log means — "validation started,
validation completed" is a different story from the two arriving the other way
round. A job's screen replays the recorded events, then follows the live ones,
so opening it halfway through still shows the whole story.

### Visual verification

Code can be correct, tested, and reviewed while the screen it produces is
wrong, and a diff cannot show that. So a job that says looking matters gets a
second, separate check:

```text
   worker implements
          ↓
   AgentOS validates          does the build work?
          ↓
   AgentOS photographs        the worktree, run for real
          ↓
   Hermes compares            does it look like what was designed?
          ↓
   you decide
```

The job's `visualAcceptance` is attached when it is created, not reconstructed
afterwards — the brief it came from, the approved board, the routes worth
looking at, and the viewports to look at them in. Absent, or present and off,
and the job never sees a browser: a backend ticket driven through Playwright
costs minutes to conclude nothing.

**The worktree is what gets run, never the source repository.** Screenshotting
the live checkout would verify whatever happens to be open, which is precisely
not the thing under review. `preview.ts` installs the worktree's dependencies
(linking the source tree's when the lockfiles are byte-identical, which is a
shortcut rather than an assumption), starts its own dev server on a free port,
and stops everything it started.

**A route says which screen must come back.** Every screen stamps its identity
into the DOM — `AppShell` renders `<main data-agentos-page="designs">` — and a
route declares the id it expects:

```ts
{ path: "/designs", expectedPageId: "designs", viewports: [...] }
```

This is not decoration. A single-page app answers 200 for a path it has never
heard of, and this one redirects an unknown route to the dashboard, so `/desgins`
would photograph the home screen and nothing would say so. Asking a reviewer to
catch a typo by eye is not a check. The id is declared rather than derived from
the path, because `/projects/pantry-pilot` renders the `project` screen and a
derivation would fail a route that was perfectly correct.

A mismatch stops the whole verification, even when other routes captured
cleanly, and nothing is written to disk. A failure means a page is broken; a
mismatch means the list of routes is wrong, and a verdict drawn from the rest
would be a confident statement about screens nobody asked about. `pageId` is a
required prop, so a screen added later cannot quietly be unidentifiable.

**Design intent is compared, not pixels.** References in this system are
usually inspiration rather than exact mockups, so "17% different from a mood
board" would be a precise answer to a question nobody asked. Hermes is asked
about hierarchy, layout, spacing, typography, colour, component language,
density, and design-system compliance — and is told to keep what it observed
apart from what it recommends. Pixel regression against an exact baseline is a
later, different tool.

**A visual failure is not a technical failure.** A wrong margin never marks a
job `failed`; it asks for changes, which is a different claim about a different
thing. Sending it back sends a different brief too — the code is fine, these
are the only things to change — into the same worktree, and the revision is
then validated, run, photographed and reviewed again. Nothing takes a worker's
word that it fixed anything.

**A verdict that could not be reached is not a pass.** A preview that would not
start, a route that would not load, a Hermes that could not be reached, or
nothing approved to compare against all produce `unverifiable`, with the reason
written down — and `unverifiable` blocks integration exactly as a failure does.

```text
~/.agentos-ui/jobs/job_abc123/visual/
├── r1/designs-desktop.png
├── r1/verification.json
└── r2/…
```

Kept per revision and never overwritten. "Did sending it back actually fix it?"
is a comparison, and a comparison needs the attempt before it.

Playwright is the capture mechanism and makes no judgements:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### The mock worker

`mock` runs the entire pipeline — isolation, events, persistence, streaming,
cancellation — without spending anything. It is deliberately honest about what
it is: it writes no files, and a validation command is reported as *rehearsed,
not executed*, so nothing downstream can mistake a rehearsal for an
implementation.

## Design library

The visual layer. AgentOS markdown stays the knowledge layer, so images are
kept out of it entirely — a vault full of PNGs would turn every reference into
git history.

```text
~/AgentOS-Media/              images, named by asset id
├── originals/
├── thumbnails/               made with macOS `sips`; optional
└── generated/                reserved for generated work

~/.agentos-ui/design-library.json    what each image means
```

React never receives a filesystem path. An asset carries a `url` the adapter
serves by id, exactly as the vault is read: the browser names an id, the server
decides which file that is. An uploaded filename is kept as a **label only** —
the stored name is always `<id><ext>`, so a name like `../../.ssh/id_rsa` is
simply not a name that can reach the filesystem.

Pixel dimensions are read from each file's own header (PNG, JPEG, GIF, WebP) at
upload time, because the masonry grid lays tiles out by aspect ratio before any
image has loaded. A format it cannot read gets a square placeholder rather than
a wrong one.

### Boards hold ids

```text
Asset ──┬── Pantry Pilot — Chef Inspiration
        └── Mobile UI References
```

An asset is never copied into a board. Membership is stored **once**, on the
board; an asset's `boardIds` is derived on read, so the two can never disagree.
Deleting a board leaves its images in the library; deleting an image removes it
from every board it was on.

Every change is a read-modify-write of one JSON file, so writes are serialised
and committed atomically through a temp file and a rename — the library is the
only record of what an image means, and losing it would leave a directory of
anonymous PNGs.

Each project's Overview links to its own slice of the library
(`/designs?project=<slug>`) rather than keeping a second copy of anything.

**Generate** and **Review with Hermes** are visible but disabled, and say they
are not built yet. They are Steps 41 and 42.

## Activity

One timeline answering "what happened across AgentOS". It aggregates; it does
not maintain a second source of truth.

```text
vault files ─┐
Hermes       ─┼──►  server/activity  ──►  normalise ──► sort ──► dedupe
cron history ─┤         one model              newest first
UI events    ─┘
```

| Source | Read from | Events |
| --- | --- | --- |
| `agentos` | `logs/daily`, `logs/work-sessions`, the vault's git log | Work sessions closed, daily logs recorded, checkpoints committed |
| `automation` | `hermes cron runs`, named from `hermes cron list` | Scheduled runs that completed, failed, or are running |
| `hermes` | Hermes' own sessions API | Sessions started, attributed to a project by the lane map |
| `user` | `~/.agentos-ui/activity.jsonl` | Approvals, sessions started or branched, runs started, run outcomes |

Assembling the timeline costs no model call. Every source is read independently
and fails independently: a Hermes that is not configured leaves the rest intact
and is **named in the response**, so a partial timeline says so rather than
reading as "nothing happened".

### The UI event store

Most events are read back out of state that already exists. A few leave no
trace anywhere — a decision on an approval, a session branched, a run reaching
its end — and those are appended to `~/.agentos-ui/activity.jsonl`, outside the
vault, as they happen. It records **decisions and outcomes, never interactions**:
no clicks, no navigation.

Where an event is recorded follows who actually knows:

```text
run started, approval decided, session created  →  the adapter records it
run completed / failed / stopped                →  the console reports it
```

The console reports only an event *type*. Wording, level and source come from
the adapter's own table, and only outcomes are reportable — so nothing can put
prose into an audit trail, or claim a run started that Hermes never began. An
approval is recorded only after Hermes acknowledges it.

The timeline is navigation, not just history: an event links to the project,
automation, or console it belongs to. There is no run screen, so a run id opens
the console it belongs to rather than a page that does not exist. `grok` is
reserved in the model so a delegated worker joins the same timeline without a
schema change.

## Editable workspace

The rule that changed, and the one that did not:

```text
HUMAN ACTION                    AGENT PROPOSAL
create / edit / move a task     any change to the vault
        ↓                               ↓
validated deterministic API           Hermes
        ↓                               ↓
AgentOS Markdown                    approval
                                        ↓
                                 AgentOS Markdown
```

A person editing their own notes does not ask an agent for permission. An agent
changing canonical state still does. Nothing in `server/agentos/mutations` is
reachable by a model, and the approval path is untouched.

### Every write goes through one function

```text
read current file
      ↓
check it is the revision the edit was composed against   → 409 if not
      ↓
apply the change to the parsed document
      ↓
validate the result before it touches disk               → refuse if invalid
      ↓
back up what is about to be replaced
      ↓
write a temporary file, then rename over the target      → atomic
```

The validation runs on the *result*, not the request: a serializer bug that
dropped half a file would pass any input check and is caught here. A write that
would empty a file, lose its title, or shrink it to a third of its size is
refused.

### Conflict detection, because the vault is still hand-edited

Every read returns a `sha256:` revision of the exact bytes shown. Every write
sends it back. If the file moved — an editor, or Hermes — the write is refused
with a 409 carrying the current revision, and the console offers a reload
rather than silently winning.

Content-addressed rather than mtime or a counter: mtime lies on copies and
restores, and a counter drifts the moment a file is edited outside AgentOS.

### The document model preserves what it does not own

`TASKS.md` is parsed into blocks where **only task lines carry structure** and
everything else remembers its raw text. Serialising is reassembly, not
regeneration, so prose, blank lines, `*` bullets and unknown headings survive by
construction. A real vault file contains this:

```markdown
## Later

Only move items here once current work is stable.

## Rule

Prefer completing existing tasks before adding additional features.
```

None of it is data, all of it is the operator's writing, and a model that
rebuilt the file from parsed tasks would delete it the first time someone ticked
a checkbox. An untouched file round-trips byte for byte — which is what lets the
writer skip the disk entirely when nothing changed.

### Task ids are spent, never reused

`PP-014` is the join key between a line in `TASKS.md`, a worker job, a review, a
usage record and the activity timeline. The next id is one past the greater of
what is in the file and a durable high-water mark in `~/.agentos-ui`, so
deleting the highest task does not hand its number back out.

### Archive, not delete

A project is never deleted. Worker jobs, usage, designs, decisions, sessions and
activity all reference its slug, so `archived` is a distinct portfolio state —
kept apart from `completed`, because "I shipped this" and "I put this away" are
different claims.

Tasks can be deleted, and the dialog says what survives: the id stays spent and
the costs recorded against it remain.

### Undo, not confirmation

Every human write leaves a backup in `~/.agentos-ui/backups` (40 per file), and
the bar offering to undo appears for twelve seconds afterwards. That is why
completing a task takes one click and no dialog: the mistake is caught *after*
it is visible, which is when it is actually noticed.

### Decisions are topics, not a dated log

The vault keeps decisions as `## Navigation`, `## AI Chef` sections holding the
current position, revised as thinking changes. AgentOS follows that rather than
imposing a reverse-chronological feed: a topic section answers "what did we
settle about navigation", which is the question the file exists for. The date
is a field inside the section, not the organising principle.

## Operations

The third management layer:

```text
MISSION CONTROL   what needs my attention?
PROJECTS          what work needs to get done?
OPERATIONS        how is my AI workforce performing, and what does it cost?
```

### Four things, kept apart

```text
TOKENS         how much context and completion was consumed
COST           what that execution actually cost
ACTIVITY       which agent, job and project caused it
SUBSCRIPTIONS  what recurring services are paid for regardless
```

A $20/month plan and $4.82 of API spend are not the same money. They are listed
separately, added only at the end, and the total says out loud when the metered
half is incomplete.

### Never fake precision

Every figure carries how it was obtained, and tokens carry it separately from
cost — because the two genuinely differ:

```text
12,481 tokens    exact       the provider counted it
~12,500 tokens   estimated   AgentOS derived it, and says so
—                unknown     nobody can say
```

Claude reports exact tokens **and** an exact price. Grok reports exact tokens
and **no price at all** — so its cost renders as `—`, not `$0.00`, and it is
absent from the usage-based cost column with a line saying why. Multiplying
Grok's tokens by a rate table this codebase would have to hardcode and keep
current would manufacture a figure indistinguishable on screen from Claude's
real one.

Totals never round up either: a bucket reports how many of its runs actually
reported tokens and cost, so `$4.82` across three of eleven runs cannot read as
`$4.82` across all eleven. A total is never more confident than the records it
came from — one estimate makes the sum an estimate.

### Attribution is inherited, never re-derived

```text
Project  →  Task  →  Worker Job  →  Provider Run
```

Every Hermes call site names its own operation, so the breakdown is recorded
rather than guessed at:

| Operation | Where it is recorded |
| --- | --- |
| `chat` | The agent console |
| `scoping` | `hermes/task-scoping.ts` |
| `routing` | `hermes/worker-routing.ts` |
| `code-review` | `hermes/worker-review.ts` |
| `visual-review` | `visual-verification/verifier.ts` |
| `design-review` | `designs/design-intelligence.ts` |
| `image-generation` | `designs/generation.ts` |
| `implementation` | The worker, once per run |

That is what turns "Hermes used 900k tokens" into "Hermes visual reviews used
240k tokens" — the difference between a number and a decision.

Worker usage is recorded once per **run**, not once per job: a job sent back
twice writes three entries, because each attempt cost real money and folding
them together would make revisions look free.

### Context size, beside the tokens

A run records how many files and characters it was handed. `94k input tokens`
is a mystery; `94k input tokens, 18 context files` is a context-builder problem.

### Anomalies without a model

A run is flagged when it exceeds twice the rolling average for that exact agent
and operation, measured against AgentOS' own history — never a global notion of
what a run "should" cost. The run is excluded from its own baseline, and the
sample size travels with the finding. Dividing is faster, cheaper and more
reliable than asking a model whether a number looks large.

### Budgets warn; they never act

Crossing one produces a warning and then an attention item. A worker killed
halfway through an implementation because a counter crossed $50.01 loses the
work, orphans the worktree, and costs far more than the dollar it saved.
Claude's per-job budget remains the hard limit, and it is the right shape for
one: scoped to a single run, known before it starts, enforced by the runner
that can stop cleanly.

### Privacy is enforced by the schema

`usage_events` has no column for a prompt, a response, an API key, or a header.
A future caller cannot accidentally persist message content, because there is
nowhere to put it. The collector takes usage blocks and ids; a prompt cannot
reach it. Configuration pages report a key as `Configured` or `Not set` and
never its value.

### Where it lives

```text
~/AgentOS/*.md        project and business truth, human-authored
~/.agentos-ui/*.json  small UI state and execution history
agentos.db            telemetry — queryable, disposable, never authoritative
```

The first place a database is genuinely warranted: usage is *asked questions*
rather than read whole, and answering "what did Pantry Pilot cost in September,
by agent" from JSONL means loading the year to summarise a month. Delete
`agentos.db` and AgentOS loses its spending history and nothing else.

Subscriptions are entered by hand. Writing billing integrations for five
providers to learn numbers the operator already knows would break whenever a
dashboard changed and produce figures harder to sanity-check than typed ones.
Where a balance genuinely is one authenticated request — OpenRouter — AgentOS
asks, and fails closed rather than reporting `$0.00` when it cannot.

## Validation sprint

Instrumentation for answering one question the rest of this codebase cannot:
**does the workflow actually finish work faster than doing it by hand?**

It measures the pipeline from beside it. Nothing in `server/validation-sprint`
can start, route, review, approve or integrate anything, and if the whole
directory were deleted the pipeline would run exactly as it does now.

### It stores only what nothing else knows

```text
revisions · durations · cost · routing · review verdict   →  already on the job
what a person had to step in and fix                      →  the sprint store
whether it felt worth it                                  →  the sprint store
where it hurt                                             →  the sprint store
```

Records live in `~/.agentos-ui/validation`, outside the vault and outside the
job store: this is a measurement of AgentOS taken while using it, not project
truth. One JSON file per task, and an append-only `friction.jsonl`. The read
joins the stored half onto the job, so a revision count has exactly one home.

### Absent is not zero

Every figure on the scorecard can be genuinely unmeasured, and each renders as
`—` rather than as `0`. A worker that reports tokens but not dollars leaves the
cost unknown — Grok's runs fill in `turns`, `inputTokens` and `outputTokens`
and deliberately no `costUsd`, because a figure multiplied out against a rate
table this codebase would have to guess at is an estimate wearing a
measurement's clothes. A cost total always says how many tasks it covers.

### Two durations, side by side

```text
Total task time      42m
Worker execution     11m
                     ───
Waiting / review     31m
```

That pairing is why duration is measured at all. Only one of those numbers is
the worker's fault, and a screen showing one of them would send you to fix the
wrong thing.

### Interventions only append

The count of times a person had to step in is the sprint's most valuable
number, and there is no request shape that can shorten the list. An override is
*derived* from the routing decision and shown separately — never added to the
count, because a metric that mixed what was reported with what was inferred
could not be read back.

### Friction is recorded, not solved

`Report friction` sits on Mission Control and on every worker job. Choosing a
category files the report and closes the panel; the note is kept verbatim.
Nothing classifies it, summarises it, shows it to a model, or offers to fix it.
Noticing a problem and fixing a problem are separate activities, and a button
that did both would turn every sprint into a week of building AgentOS instead
of using it.

## Not yet connected

The Today section on the dashboard is placeholder data (labelled as such in the
UI) until a calendar adapter exists.

Proposals are rendered from the text of Hermes' reply. If a skill changes how
it writes its proposal section, the change still runs correctly — it is simply
shown as prose rather than as a card.

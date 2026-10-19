# Agents v1 — make AgentOS agent-driven

Work is currently executed by **workers** (Claude, Grok, Ollama, …) and attributed in Operations as **runtimes**. The operator's team — Chief of Staff, Backend Engineer, Motion Studio — does not exist as a first-class object. Jobs have a worker, a project, sometimes a skill; they do not have an owner on the team.

This plan is the audit, the placement decision, and the v1 contract. Implementation reuses the job manager, model router, Jev, usage ledger, skills, connectors, and Hermes automations. It does not add a second job queue, a second scheduler, or a second approval system.

---

## 1. Audit

### Navigation and tabs

| Operator name | What it is today | Owns workflow? |
| --- | --- | --- |
| **Today** (nav: Dashboard, `/`) | Mission Control: attention, active work, workspace snapshot | No. Reads jobs, automations, activity; links out. |
| **Inbox** `/inbox` | Mail | Mail, not jobs. |
| **Workspaces** `/workspaces` | Portfolio + per-workspace tabs (tasks, agents, …) | Vault tasks; delegates into `startJob`. |
| **Ship** | No tab. Closest: Operator `/operator`, website rebuild, workspace modules | Existing run engines. |
| **Creative / Motion** `/designs`, `/designs/motion` | Library, Animate, Motion Design | Motion Design launches worker jobs; Higgsfield credit-ceiling **approvals stay as they are**. |
| **Finance** `/finance` | Money | Domain engine, not worker jobs. |
| **Traction** `/traction` | Pipeline / CRM | Domain engine. |
| **Knowledge** `/knowledge` | Docs and decisions | Vault. |
| **Career** `/career` | Employment admin | Domain engine. |
| **Operations** `/operations` | Ledger: Usage, **Agents** (runtime spend), AI Stack, Models, Workspaces, Subscriptions & budgets, System, Friction | No writes except budgets/stack already there. |
| **AI Stack** `/operations?tab=stack` | Switches, model routing table | The global task-type → model table. |
| **Sidebar Agents** `/workers` | Worker health + job queue (Claude / Grok / Ollama) | The execution layer. |
| **Operations → agent detail** `/operations/agents/:id` | Per-**runtime** ledger (claude, grok, hermes) | Analytics. |
| **Hermes console** `/agent` | Chat / orchestrator | Not the team roster. |
| **Automations** `/automations` | Hermes cron, read-only in AgentOS | The only scheduler. |
| **Connectors** `/connectors` | Capabilities, skills, policies | Access and skills. |

Today is a consolidation by design (`shared/mission-control-types.ts`): it must not grow a fifth source of truth.

### Worker / job system

- Contract: `shared/worker-types.ts`. Lifecycle: `server/workers/job-manager.ts` (`startJob` is the single front door).
- Persistence: `~/.agentos-ui/jobs/{id}.json` + `{id}.events.jsonl`.
- A job has `worker`, `project`, optional `skill`, `modelRoute`, `effort`, `extraAllowedTools`. **No `agentId`.**
- Launch sites: task delegation, milestone batch, Operator, Motion Design, website rebuild, reengineer, `POST /api/worker-jobs`. Claude Motion writes a worker job record directly (still a job; it must carry an agent).

### Model routing

- `server/model-routing`: classify `plan | execute | motion | normal`, then the AI Stack table (`DEFAULT_MODEL_ROUTING`).
- Explicit tags from a flow win; free-form goes through **Jev** (2s timeout) then a keyword heuristic. Never a paid coding model.
- Caller `modelOverride` / `effort` are kept (`source: "override"`).

### Jev

- Cheap typed-decision classifier (`server/mail/jev-client.ts`), already used by Mail, Finance, Traction, and task-type routing.
- Failure is non-blocking.

### Credit-ceiling approvals

Two existing ceilings, **unchanged in v1**:

1. **Motion Design / Higgsfield** — concept + credit ceiling, `authorizeHiggsfieldSpend`, approval file in the site repo. Inbox card on Today.
2. **Claude per-job USD cap** and **advisory monthly budgets** (`server/usage/budgets.ts`). Warnings, not a new gate.

Agent v1 adds a **monthly credit ceiling on the specialist**. Spend is displayed against it. Launch and Higgsfield approvals are not replaced.

### Skills, connectors, schedules

- Skills: `~/.agentos-ui/skills.json` + skill folders. Copied onto the job at start (`skillForJob`). Connectors they `require` must be connected.
- Connectors: `connectors.json` + `authorize()` / `decide()`. `initiator: "agent" | "person" | "system"` already exists.
- Schedules: Hermes cron (`/automations`). Vault tasks can have a `TaskSchedule`. AgentOS does not run cron itself.

### Persistence convention

```
~/AgentOS/*.md          vault (human-authored)
~/.agentos-ui/*.json    UI state, small registries (connectors, AI stack, skills, sessions)
~/.agentos-ui/jobs/     execution history
~/.agentos-ui/agentos.db  disposable telemetry
```

The specialist registry belongs with the other JSON registries: `~/.agentos-ui/agents.json`.

---

## 2. Where agents live

**Decision: a first-class Operations destination at `/agents` (list) and `/agents/:id` (detail).** Sidebar **Agents** points here. `/workers` remains the runtime job queue, reached from Operations (“Worker jobs”) and from a specialist’s job list.

### Why not the Operations inner tab

Operations is the **ledger** (tokens, stack, models, bills). Its existing **Agents** tab is runtime spend for Claude / Grok / Hermes — a different object. Putting a twelve-person roster, an edit form, memory, and schedules into that tab would mix “what did Sonnet cost?” with “what is Frontend Friend for?”. List + detail + edit also needs a full page, not a tab.

The user suggested Operations; the **operations section of the sidebar** is the right layer. Agents are operational resources (who is on the team, what they may spend, which model they use), sitting beside Operations, Career, Automations, and Connectors.

### Why not Today, a workspace, or `/workers`

- **Today** must stay a read-only consolidation. The roster would become a fifth source of truth.
- **Workspaces** are areas of work; an agent can be *linked* to several. The team is not a workspace.
- **`/workers`** is the execution layer (providers). Specialists *use* workers. Collapsing them would hide Claude vs Grok health behind “Backend Engineer”.

### Presence where work happens

The roster is not the only surface:

| Surface | What v1 shows |
| --- | --- |
| **Today → Active now** | Specialist name (emoji + name) as the actor; worker id stays on `agent` so the Operations runtime graph still matches Claude/Grok. |
| **Job cards** (`/workers`, job detail) | Specialist chip next to the worker and project. |
| **Workspace → Agents tab** | Specialists linked to that workspace, plus that workspace’s jobs tagged with them. |
| **Operations** | Header link to the team; runtime Agents tab unchanged (ledger). |

---

## 3. v1 architecture

```
Registry (~/.agentos-ui/agents.json)
    │  name, avatar, role, mission, standing instructions,
    │  per-task-type model route + allowed overrides, effort,
    │  allowed tools / connectors / skills, credit ceiling,
    │  linked workspaces, schedule links, memory notes
    ▼
startJob  ──►  resolve specialist (tagged flow, else Jev, else heuristic)
          ──►  apply that agent's model / effort / tools / skill allowlist
          ──►  existing worker router, route policy, Higgsfield/job approvals
          ──►  persist agentId on the job
```

Reuse:

| Need | Existing system |
| --- | --- |
| Execute work | `startJob` / job store |
| Pick a model | `resolveModelRoute` + optional per-agent table overlay |
| Classify free-form work | Jev, same client and timeout as task-type routing |
| Spend vs ceiling | Usage ledger joined by `jobId` (no new SQLite column) |
| Skills / connectors | Existing registries; agent allowlists **restrict**, they do not grant |
| Schedules | Optional `automationId` pointing at Hermes automations |
| Approvals | Unchanged |

Every job gets an `agentId`. Old job files without one still parse (`agentId` optional on disk). New launches always set it. Fallback specialist: **Chief of Staff**.

### Routing rules

1. **Tagged.** A flow that knows its owner passes `agentId` (Motion Design → Motion Studio, rebuild → Virtara Desk, reengineer → Site Audit, Claude Motion records → Motion Studio). Task delegation uses the workspace slug against `linkedWorkspaces`, then Jev/heuristic.
2. **Jev.** Free-form briefs choose among the registry (choice question, short mission criteria). 2s timeout, same as task-type routing.
3. **Heuristic.** Keyword score on name / role / mission / keywords / linked workspace vs `project`. Tie or miss → Chief of Staff.
4. **Launch policy.** Agent `modelRoutes[taskType]` overlays the AI Stack table. A request `modelOverride` is kept only if the agent’s `allowedModelOverrides` is empty (unlimited) or contains that model. Effort: request, else agent default, else table. `extraAllowedTools`: union of the request and the agent list (flows such as Higgsfield extras are not stripped). If `allowedSkills` is non-empty, an out-of-list `skillId` is refused. Standing instructions and memory notes are prepended to `constraints`.
5. **Credit ceiling.** Displayed (month spend from the ledger vs `creditCeilingUsd`). Not a new approval dialog. Higgsfield ceilings and job review/approve stay as they are.

### Seed team (editable)

| Id | Role |
| --- | --- |
| `chief-of-staff` | Routes work, chases follow-ups |
| `backend-engineer` | Backend / API / testing; Java, Node, Supabase, Postgres |
| `frontend-friend` | Frontend / UI; React, Next, Expo, Tailwind |
| `growth-lab` | VoxMachine, Jurivo, recurring Virtara income |
| `life-ops` | Fitness, nutrition, personal ops |
| `entelect` | Day-job deep work; Java 8 / Gradle |
| `finance` | Money, budgets, toward R100k+/month |
| `pantry-pilot` | Expo / Supabase meal app, end to end |
| `site-audit` | SEO / speed / a11y / CRO; no invented metrics |
| `ai-teacher` | Practical AI learning and leverage |
| `virtara-desk` | Client delivery and hosting portfolio |
| `motion-studio` | Next.js / GSAP / Three / Framer motion sites |

Seeds are written on first load. Later registry loads do not overwrite edits. New seed ids introduced in a later release are merged in; existing rows are left alone.

---

## 4. UI

- **List** (`/agents`): dense full-width (`PaperStage full`), FilterToolbar (busy / idle / all, linked workspace), DedSec loader, one row/card per agent: avatar, name, role, current job, spend vs ceiling.
- **Detail** (`/agents/:id`): current and recent jobs, spend vs ceiling for the calendar month, linked schedules (Hermes automations when an id is set), memory notes, edit form.
- Visual language: paper world (Operations / Today), not a second design system.

---

## 5. Tests

- Registry: seed on empty store, persist edits, do not overwrite edited seeds, unknown id.
- Routing: tagged flow wins; Jev choice; Jev failure → heuristic; heuristic by keywords and by workspace slug; fallback Chief of Staff; model overlay; disallowed override dropped; skill allowlist refusal; `startJob` writes `agentId`.
- Navigation: sidebar Agents → `/agents`.

---

## 6. Deferred to v2

- Gating launches when an agent is over its monthly ceiling (would be a new approval, which v1 explicitly does not add).
- Hard tool/connector denylists (v1 unions extra tools; empty allowlists mean unlimited).
- Agent-to-agent handoff and Chief of Staff as a live dispatcher (v1 classifies at launch; it does not spawn follow-up jobs).
- Per-agent memory beyond the notes field (vault memory retrieval already runs per job).
- Owning Hermes cron (AgentOS still only displays and links automations).
- Replacing the Operations runtime Agents tab with the specialist roster.
- Multi-agent collaboration on one job; chat threads bound to a specialist.
- Deleting agents, or a marketplace of agent templates.

---

## 7. Files

| Area | Path |
| --- | --- |
| Types | `shared/agent-types.ts`; `agentId` on `shared/worker-types.ts` |
| Registry | `server/agents/store.ts`, `seeds.ts`, `routes.ts` |
| Routing | `server/agents/route.ts`; `job-manager.ts` calls it before the existing model router |
| UI | `src/features/agents/*` |
| Nav | `src/config/navigation.ts` — Agents → `/agents` |

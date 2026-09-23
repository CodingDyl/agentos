# Step 56 — Project Documents & AI Artifacts

Goal: what agents produce stops disappearing into logs. Every worthwhile
Markdown output has a home under its task, a viewer, provenance both ways,
search, and a place in the next worker's context — with the token cost shown.

## Decisions
- Canonical files (`PROJECT/STATUS/TASKS/DECISIONS/MILESTONES.md`) stay
  canonical. Supporting documents live in `projects/<slug>/docs/` (human) and
  `projects/<slug>/artifacts/<TASK-or-job>/` (agent output).
- **Identity is YAML front matter in the file** (`title, type, source, task,
  job, run, created, updated`), read with `gray-matter`; listing is a
  directory scan cached per revision. No side registry.
- Artifact types: plan · research · spec · design · review · report · notes ·
  other. Sources: hermes · grok · claude · human. Origin: `agentos` | `repo`.
- Workers **declare** artifacts by ending their summary with lines
  `Artifact: <path> — <Title> (<type>)`; AgentOS validates (exists, `.md`,
  inside the worktree, size cap), copies into the vault with front matter and
  registers. Undeclared new top-level `.md` files in the worktree are
  registered too, marked `detected`. Never trusts the model's path.
- Repo docs (`README.md`, `docs/**/*.md`, depth ≤ 3, ≤ 60 files) are listed
  with a REPO badge and read in place through a path-safe route. Never copied.
- Viewer: existing safe token renderer extended with tables, task lists,
  images (http(s) only), raw HTML rendered as text. Preview / Source toggle,
  Copy, Open file (reveals path). Read-only for now.
- Hermes proposes documents (`POST …/documents/propose`) → preview → Save
  writes through the mutation layer. Agents propose, humans save.
- Search indexes document content (title match ranks first, then a snippet).
- Delegation gets a Context section: canonical docs + artifacts + repo docs
  with per-doc token estimates (chars ÷ 4) and a total; chosen ones become
  the job's `contextFiles`.
- Structured reviews/verification stay structured; documents never drive state.

## Contracts
- `GET /api/projects/:slug/documents` → `{ agentos: ProjectArtifact[], repo: ProjectArtifact[] }`
- `GET /api/projects/:slug/document?path=&origin=` → `{ artifact, content, revision }`
- `POST /api/projects/:slug/documents { title, type, taskId?, content, filename? }`
- `POST /api/projects/:slug/documents/propose { brief, taskId? }` → proposal (not saved)
- `GET /api/documents/recent?limit=` for Mission Control
- Worker result gains `artifacts: WorkerArtifact[]`; job events `artifact.created`;
  activity `document.created`.

## UI
- Project tab **Documents** (after Roadmap): search, type filters, AGENTOS /
  REPOSITORY groups, `+ New document` (Blank · Ask Hermes); `?doc=` opens the
  viewer in place with provenance (project, task, job/run, created by) and
  `Open task →`.
- Task panel: **Artifacts** section; delegation **Context** picker with tokens.
- Job detail: **Artifacts** section.
- Mission Control: **Recent documents** (low on the page).
- Palette search gains a Documents group.

## Status — 2026-09-21: built and verified

Backend: `agentos/documents.ts` (front-matter scan, repo docs, path-safe
reads, token estimates, canonical entries), `mutations/documents.ts`
(create, worker registration with validation, declaration parsing),
`hermes/document-proposal.ts`, artifact registration in the job run loop,
worker packet instructions, search over document bodies, routes. Also fixed:
retries now carry the task link forward.
UI: Documents tab (search, filters, AgentOS/Repository, Blank/Ask Hermes,
in-place viewer with Preview/Source/Copy/provenance), task-panel Artifacts and
Context picker with token totals, job-page Artifacts, Mission Control Recent
documents, palette Documents group. Markdown renderer gained tables, task
lists, images (http only), HTML-as-text, code language labels. 806 tests.

Verified live: registered the real TECH_DEBT_REPORT.md from the completed
Claude job under PP-002 (detected), viewer rendered its tables and nested
lists, task panel showed it as an artifact, the Context picker pre-ticked
Hermes' four picks (~1.1k) and priced the report (+~5k), ⌘K found the report
by body text ("allergen"), Mission Control listed it.

Left for later: editing documents; document relationships; declared-artifact
path only proven in tests (no worker has declared one yet).

# Video Learning and AgentOS Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pasted YouTube video becomes a `learning` knowledge note and, when asked, an assessment against AgentOS that Dylan approves or declines on the dashboard; approval plans the change and starts worker tasks one at a time.

**Architecture:** A new server module `server/video-ideas/` owns one record per video ("idea") stored in the learning SQLite db, advanced by a 15-second sweeper through stages. The transcript comes from `yt-dlp` captions; the note is a one-shot `claude -p` on the Max plan; the assessment and plan are Claude Code worker jobs in a studio folder (Reengineer's pattern), filed into the vault by AgentOS. Build tasks are created in `projects/agentos-os/TASKS.md` and delegated to Claude Code one at a time.

**Tech Stack:** TypeScript, Express, `node:sqlite`, zod, `node:test` via `tsx --test`, React + TanStack Query, paper UI components.

**Spec:** `docs/superpowers/specs/2026-10-29-video-learning-and-assessment-design.md`

## Global Constraints

- Before any `.tsx`/`.css` change, invoke the `impeccable` and `ui-ux-pro-max` skills (Dylan's CLAUDE.md). UI uses the paper components (`@/components/paper`).
- Work on the current branch (`production`); no worktrees.
- Never save `server/` files while a real worker job is running (it kills the job).
- The video is never downloaded: `yt-dlp` runs with `--skip-download`, captions only.
- YouTube contact is gated by `authorize("youtube.import_video", …)`, same as import.
- Claude calls run on the Max plan: strip `ANTHROPIC_API_KEY` from the env (reuse `planEnvironment()` from `server/designs/motion.ts`).
- Note tag is exactly `learning`. Vault paths: `knowledge/videos/<YYYY-MM-DD>-<slug>.md`, `knowledge/videos/<YYYY-MM-DD>-<slug>.transcript.md`, `knowledge/assessments/<YYYY-MM-DD>-<slug>.md`.
- Note sections, exact headings: `## Brief`, `## The 20% that explains the 80%`, `## Explain it like I'm 10`.
- Verdicts: `adopt | adapt | skip`. Build tasks: workspace `agentos-os`, worker `claude-code`, **max 5 per idea**, **one at a time**.
- AgentOS repo path: `/Users/dylanpetzer/Developer/agentos`.
- Verify with `npm run typecheck` and `npm test`.

## Review Focus

1. **Video with no captions** → idea stops at `needs_transcript` with "This video has no captions", and a pasted transcript resumes it (Task 2, Task 7 tests).
2. **Server restarts mid-stage** → the sweeper picks the idea up from its stored stage; a job that died is shown as failed with Retry, never stuck "assessing" forever (Task 7 test).
3. **Same video pasted twice** → one idea per source; a second "check" request on an idea already past `noted` returns the existing idea (Task 1 test).
4. **Plan with more than 5 tasks, or unparseable plan JSON** → idea goes to `failed` with "Plan too big — split it" / "Plan could not be read", no tasks created (Task 5 test).
5. **A build task's job fails or is cancelled** → the queue pauses and the idea shows which task stopped; later tasks are not started (Task 6 test).

---

### Task 1: Idea types and store

**Files:**
- Create: `shared/video-ideas-types.ts`
- Create: `server/video-ideas/store.ts`
- Modify: `server/learning/db.ts` (append a second entry to `MIGRATIONS`)
- Test: `server/video-ideas/__tests__/store.test.ts`

**Interfaces:**
- Produces (shared):
  - `IdeaModeSchema = z.enum(["learn", "assess"])`
  - `IdeaStageSchema = z.enum(["transcribing","needs_transcript","noting","noted","assessing","awaiting_decision","declined","planning","building","built","failed"])`
  - `VerdictSchema = z.enum(["adopt","adapt","skip"])`
  - `PlannedTaskSchema = { title: string; objective: string; acceptanceCriteria: string[] }`
  - `VideoIdeaSchema = { id; sourceId; videoId; title; mode; stage; error?; notePath?; transcriptPath?; noteId?; assessmentPath?; verdict?; verdictWhy?; size?: "small"|"medium"|"large"; jobId?; plan?: PlannedTask[]; taskIds: string[]; currentTask?: number; declineReason?; createdAt; updatedAt }`
  - `StartIdeaRequestSchema = { sourceId: string; mode: IdeaMode }`, `DecideRequestSchema = { decision: "approve"|"decline"; reason?: string (max 500) }`, `PasteTranscriptRequestSchema = { text: string (1..400_000) }`
- Produces (server): `createIdea(sourceId, mode): VideoIdea`, `getIdea(id)`, `ideaForSource(sourceId)`, `listIdeas(): VideoIdea[]` (newest first), `updateIdea(id, changes: Partial<VideoIdea>): VideoIdea`, `pastDecisions(limit = 20): {title, verdict, decision, reason?}[]`

- [ ] **Step 1: Write the failing tests** — `creates one idea per source`: `createIdea(s, "learn")` then `createIdea(s, "assess")` returns the same id, upgrades mode to `assess`, and keeps stage. `upgrade after noted`: an idea at `noted` with mode `learn` upgraded to `assess` keeps `noted` (sweeper moves it on). `round-trips plan and taskIds` via `updateIdea`. `pastDecisions` returns declined ideas with their reason.
- [ ] **Step 2: Run** `AGENTOS_UI_DIR=$(mktemp -d) npx tsx --test server/video-ideas/__tests__/store.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the types and `store.ts`. Migration 2 adds `video_ideas (id TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, created_at TEXT, updated_at TEXT)`; the record is stored as JSON in `data`, parsed with `VideoIdeaSchema`. Ids: `vi-` + 12 hex. New ideas start at `transcribing`.
- [ ] **Step 4: Run** the test — expect PASS. Also run `npm test -- server/learning` to confirm the migration didn't break learning.
- [ ] **Step 5: Commit** `feat(video-ideas): idea record and store`.

### Task 2: Transcript from captions, and download

**Files:**
- Create: `server/video-ideas/transcript.ts`
- Test: `server/video-ideas/__tests__/transcript.test.ts`

**Interfaces:**
- Produces: `parseVtt(vtt: string): TranscriptLine[]` with `TranscriptLine = { seconds: number; text: string }`; `transcriptText(lines): string` (`[mm:ss] text` per line, `h:mm:ss` past an hour); `fetchCaptions(videoId: string, run?: RunYtDlp): Promise<TranscriptLine[] | undefined>` (undefined = no captions); `ytDlpReady(): Promise<boolean>`; `TranscriptError`.

- [ ] **Step 1: Write the failing tests** — `parseVtt` on an auto-caption fixture with rolling duplicates (`a`, `a b`, `a b c` cues) yields de-duplicated lines; strips `<00:00:01.000><c>` tags and `align:` settings; `transcriptText` formats `[01:05]` and `[1:02:03]`. `fetchCaptions` with a fake `run` that writes no `.vtt` returns `undefined`; with one that writes `x.en.vtt` returns parsed lines and prefers manual `en` over `en-orig`/auto.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `RunYtDlp = (args: string[], cwd: string) => Promise<void>`; default spawns `yt-dlp` (found via `findOnPath`) with `["--skip-download","--write-subs","--write-auto-subs","--sub-langs","en.*,en","--sub-format","vtt","-o","%(id)s.%(ext)s", watchUrl(videoId)]` in a fresh temp dir, 60 s timeout; read the `.vtt`, then delete the temp dir.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): captions via yt-dlp`.

### Task 3: Knowledge note

**Files:**
- Create: `server/video-ideas/claude-print.ts`
- Create: `server/video-ideas/note.ts`
- Test: `server/video-ideas/__tests__/note.test.ts`

**Interfaces:**
- Consumes: `TranscriptLine`, `transcriptText` (Task 2); `updateIdea` (Task 1); `writeAgentOSFile` (`server/agentos/filesystem.ts`); `createNote` (`server/learning/notes.ts`); `planEnvironment` (`server/designs/motion.ts`).
- Produces: `runClaudePrint(prompt: string, options?: { timeoutMs?: number }): Promise<string>` (spawns `claude -p <prompt> --output-format text --setting-sources project --strict-mcp-config`, no tools, Max-plan env, default 5 min); `TRANSCRIPT_BUDGET = 120_000` chars; `notePrompt(meta: {title, author?, url}, transcript: string, trimmed: boolean): string`; `checkNote(markdown: string): string | undefined` (error if any of the three headings is missing); `writeTranscript(idea, lines): Promise<string>` (returns vault path); `writeKnowledgeNote(idea, source: LearningSource, lines, ask?: typeof runClaudePrint): Promise<VideoIdea>`.

- [ ] **Step 1: Write the failing tests** — `checkNote` rejects markdown missing `## Explain it like I'm 10`; `notePrompt` contains the three exact headings and, when `trimmed`, the line "The transcript was trimmed"; `writeKnowledgeNote` with a fake `ask` and a temp `AGENTOS_ROOT` writes `knowledge/videos/<date>-<slug>.md` whose front matter has `tags: [learning]`, `source`, `videoId`, `learningSourceId`, `transcript`; creates a `LearningNote` with tag `learning`, `sourceId` set, content = first paragraph of `## Brief` + `Full note: <vault path>`; idea moves to `noted` with `notePath`, `transcriptPath`, `noteId`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Slug from `slugify` in `server/reengineer/library.ts`. One retry if `checkNote` fails, then `failed` with "The note came back without its sections". Front matter via `gray-matter` `stringify`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): learning note from transcript`.

### Task 4: Assessment job and filing

**Files:**
- Create: `server/video-ideas/studio.ts` (studio folder, shared by Tasks 4 and 5)
- Create: `server/video-ideas/assessment.ts`
- Test: `server/video-ideas/__tests__/assessment.test.ts`

**Interfaces:**
- Consumes: `startJob`, `readJob` (`server/workers/job-manager.ts`); `pastDecisions` (Task 1).
- Produces: `ensureVideoStudio(): Promise<string>` (`<uiStateDir>/video-studio`, a git repo with an initial commit, mirroring `ensureStudio` in `server/reengineer/runs.ts`); `READ_TOOLS = ["Read","Grep","Glob","Write","Bash(ls:*)","Bash(mkdir:*)"]`; `assessmentPrompt(idea, noteMarkdown, decisions): string`; `launchAssessment(idea): Promise<VideoIdea>` (→ `assessing`, `jobId` set); `parseVerdict(text: string): { verdict; why; size } | undefined`; `fileAssessment(idea, studioRoot: string): Promise<VideoIdea>` (→ `awaiting_decision`).

- [ ] **Step 1: Write the failing tests** — `assessmentPrompt` names the repo path, the vault root, the seven sections in order (What it proposes / What AgentOS already does / The gap / How it plugs in / Money and edge / Cost and risk / Verdict), the money-and-edge lens, and lists past declines with reasons; `parseVerdict` accepts `{"verdict":"Adapt","why":"…","size":"medium"}` (case-insensitive) and rejects an unknown verdict; `fileAssessment` copies `ideas/<id>/assessment.md` from a temp studio into `knowledge/assessments/<date>-<slug>.md` with front matter (`verdict`, `size`, `videoId`, `note`) and sets `verdict`, `verdictWhy`, `size`, `assessmentPath`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `startJob({ worker: "claude-code", requestedWorker: "claude-code", project: "video-ideas", repoPath: studio, extraAllowedTools: READ_TOOLS, timeoutMs: 30 min, constraints: ["Do not edit anything outside ideas/<id>/."], validationCommands: [`test -s ideas/<id>/assessment.md`, `test -s ideas/<id>/verdict.json`] })`. If the worker cannot read outside its cwd, symlink the repo and vault into the studio as `agentos/` and `vault/` (read-only by instruction) — check `server/workers/providers/cli-workers.ts` for `--add-dir` support first and prefer it.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): assessment worker and filing`.

### Task 5: Decide, plan, create tasks

**Files:**
- Create: `server/video-ideas/plan.ts`
- Test: `server/video-ideas/__tests__/plan.test.ts`

**Interfaces:**
- Consumes: `launch…` pattern from Task 4 (`ensureVideoStudio`, `READ_TOOLS`); `createTask` (`server/agentos/mutations/tasks.ts`).
- Produces: `MAX_TASKS = 5`; `decide(id, request: DecideRequest): Promise<VideoIdea>` (decline → `declined` + reason; approve → `launchPlan`); `planPrompt(idea, assessmentMarkdown): string`; `parsePlan(text): { tasks: PlannedTask[] } | { error: string }`; `filePlan(idea, studioRoot): Promise<VideoIdea>` (creates tasks, → `building`, `currentTask: 0`).

- [ ] **Step 1: Write the failing tests** — `decide` throws 409 unless stage is `awaiting_decision`; approve works for every verdict, `skip` included (Dylan has the final say); decline stores reason; `parsePlan` returns `{ error: "Plan too big — split it" }` for 6 tasks and `{ error: "Plan could not be read" }` for bad JSON; `filePlan` with a temp vault containing `projects/agentos-os/TASKS.md` creates 3 tasks titled from the plan (ids come back `FEATURE-n`), stores `taskIds` and `plan`, and writes the plan into the assessment note under `## Plan`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Plan worker writes `ideas/<id>/plan.json` (`{"tasks":[{title, objective, acceptanceCriteria}]}`), 1–5 tasks, each objective self-contained and naming files. Tasks go in section `now`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): approve → plan → tasks`.

### Task 6: One-at-a-time build queue

**Files:**
- Create: `server/video-ideas/build.ts`
- Test: `server/video-ideas/__tests__/build.test.ts`

**Interfaces:**
- Consumes: `prepareDelegation`, `delegateTask` (`server/agentos/task-delegation.ts`); `readJob`.
- Produces: `advanceBuild(idea, deps?: { start, read }): Promise<VideoIdea>`.

- [ ] **Step 1: Write the failing tests** (fake `start`/`read`) — with no job yet, starts task 0 and stores `jobId`; job `running` or `awaiting_review` → no change; job `completed` → starts task 1; after the last completes → `built`; job `failed`/`cancelled` → `failed` with `"<FEATURE-n> stopped (<status>) — retry it from Workers, then press Resume"` and no later task started.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `start` = `prepareDelegation("agentos-os", taskId, "claude-code")` then `delegateTask("agentos-os", taskId, { plan: preview.plan, worker: "claude-code", repoPath: "/Users/dylanpetzer/Developer/agentos" })` with the planned objective and acceptance criteria merged into `preview.plan`. Approving the idea is the delegation approval (spec).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): sequential build queue`.

### Task 7: Pipeline, routes, wiring

**Files:**
- Create: `server/video-ideas/pipeline.ts`
- Create: `server/video-ideas/routes.ts`
- Modify: `server/index.ts` (mount `/api/video-ideas`, call `startVideoIdeaSweep()` next to `startReengineerIngest()`)
- Test: `server/video-ideas/__tests__/pipeline.test.ts`

**Interfaces:**
- Produces: `advanceIdea(idea, deps): Promise<VideoIdea>` (one step per call by stage: `transcribing` → captions or `needs_transcript`; `noting`/after transcript → note; `noted` + mode `assess` → assessment; `assessing` → file when job `completed`/`awaiting_review`, `failed` when job failed/cancelled/missing; `planning` → same for plan; `building` → `advanceBuild`); `sweepIdeas()`; `startVideoIdeaSweep()` (15 s, `unref`, guards against overlap); `retryIdea(id)` (failed → stage it failed at, recorded as `failedAt`).
- Routes (zod-validated): `GET /` list; `GET /readiness` → `{ ytDlp: boolean, claude: boolean, missing: string[] }`; `POST /` `StartIdeaRequest` (409 if YouTube connector off); `GET /:id`; `POST /:id/transcript` `PasteTranscriptRequest` (only from `needs_transcript`; splits pasted text into lines with seconds 0 when untimed); `POST /:id/decide` `DecideRequest`; `POST /:id/retry`; `GET /:id/assessment` → markdown; `GET /sources/:sourceId/transcript.txt` → fetches captions now if no idea transcript exists, `Content-Disposition: attachment; filename="<slug>.txt"`, 404 "This video has no captions".

- [ ] **Step 1: Write the failing tests** — stage walk with fakes: learn mode stops at `noted`; assess mode reaches `awaiting_decision`; no captions → `needs_transcript`; a stored `assessing` idea whose job is missing → `failed` with Retry possible (restart case); `retryIdea` returns it to `assessing` and relaunches.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** pipeline and routes; register in `server/index.ts`. Save `server/index.ts` only when no worker job is running.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat(video-ideas): pipeline sweeper and API`.

### Task 8: Learning hub — choose, follow, download

**Files:**
- Create: `src/lib/agentos/video-ideas.ts` (hooks: `useVideoIdeas`, `useVideoIdea(id)`, `useStartIdea`, `useDecideIdea`, `usePasteTranscript`, `useRetryIdea`, `useVideoIdeaReadiness`; poll every 5 s while any idea is in a working stage)
- Create: `src/features/learning/learn-choice.tsx`
- Create: `src/features/learning/idea-status.tsx`
- Modify: `src/features/learning/learning-page.tsx` (after a YouTube import succeeds, show `LearnChoice` under the paste form)
- Modify: `src/features/learning/saved-learning.tsx` (status chip + Download transcript on YouTube sources)

**Interfaces:**
- `LearnChoice({ source, onDone })`: three buttons, exact copy: **Just learn it**, **Learn it and check it against AgentOS**, **Not now**. Disabled with the readiness message when `yt-dlp` or `claude` is missing (e.g. "Install yt-dlp: brew install yt-dlp").
- `IdeaStatus({ idea })`: plain-language stage ("Reading the transcript…", "Writing your note…", "Checking against AgentOS…", "Ready to decide", "Building task 2 of 3", "This video has no captions — paste a transcript"), opens the note in Memory when `noted`, paste-transcript textarea at `needs_transcript`, Retry when `failed`.
- Download transcript = link to `/api/video-ideas/sources/:sourceId/transcript.txt`.

- [ ] **Step 1:** Invoke `impeccable` and `ui-ux-pro-max`.
- [ ] **Step 2:** Build the components; `npm run typecheck` passes.
- [ ] **Step 3:** In the browser preview, paste a captioned YouTube link, choose **Just learn it**, and confirm the chip walks to the note and the transcript downloads as `.txt`.
- [ ] **Step 4: Commit** `feat(learning): learn-or-check choice and transcript download`.

### Task 9: Dashboard "Ideas to decide" and idea page

**Files:**
- Create: `src/features/dashboard/ideas-to-decide.tsx`
- Create: `src/features/video-ideas/idea-page.tsx`, `src/features/video-ideas/index.ts`
- Modify: `src/features/dashboard/dashboard-page.tsx` (rail, above `WatchItem`; hidden when empty)
- Modify: `src/App.tsx` (route `/learning/ideas/:id`)

**Interfaces:**
- `IdeasToDecide`: ideas at `awaiting_decision` — video title, verdict badge (Adopt / Adapt / Skip), `verdictWhy`, size; click opens the idea page. Also lists ideas `planning`/`building`/`failed` compactly so a running build is visible.
- Idea page: full assessment markdown, link to the note, **Approve** (confirm text: "Approving plans this and starts building it, one task at a time. You'll still review each change before it merges.") and **Decline** (optional reason); after approval shows the plan and each task's job status, linking to the worker job. Every run shown names its worker (Claude Code, Max plan) and how long it ran — the spec's "cost visible on the card".

- [ ] **Step 1:** Invoke `impeccable` and `ui-ux-pro-max`.
- [ ] **Step 2:** Build; `npm run typecheck` passes.
- [ ] **Step 3:** In the preview, with a seeded `awaiting_decision` idea, confirm the dashboard card, Decline with a reason (card disappears), and the idea page renders the assessment.
- [ ] **Step 4: Commit** `feat(dashboard): ideas to decide`.

### Task 10: Real run, end to end

- [ ] **Step 1:** `brew install yt-dlp` (ask Dylan first — it's an install on his machine).
- [ ] **Step 2:** With no worker jobs running, restart the server. Paste a real captioned AI/tooling video, choose **Learn it and check it against AgentOS**.
- [ ] **Step 3:** Confirm: note in Memory under `knowledge/videos/` with tag `learning` and the three sections; transcript file beside it; assessment in `knowledge/assessments/`; card on the dashboard.
- [ ] **Step 4:** Report the result to Dylan and let him make the first approve/decline himself. Do not approve on his behalf.
- [ ] **Step 5:** Update the memory file for this feature (`video-learning-assessment.md`) and `MEMORY.md`.

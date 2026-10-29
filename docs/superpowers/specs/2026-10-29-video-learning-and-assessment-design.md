# Video learning and AgentOS assessment — design

Date: 2026-10-29. Status: draft for Dylan's approval.

## Why

Dylan watches a lot of YouTube on AI, business and tooling. Two things get lost:

1. **The knowledge.** Watching isn't learning; a note that explains the core
   ideas plainly is.
2. **The opportunity.** Some videos describe something AgentOS should do. Today
   that idea lives in Dylan's head until it's forgotten.

His stated goal: AgentOS should **make him money and keep him ahead of the AI
curve**. This feature turns videos into either understanding, or a vetted,
approved change to AgentOS that workers build — with Dylan approving at every
step that costs money or changes code.

## The flow

1. **Paste.** On the Learning hub (`/learning`, also reached at `/hub`), Dylan
   pastes a YouTube link exactly as today (`importSource`). After the video is
   saved, AgentOS asks one question with two answers:
   - **Just learn it** → step 2 only.
   - **Learn it and check it against AgentOS** → steps 2–5.
   - A third quiet option, "Not now", keeps today's behaviour (save only).
2. **Knowledge note.** AgentOS gets the transcript and has an AI write a note,
   tagged `learning`, with three sections:
   - **Brief** — what was discussed, in order, short.
   - **The 20% that explains the 80%** — the few core ideas that unlock the rest.
   - **Explain it like I'm 10** — the concepts in plain, child-level language.
   Plus source title, channel, link, and timestamps where the transcript gives them.
3. **Assessment** (workflow only). A worker reads the note, the AgentOS repo and
   the vault (memory notes, existing specs, library) and writes an assessment:
   - What the video proposes, in one paragraph.
   - What AgentOS already does in this area (with file/page references).
   - The gap.
   - How it would plug in: which features, files, and flows it touches.
   - **Money and edge:** how it helps Dylan earn, or keeps AgentOS ahead.
     This is the main lens for the verdict.
   - Cost and risk: rough size (small / medium / large), what could break, ongoing costs (API spend, credits).
   - **Verdict:** Adopt, Adapt (take part of it), or Skip — with the reasoning.
4. **Decide.** The assessment appears as a card on the **Dashboard** ("Ideas to
   decide", in the context rail) and on the source in Learning. Card shows video
   title, verdict, one-line why, and opens to the full assessment. Two buttons:
   - **Decline** — optional reason; filed as declined so the same idea isn't
     proposed again (later assessments see past declines).
   - **Approve** — goes to step 5. A Skip verdict can still be approved; Dylan has
     the final say.
5. **Plan and build** (only on Approve). A worker writes an implementation plan
   grounded in the real code, turns it into tasks in the AgentOS workspace, and
   **starts worker jobs on them immediately**. The plan is readable from the
   card while it runs. Those jobs go through the existing worker review — Dylan
   sees and approves the diff before anything merges. Approving an idea never
   ships unseen code.

States a video moves through: saved → noting → noted → assessing → awaiting
decision → declined | approved → planning → building → (tasks' own states).
Any step can fail; failure shows on the card with a retry.

## Decisions made (Dylan)

- The paste stays where and how it is today; the question comes after.
- "Check against AgentOS" includes the knowledge note; it is never an
  assessment without a note.
- Findings are read and approved/declined on the dashboard.
- Approve → plan → worker tasks start building straight away. Nothing builds
  without that approval. Normal diff review still applies.
- The lens is money and staying ahead of the AI curve.

## Calls made by Claude (check these)

- **Transcript source: captions via `yt-dlp`** (`--skip-download
  --write-subs --write-auto-subs`), run by the AgentOS server. Only caption
  text is fetched; the video is never downloaded, keeping the spirit of
  `server/learning/youtube.ts`. `yt-dlp` is not installed yet (`brew install
  yt-dlp`); the readiness check should say so plainly. Gated by the existing
  `youtube` connector switch (`authorize(...)`), like import.
- **The transcript is kept and downloadable.** Cleaned to plain text with
  timestamps (caption duplicates removed) and saved beside the note at
  `knowledge/videos/<date>-<slug>.transcript.md`. The video in Learning and the
  note both have a **Download transcript** button (a `.txt` file). Dylan can
  also fetch a transcript on its own, from any saved YouTube video, without
  making a note. A hand-pasted transcript is saved the same way.
- **No captions → the note is not written**; the card says "This video has no
  captions" and offers to paste a transcript by hand. A Gemini-reads-the-video
  fallback is a later step, not in this build.
- **Long videos:** transcripts are trimmed to a budget the note model can take;
  if trimmed, the note says so.
- **Where the note lives:** a markdown file in the vault at
  `knowledge/videos/<date>-<slug>.md` (front matter: `tags: [learning]`, source
  url, video id, learning source id), so it appears in the Memory tab, plus a
  `LearningNote` (tag `learning`, `sourceId` set) pointing at it, so it shows on
  the video in Learning and in search.
- **The vault file is the canonical note.** The `LearningNote` is a short stub
  (brief's first paragraph + link to the vault file), so there's one copy to edit.
- **Who writes the note, assessment and plan: Claude Code on the Max plan**, as
  Motion does — no per-call API spend. The card still shows run time and which
  worker ran. If that changes to the paid API later, spend must show on the card.
- **Assessment and plan workers run in a studio folder**
  (`~/.agentos-ui/video-studio`), exactly like Reengineer
  (`server/reengineer/runs.ts`): Write only inside the studio, Read/Grep/Glob on
  the AgentOS repo (`/Users/dylanpetzer/Developer/agentos`) and the vault, no
  repo worktree — so no stray diff-review card. AgentOS files the output into
  the vault itself at `knowledge/assessments/<date>-<slug>.md`, reusing
  Reengineer's ingest step.
- **Approve is the delegation approval.** Approving an idea replaces the
  separate "read the routing plan first" step in
  `server/agentos/task-delegation.ts` for these tasks only — Dylan already read
  the plan on the card.
- **Build tasks go to the `agentos-os` workspace** (task prefix `FEATURE`) and
  **run one at a time**, in plan order: the next starts only after the previous
  one's diff is approved and merged, or is declined. Reason: the server runs
  `tsx watch` from this checkout, and a merge that touches `server/` kills any
  job running beside it. **Cap: at most 5 tasks per approved idea**; a bigger plan
  is sent back as "too big, split it" for Dylan to see.
- **Workers for build tasks: Claude Code**, not the workspace's `auto` routing,
  so cost and behaviour stay predictable.
- **Past declines and approvals** feed the assessment prompt, so the system
  learns Dylan's taste over time.
- **Dashboard placement:** a compact "Ideas to decide" block in the context
  rail, hidden when empty.

## Goals

- One paste → a note worth rereading, in minutes.
- An assessment Dylan can decide on without opening the code.
- Approved ideas start being built with no further typing.

## Non-goals

- Watching the picture (screen demos without narration lose detail).
- Non-YouTube sources (Spotify, podcasts) — later.
- Auto-approving anything.
- Assessing anything other than AgentOS itself (e.g. client sites) — later.

## Anti-goals (failure even if it works)

- Generic summaries that could have come from the title.
- Assessments that ignore what AgentOS already has, or recommend rebuilding
  something that exists.
- Code changes merging without Dylan seeing the diff.
- Spending money (API, credits) without it being visible on the card.
- Lost work if the server restarts mid-run (see worker liveness/retry measures).

## Left to the builder

- Exact prompts, transcript budget, and file schemas.
- How the "learn or check" question is shown (inline after paste is preferred).
- Storage for workflow state (likely the learning SQLite db, next to sources).
- How plan → tasks maps onto the existing task + worker job APIs
  (`server/tasks`, `server/workers/job-manager.ts startJob`).
- Tests, following the repo's existing patterns.
- UI follows the paper UI components already used in Learning and Dashboard.

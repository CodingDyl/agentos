# Delivery harness around the website rebuild

Status: approved by the owner on 2026-11-03 (MVP shape). Phase 1 built.

## Why

The 7-stage website rebuild (`server/website-rebuild/`) works up to the
baseline. The functions stage (W6: forms, blog, bookings) is where it falls
short. The owner also wants one top-level place to pick a workspace and drive
the whole delivery, start from scratch or resume, and optionally add motion.

## What went wrong on Harris Marcus Mahlangu (run 0b2aa3b3)

1. Review findings never reached the next revision. `functionsBrief` got only
   the owner's note, so r2 fixed the footer and nothing the r1 review found
   (1 Blocker: enquiry data in the URL without JavaScript; 4 Major).
2. Both reviews said "not yet ready"; r2 was approved anyway. The gate showed
   no verdict.
3. The stage summary was hard-coded "build, lint and tests pass" while every
   feature was Blocked in the worker's own report.
4. No visitor journeys are tested in a browser: the worker sandbox forbids
   browsers and `server/workers/browser-check.ts` only loads pages.
5. Nothing collects what the features need (Resend key and addresses, booking
   URL, articles, old URLs) or puts it into the Vercel preview, so Blocked was
   guaranteed.
6. Feature recipes were one line each.

## Verified capabilities (not assumed)

- Jev (`server/mail/jev-client.ts`) is TypeSafe System One: typed judgments
  only, used by mail. It does not orchestrate; AgentOS code drives stages.
- Hermes runs the research stage. Slow (~23 s per call).
- Claude Design: no integration in the repo. Only a manual mode (attach
  exported files) is buildable until a connection exists to test against.
- Motion for websites is Motion Design (`server/motion-design`,
  `motion-site-studio` skill, Higgsfield credit gate). Motion studio and
  Claude Motion (Animate) make films, not site interaction.
- One rebuild run per prospect (`runs.prospect_id UNIQUE`): resume means
  reusing that run, never a copy.

## Phases

1. **Functions review loop (built).** `review-verdict.ts` reads the
   reviewer's verdict and findings. The next revision of build and functions is
   briefed with the last review's Blocker and Major findings. The verdict is
   stored on the revision (`revisions.review`); approving with open blockers
   needs `overrideReview` (server-enforced, "approve anyway" box in the UI).
   The functions summary reports each feature's real Pass/Fail/Blocked.
   Recipes now require no-JavaScript POST forms, submission limits, redirects
   for old article URLs, served sitemap/robots and no public placeholders.
2. **Top-level Delivery page (`/delivery`).** Pick a workspace; "Start" or
   "Resume at <stage>" over the existing run. A queue of decisions waiting
   across all workspaces. A surface over the rebuild, not a second pipeline.
3. **Feature intake and journey tests.** A step before functions that collects
   provider settings (stored server-side, pushed to the Vercel preview env),
   articles and legacy URLs; AgentOS runs browser journeys (submit, JS off,
   redirects) on the preview.
4. **Optional motion pass.** After the baseline, run Motion Design on the
   same client repo, keeping its credit approval.
5. **Later.** Manual Claude Design attachments; role and decision rules from
   the owner's epic.

## Non-goals

- No second pipeline, router, dev-server runner or animation system.
- No sending email, booking or publishing on the client's behalf.

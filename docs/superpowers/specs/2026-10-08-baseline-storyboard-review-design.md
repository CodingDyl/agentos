# Baseline storyboard review (Website rebuild, Ticket 1)

Date: 2026-10-08. Status: draft for review. Ticket 2 (customer update requests) reuses this review screen and is out of scope here.

## Goal

While a website rebuild's baseline is being built, Dylan sees every page as a full-page snapshot (desktop and mobile), leaves notes on pages, and sends them back to the worker before the run moves on. After a revision he sees before and after for the pages that changed.

## Decisions already made

- The **baseline is the existing `build` stage** ("Copy and structure"). It is already gated, builds the multi-page Next.js site, and photographs it. No new stage is added.
- Notes may be pinned to a spot on the screenshot. A pin is a position (percent of the full-page image width and height). A section label is attached on a best-effort basis; a position-only pin is enough for v1.
- Page cap is raised from 6 to 20 routes. When `sitemap.json` lists more, the extra routes are dropped and the review says so.
- The hero stage keeps its current concept viewer and notes. Nothing about hero changes.

## Current state (what we build on)

- `buildStage` ([stages.ts](../../../server/website-rebuild/stages.ts)) calls `photographSite`, which serves the built app, reads routes from `sitemap.json` via `routesFrom` (cap 6), and calls `screenshot()` with `fullPage: false`. Images are stored as artifacts named `<route>-<viewport>` per revision.
- Hero notes: `concept_notes` table, `saveConceptNote`, `decide(..., conceptNotes)`, `changeRequestText`, `openChangeRequest`, and `buildBrief(run, concept, changeRequest)` ([store.ts](../../../server/website-rebuild/store.ts), [prompts.ts](../../../server/website-rebuild/prompts.ts)).
- UI: `ReviewPanel` in [rebuild-page.tsx](../../../src/features/rebuild/rebuild-page.tsx) with `ScreenshotGallery` for non-hero stages and `ConceptViewer` (native `<dialog>`) for hero.

## Design

### 1. Full-page snapshots

- `screenshot()` takes an options argument `{ fullPage?: boolean }`; default stays `false` so hero is unchanged.
- `photographSite` passes `fullPage: true` and a route cap of 20. `routesFrom` takes the cap as a parameter (default 6 for other callers).
- Very tall pages: Playwright clips at the browser's 16384 px texture limit. Pages taller than that are captured to the limit and flagged in the artifact title ("cropped"), not silently truncated.
- Snapshots are taken from the same preview build the stage already serves (`serveBuiltNextApp`). Failure to photograph still does not block the stage, but the review panel states plainly that there are no snapshots, and Approve baseline is disabled until they exist (acceptance: every page is shown before the run goes past the baseline). Retry re-runs the photographing.
- Each revision keeps its own images, so the previous revision's snapshots are the "before".

### 2. Page notes (data)

New table `page_notes`, parallel to `concept_notes`:

| column | meaning |
|---|---|
| run_id, stage, revision, route | key; route is the sitemap route, e.g. `/services` |
| id | stable id per note |
| text | the note, max 2000 chars |
| viewport | `desktop` or `mobile`, the image the pin was placed on |
| x, y | percent 0 to 100 of the image, or null for an unpinned page note |
| section | detected nearest heading text, or null |
| updated_at | |

A page can hold many notes. Notes belong to the revision under review and are saved as they are written (same autosave behaviour as concept notes), so they survive a refresh.

API (all under `/:id/stages/build`):
- `PUT /page-notes` replaces the notes for one route and revision (empty list clears them).
- `decide` for `build` accepts `pageNotes` (grouped by route) in addition to the general `note`.

`decide(..., "changes_requested")` for `build` requires at least one page note or a general note. The notes are stored on the `decisions` row (`page_notes` JSON), as `concept_notes` is, so the history keeps exactly what was sent.

### 3. Send changes: the revision brief

`changeRequestText` renders page notes verbatim, grouped by route, in sitemap order:

```
Notes on individual pages (apply each only to the page named; leave every other page unchanged):

/services
- (pinned, desktop, near "Our services" section) <note text exactly as written>
- <unpinned note text exactly as written>

/contact
- ...
```

`buildBrief` (and only for revisions with page notes) adds a scope paragraph: edit only the listed routes and any shared component they cannot be changed without; do not touch other routes' content or layout. After the job, AgentOS checks the diff: routes without notes whose page files changed are reported in the revision summary ("also changed: ..."), which keeps "pages without notes stay untouched" honest. It is a report, not a block, because a shared header edit legitimately touches every page.

The brief text is built from the stored notes with no summarising or rewording. A test asserts that each note string appears in the brief unchanged.

### 4. Re-snapshot and diff

A revision re-photographs all routes. The UI pairs each route's image in revision N with revision N-1.
- "Changed" is decided by comparing image bytes: pixel-identical shots are unchanged. A cheap pixel comparison is enough (no perceptual threshold in v1).
- The before/after view shows only routes that changed. Routes that had notes but did not change are flagged ("no visible change") so a miss is visible.

### 5. UI

A `Storyboard` component replaces `ScreenshotGallery` for the `build` stage inside `ReviewPanel` ([rebuild-page.tsx](../../../src/features/rebuild/rebuild-page.tsx)):

- **Strip**: page thumbnails (desktop/mobile toggle), each with a note-count badge and a "changed" badge after a revision.
- **Viewer**: clicking a thumbnail opens a full-screen native `<dialog>` (as `ConceptViewer`) with the full-page snapshot in a scroll area, a desktop/mobile toggle, previous/next page, and a notes panel for that page.
- **Pinning**: a "Pin a note" mode; click on the image places a numbered pin and focuses a new note field. Pins are listed with their notes; deleting a note removes its pin. Notes can also be added without a pin.
- **Actions** (in the panel footer, same place as the existing buttons): **Send changes** (enabled when there is at least one note; shows the count of pages affected) and **Approve baseline** (the existing approve action, relabeled for `build` only). Both work in the run; no trip to Workers.
- **After a revision**: the strip opens on a "Changes" tab with side-by-side before and after for changed pages.
- Built with the project's paper components and tokens (`PaperButton`, `SegmentedControl`, `FieldLabel`, `PAPER_INPUT`). Keyboard: Escape closes, arrow keys move between pages, pins are focusable with accessible labels. Reduced-motion respected. The `impeccable` and `ui-ux-pro-max` skills are used when the UI is written.

## Error handling

- No snapshots: panel says so, Approve disabled, Retry available.
- Screenshot of one route fails: that route shows a placeholder with the error, others still show; Approve stays disabled until all listed routes have both widths.
- Save of notes fails: inline error and retry on next edit, same as concept notes.
- Revision job blocked: existing blocked-stage flow; notes remain stored with the decision.

## Testing

- Server (vitest, patterns from `website-rebuild-stages.test.ts`): full-page option reaches `screenshot`; cap of 20 and truncation message; `page_notes` save, replace, clear; `decide` validation; `changeRequestText` output groups by route and contains each note verbatim; build brief scope paragraph present only with page notes; untouched-route reporting; before/after pairing and identical-image detection.
- UI: notes can be added with and without a pin and persist across reload; Send changes sends only noted pages; Approve baseline disabled without snapshots; changes tab shows only changed pages.
- Manual end to end with the existing e2e harness: run a rebuild to `build`, add notes on two pages, send, confirm the revision touches those pages and the diff appears.

## Out of scope

- Ticket 2 (client intake, triage, quotes, client-visible status). It will reuse `Storyboard` and `page_notes` on a preview deployment.
- Perceptual image diffing, annotation drawing tools beyond pins, comments by multiple reviewers.
- Changes to hero or functions stage review.

## Open assumptions

- Section detection is best-effort: AgentOS reads headings in the served page and picks the nearest above the pin. If it fails, the pin is position-only.
- Raising the page cap increases screenshot time roughly linearly; 20 pages at two widths is acceptable for a gated stage.

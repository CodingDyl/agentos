# Customer website update requests (Website rebuild, Ticket 2)

Date: 2026-10-08. Status: draft for review. Builds on Ticket 1 (baseline storyboard review): see [2026-10-08-baseline-storyboard-review-design.md](2026-10-08-baseline-storyboard-review-design.md).

## Goal

A repeatable flow for live client sites: a client asks for a change or a new feature, it is triaged and quoted if needed, the AI builds it, Dylan reviews it on the same storyboard screen as Ticket 1, and it is merged and deployed, with the client able to see where it is. It ties into Virtara revenue: small edits are covered by a Care or Maintenance plan; new features are quoted.

## Decisions already made

- **Client surface: email in, email out.** AgentOS is local-only (`127.0.0.1`), so there is no public form or status page. Requests are entered in AgentOS (including from a client's email thread). Status changes are written as draft emails to the client in the existing Mail module; Dylan sends them. Nothing is sent automatically. A public form can come later on top of the same data.
- **Ship step: merge to `main`, let Vercel auto-deploy.** AgentOS merges the approved branch into the client's `main` on GitHub. The site's existing Vercel Git integration deploys it. AgentOS watches that deployment and records its result. No Vercel promote calls, no DNS or domain changes.
- Next.js client sites only in v1, because snapshots and the fallback local preview use the same machinery as the rebuild. Other stacks are blocked with a clear message at the build step, not mid-way.

## Existing pieces this reuses

- Pricing: `priceProjectQuote` and the Care SKU (R1,990/month, "2h small fixes") in [business-quote-pricing.ts](../../../shared/business-quote-pricing.ts). Default rate R300/hour.
- Worker jobs on a client repo: `runJob`, `pickWorker`, `integrateJob` in [workers.ts](../../../server/website-rebuild/workers.ts), and the Next validation commands in `stages.ts`.
- Publishing: `ensureVercelProject`, `pushRef`, `openPreviewsToLinkHolders`, `findPreviewDeployment`, `requestPreviewDeployment`, `readDeployment` in [publish.ts](../../../server/website-rebuild/publish.ts), each behind a connector capability.
- Review: `Storyboard`, `storyboard-model.ts` and the page-notes pattern from Ticket 1; `changeRequestText` for the revise brief.
- Mail drafts: `saveDraft` in [compose.ts](../../../server/mail/compose.ts).
- Clients: `BusinessClient` (`maintenance` flag, email, workspace link) in [business-types.ts](../../../shared/business-types.ts).

## Data model

New module `server/site-requests/` with its own SQLite database (same pattern as `website-rebuild.db`), shared types in `shared/site-request-types.ts`.

**Client site** (one per live site, registered once, can be created from a finished rebuild run):

| field | meaning |
|---|---|
| slug, company | the client's workspace slug and name |
| clientId | the business client, for the contact email and billing |
| repoPath, githubRepo, vercelProject | local checkout, `owner/name`, Vercel project |
| productionUrl | the live site, used for "before" snapshots |
| plan | `none`, `care` or `maintenance` |
| includedHoursPerMonth | 2 for Care; editable per site |

**Request**

| field | meaning |
|---|---|
| id, siteSlug, createdAt | |
| kind | `change` or `feature`, as entered by the requester |
| title, description, page, priority | what they want; priority `low`, `normal`, `urgent` |
| screenshots | uploaded images, stored in the client's workspace folder |
| source | `manual` or `mail` (with the Gmail/Titan thread id) |
| status | see below |
| triage | classification, estimate, reason, covered flag; who set it (`ai` or `person`) |
| quote | lines and total from `priceProjectQuote`, plus accepted date |
| branch, revisions | the request branch and its numbered revisions, each with commit, worker, job, snapshots |
| deployment | merge commit, Vercel deployment id and URL, ready time |

**Status**, and what the client is told (`client label`):

| status | client label |
|---|---|
| `received` (entered, not triaged) | Received |
| `triaged` (classified, awaiting a decision) | Received |
| `quote_needed`, `quoted` | Received (a quote is on its way) |
| `approved` (covered, or quote accepted; build may start) | In progress |
| `building`, `blocked` | In progress |
| `ready_for_review` | Ready for review |
| `shipping` | In progress |
| `live` | Live |
| `declined`, `cancelled` | Closed |

Every status change, decision, note, email draft and deployment is an event row, so each request keeps its own history: the brief, the snapshots, approvals and the deploy (acceptance criterion).

## Flow

### 1. Intake

- **Manual form** in AgentOS: pick the client site, kind, page, description, priority, attach screenshots.
- **From email:** a button on a Mail thread from a known client email (`BusinessClient.email`) opens the same form prefilled with the thread's subject and body and its attachments as screenshots. The thread id is kept as `source`.

### 2. Triage

- AI-assisted: Hermes is asked for `{classification: small_edit | new_feature, estimateHours, reason}` using a system message (SOUL.md otherwise overrides a JSON contract). The answer is validated with zod; if Hermes is unavailable or malformed, triage stays manual and the form is shown empty. Dylan can always override, and the override is recorded.
- **Covered** means: classification is `small_edit`, the site's plan is `care` or `maintenance`, and the estimate fits in the hours left this calendar month (`includedHoursPerMonth` minus the estimate of covered requests approved this month). Otherwise it is not covered, and the reason says which test failed ("no plan", "new feature", "over this month's 2h").
- The estimate is shown with its basis (the AI's reason, or "set by you").

### 3. Quote (only when not covered)

- Status goes to `quote_needed`. Dylan prices it with `priceProjectQuote` (hours × R300 × complexity), edits the lines if needed, and AgentOS drafts the quote email in Mail. "Quote accepted" is recorded by hand when the client agrees.
- **Server-enforced gate:** the build can only start from `approved`, and `approved` is only reachable when the request is covered or its quote is accepted. A not-covered request cannot be built before then, from the UI or the API (acceptance criterion).

### 4. Build

- Approving starts one worker job on the site's repo from an up-to-date `main`, on branch `request/<id>`. The brief is the request: description, page, screenshots listed by path, priority, and the rule to change only what was asked. Validation: the same Next build and lint commands as the rebuild, plus the repo's tests when it has them.
- Before the job, AgentOS photographs the routes from `sitemap.json` (up to 20, plus the requested page) on `productionUrl`: the "before" set.
- The result is integrated onto the branch (never `main`), pushed to GitHub, and a Vercel preview deployment is found or requested (`openPreviewsToLinkHolders` once per project so the preview is reachable). If the preview URL cannot be fetched in time, AgentOS builds and serves the branch locally for the snapshots instead, and says so.
- The "after" set is photographed from the preview, full page at desktop and phone width.

### 5. Review

- The same storyboard as Ticket 1 (`Storyboard`, now fed by the request): pages as thumbnails, full-page viewer, pinned notes per page, and before/after for the pages that changed. The "before" for revision 1 is production; for later revisions it is the previous revision.
- **Send changes** makes revision N+1 with the notes word for word, grouped by page (`changeRequestText`), and re-snapshots. **Approve** moves to ship. Notes live in the site-requests database in a table shaped like `page_notes`.
- The component is generalized to take its data as props; the rebuild screen keeps working unchanged.

### 6. Ship

- Approving calls a new capability `github.merge` (connector catalog, approval policy, initiated by the person pressing the button) that merges the request branch into `main` with the GitHub merges API. A merge conflict or a branch that is behind `main` stops with the reason; AgentOS does not force anything.
- AgentOS then looks for the Vercel production deployment for the merge commit and polls it to ready, with a timeout. Success records the URL and time and sets `live`. A failed deployment sets `blocked` with the Vercel error and nothing is reverted automatically; the history shows exactly what was merged, so a revert is a deliberate action.
- Final status email is drafted: "Live".

### Client status emails

Each client-visible transition (Received, In progress, Ready for review, Live) creates a draft in Mail to the client's contact, from a short template with the request title and what happens next. It is a draft only. The event history records "draft created" and whether Dylan marked it sent.

## UI

- `/site-requests`: list grouped by status, filter by site, "New request" form. Linked from the client's workspace as a Requests tab.
- `/site-requests/:id`: the request's page. Brief and screenshots; triage card (classification, estimate, covered or not, why, override); quote card; build status with the worker and job; the review (storyboard) once there is a revision; the ship step; and a timeline of events.
- Paper components and tokens like the rest of the rebuild UI. The `impeccable` and `ui-ux-pro-max` skills are used when the UI is written.

## Errors and edge cases

- Hermes down or malformed triage: manual triage, no blocking.
- Site has no repo, no Vercel project or no `productionUrl`: the request can be entered and triaged, but the build step is blocked with the missing field named.
- Not a Next.js repo: blocked at build with that reason.
- Worker job fails or finds nothing to change: request goes to `blocked` with the worker's reason; Retry or Try another worker, as in the rebuild.
- Two requests for one site at once: each has its own branch; at ship, the second sees a branch that is behind `main` and is rebased by a new worker revision or stopped for Dylan, never force-pushed.
- Merge happens only after an explicit approve press on a reviewed revision; the approval names the revision, as in the rebuild.
- No public endpoint is added, so there is no client authentication surface.

## Testing

- Server (`node:test`, harness patterns from the rebuild tests, fake workers, GitHub and Vercel fakes as in `website-rebuild-preview.test.ts`): triage coverage rules including the monthly allowance; the not-covered build gate from every entry point; the brief contains the request; branch never touches `main`; revise brief verbatim and grouped by page; before/after pairing; merge conflict stops; deployment success, failure and timeout; status emails drafted per transition and never sent; history keeps brief, snapshots, approvals and deploy.
- UI: model tests for request status labels and grouping, and the pure parts of the form; manual browser check of intake, quote, review and ship against a seeded scratch database, as for Ticket 1.

## Build order (each slice ships on its own)

1. **Data, intake, triage, quote:** site registry, request CRUD, form, list and detail pages, AI triage with override, coverage rule, quote and the build gate. No builds yet.
2. **Build and review:** branch, worker job, before/after snapshots, preview, generalized storyboard, send-changes loop.
3. **Ship and client status:** `github.merge` capability, merge, production deploy watch, status email drafts.
4. **Mail intake:** the "create request from this thread" action.

## Out of scope

- A public request form or client-facing status page (needs hosting; the data model supports it later).
- Non-Next.js sites, rollbacks, and automatic revert.
- Invoicing: accepted quotes are recorded on the request, not turned into invoices.
- Changes to the rebuild's own stages.

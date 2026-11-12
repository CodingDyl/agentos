# Taste Vault

Date: 2026-11-12. Status: building.

## Why

Dylan builds many websites and client-facing apps. He collects references he likes (screenshots, UI components, live sites) and wants one place to keep them, a quick way to hand a chosen set to a workspace or website build, and for Claude to look at that set before it does any design work there.

## What already exists (do not duplicate)

- The **design library** (`server/designs/library.ts`, `media.ts`, routes in `server/index.ts` under `/api/designs`) already stores tagged images with notes, has a `reference` asset type, dedupes by sha256, and serves media by id. The Creative page and workspace Creative tab render it.
- URL screenshots: `server/website-rebuild/references.ts` (`captureReferences`), `screens.ts` (`screenshot`), SSRF guard `checkUrl` in `server/web/safe-fetch.ts`.
- Worker prompts: `buildContextPacket` and `visionAttachments` in `server/workers/context-builder.ts`; job creation in `server/workers/job-manager.ts` (~line 326). Task refs already reach workers through `contextFiles`.

What is missing: URL references, a code snippet on a reference, attaching references to a workspace, a page for all of it, and getting attached references in front of the worker (today only the visual reviewer sees design references).

## Design

Taste Vault is a view over the design library, not a new store. A taste item is a `DesignAsset` with `type: "reference"`.

### Data (shared/agentos-types.ts, `DesignAssetSchema`)

Three new stored fields, all optional or defaulted so the existing library file still parses:

- `sourceUrl?: string` — the page a URL reference was photographed from.
- `snippet?: string` — code for a component he likes (max 20 000 chars).
- `attachedTo: string[]` (default `[]`) — workspace slugs this reference is attached to.

The existing `notes` field is the "why I like it" text. Existing `tags` are the tags.

### Server (`server/taste/`, mounted at `/api/taste`)

- `GET /api/taste` → `{ items: DesignAsset[] }`, every `reference` asset, newest first. Optional `?workspace=<slug>` returns only those attached to it.
- `POST /api/taste/url` body `{ url, notes?, tags? }` → checks the URL with `checkUrl`, screenshots it (reuse existing capture code), stores it as a `reference` asset with `sourceUrl`. Returns `{ asset }`.
- `PATCH /api/taste/:id` body `{ notes?, tags?, snippet?, attachedTo? }` → updates a reference asset. Unknown workspace slugs in `attachedTo` are refused.
- Image upload reuses the existing `POST /api/designs/assets?type=reference`. Delete reuses `DELETE /api/designs/assets/:id`.
- Every body validated with zod. Same localhost / JSON-write guard the reengineer router uses.

### Claude looks first

- `tasteReferencesFor(slug)` returns the references attached to a workspace (cap 12, newest first): file path, filename, notes, tags, sourceUrl, snippet.
- At job creation in `job-manager.ts`, a job whose `project` has attached references gets their file paths added to `contextFiles` (so the existing vision-attachment path carries them) and a `tasteReferences` record kept on the job, fixed at birth like `memoryContext`.
- `buildContextPacket` prints a `Taste references:` section right after `Reference links:` listing each reference with its why-note, tags, source URL and snippet, headed by: these are the owner's chosen inspiration for this workspace; before any design or UI work open every one and say what you are taking from each; they are inspiration for quality and feel, not pixels to copy; ignore them for work with no UI.
- Website rebuild jobs: confirm they go through the same job creation with `project` = workspace slug. If they do not, add the same block where the concept brief is built.

### Frontend (`src/features/taste/`, route `/taste`)

- Sidebar item "Taste Vault" in the `work` section directly after "Creative"; add to the command palette `SCREENS` list.
- Page: grid of references (reuse `DesignGrid` / `DesignTile` / `UploadDropzone` / `AssetLightbox` where they fit). Drop or paste images to add. "Add URL" field. Search box, tag filter, workspace filter.
- Opening a reference shows the image, its why-note, tags, source URL, snippet (monospace, editable) and an "Attach to workspace" picker listing workspaces with a toggle each.
- Workspace Creative tab (`src/features/projects/detail/project-designs.tsx`): a small "Taste references" strip showing what is attached to this workspace, with a link to `/taste?workspace=<slug>`.
- Follows `DESIGN.md` (Quiet Terminal) and uses tokens from `src/styles/agentos.css` only.

## Non-goals

- No second image store, no images in the vault.
- No AI auto-tagging, no taste "profile" or style extraction, no boards changes, no browser extension.
- The workspace `designBoard` setting keeps its meaning (what UI work is reviewed against) and is not reused for attachment.

## Calls made by Claude, not by Dylan

- Built on the design library rather than a new store.
- A snippet always hangs off an image reference; there is no text-only item.
- References are added to every job in the workspace with an "ignore if no UI" line, rather than classifying jobs as design or not.
- Cap of 12 references per job.

## Done when

- `npm run lint`, `npm run typecheck`, `npx vite build`, `npm test`, `npm run test:e2e`, `npm run check:rules` pass.
- Unit tests cover: schema defaults on an old library file, the URL route refusing a private address, PATCH validation and unknown-slug refusal, `tasteReferencesFor` cap and filter, the packet section text, and contextFiles gaining the paths.
- An e2e spec loads `/taste`, uploads an image, attaches it to the fixture workspace and sees it under that workspace filter.

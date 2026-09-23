# Step 57 — Creative Studio + Higgsfield

Goal: `/designs` stops being a library with cards and becomes a media-first
creative feed — inspiration, generations, screenshots and approved work in one
place — with Higgsfield generation driven from inside AgentOS.

## Decisions
- **AgentOS runs the Higgsfield CLI directly** (`~/.local/bin/higgsfield`,
  already authenticated as dylan.petzer@virtara.co.za, starter plan).
  Deterministic, exact cost, no tokens, works with Hermes down.
  **Hermes is the creative director**, not the pipe: it refines prompts and
  proposes directions. This follows the rule since Step 53 — no LLM in a path
  with exactly one right answer.
- **No API key, no second bill.** The CLI spends existing plan credits.
  `generate cost` gives the exact credit price *before* the button does
  anything; the balance is always in view.
- **A project is optional everywhere.** Assets, generations and boards may be
  unassigned. The feed has an `Unassigned` project filter; media for them
  lives under `_unassigned/`. The composer defaults to *No project*.
- `DesignAsset` → `CreativeAsset` migrated in place (kind, mediaType, source,
  project?, product?, prompt, provider, model, generationId, references,
  tags, favorite, approved). Existing assets/boards survive.
- Media lives in `~/AgentOS-Media/creative/<project|_unassigned>/<product|_>/…`
  — never in the vault, never in git. Metadata stays in AgentOS state.
- `/designs` keeps its route; Generations fold into the feed as a `source`
  filter; Boards remain the one sibling.
- Video is supported as a media type from the start (Higgsfield does video);
  the feed renders video tiles with a poster frame.

## Contracts
- `GET /api/creative/assets?project=&product=&kind=&source=&model=&q=`
- `POST /api/creative/upload` (multi-file inspiration import)
- `PATCH /api/creative/assets/:id` (project, product, tags, favorite, approved)
- `GET /api/creative/higgsfield` → `{ connected, email, plan, credits }`
- `GET /api/creative/models` → the CLI's catalogue, cached
- `POST /api/creative/cost` → `{ credits }` for a prompt/model/count
- `POST /api/creative/generate` → generation record; runs the CLI per variation
- `GET /api/creative/generations/:id` → group with prompt, model, outputs
- `POST /api/creative/directions` → Hermes proposes 4 directions (proposal only)

## UI
- Feed: responsive masonry, media ~90% of the surface, metadata on hover.
  Tabs All / Inspiration / Generated / Approved / Favourites; filters for
  project (incl. Unassigned), product, source, model; URL state.
- Floating composer: prompt, model, aspect, variations, references, optional
  project + product, live credit cost and remaining balance.
- Full-screen viewer: media, prompt, model, references, actions (favourite,
  approve, use as reference, generate variation, add to board).
- Operations: Higgsfield panel — plan, credits, generations by project.

## Status — 2026-09-22: core built and verified live

Found on arrival: the Higgsfield CLI integration already existed in
`designs/renderer.ts` with the recommended architecture (AgentOS runs the CLI,
Hermes writes the prompt), but had never succeeded against a live job, priced
nothing, and forced every image into a project.

Built: `designs/higgsfield.ts` (account, model catalogue, real cost) and its
routes; `CreativeAsset` fields on `DesignAsset` (mediaType, source, product,
provider, model, generationId, referenceAssetIds, approved) carried through
the whitelist reader so provenance cannot be erased by a save; composer with
**No project** first and default, product field, 67-model picker (image and
video), live cost and balance; feed filters for Unassigned, product and
source; lightbox approve, product and "how it was made"; Operations
Higgsfield panel.

**Verified live.** Dylan generated two FC 27 images through the new composer
with no project attached: unassigned, `gpt_image_2_5`, one generation group,
balance 210 → 209 — exactly the single credit the composer had predicted.
That falsified the renderer's "unverified against a live job" header, which
was corrected. Approve persists; the Unassigned filter isolates 2 of 3.
811 tests.

Not built yet: Explore Directions (Hermes proposing four directions),
generate-from-board, a generation-group view (the id is stored), reference
thumbnails in the lightbox, and product deep-links from project pages.

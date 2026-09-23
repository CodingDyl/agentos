# Step 58 — Mail: Gmail read-only + Jev classification + Inbox view

## Goal

The first move from "developer cockpit" toward "everyday operating system": a
new **Mail** screen that reads Gmail (read-only), classifies each thread
through Jev (TypeSafe's typed-decision model), and groups threads into three
buckets — **Needs you**, **FYI**, **Low priority** — the way Mission Control
already groups worker jobs and automations into "what needs the operator."

This step is deliberately narrow. It does not touch Workspaces, Business
Operations, Calendar, or Hermes summarize/draft actions — those are later
steps, gated on this one proving that Jev's classification is trustworthy
enough to build on.

## Non-goals (explicitly out of scope for this step)

- Writing to Gmail in any way (no labels, no archive, no send). Scope is
  `gmail.readonly` only.
- Automatic background polling. Sync is a manual **Refresh** button for v1.
- Hermes actions on a thread (summarize, draft reply, extract task). The
  screen only classifies and displays.
- Tracking Jev's accuracy against corrections. Worth doing once there's
  real usage to calibrate against — not before.
- Any change to the existing vault "Inbox" capture count on the dashboard.
  The new feature is named **Mail** specifically to avoid colliding with it.
- A system-wide design system change. The visual language introduced here
  (warm paper/cork aesthetic) is scoped to the Mail screen only, as a trial.

## Architecture

```
Gmail API  →  POST /api/mail/sync  →  agentos.db (mail_threads)  →  GET /api/mail  →  Mail page
                     │
                     ▼
                  Jev API
          (classifies new threads only)
```

Opening the Mail page never calls Gmail or Jev — it reads what is already
stored. A click on **Refresh** is the only thing that triggers a sync: fetch
INBOX thread IDs from Gmail, diff against what is already stored, fetch
metadata for anything new, classify anything new through Jev, store, and
return the updated bucketed list. This mirrors Mission Control's own rule:
attention is computed from stored state, never from a live model call made
just to render a screen.

## Data model

One new table in the existing `agentos.db` (`node:sqlite`, the same store the
usage ledger uses — no new dependency). Denormalized on purpose: the Gmail
summary and the Jev classification are always read together, so they live on
one row rather than a join.

```sql
CREATE TABLE IF NOT EXISTS mail_threads (
  thread_id         TEXT PRIMARY KEY,
  from_name         TEXT,
  from_email        TEXT,
  subject           TEXT,
  snippet           TEXT,
  message_date      TEXT NOT NULL,   -- ISO 8601, from Gmail's Date header
  synced_at         TEXT NOT NULL,   -- when this row was last written

  classified        INTEGER NOT NULL DEFAULT 0,  -- 0/1; false until Jev succeeds
  category          TEXT,             -- client|sales|finance|admin|notification|newsletter|personal|spam
  needs_reply       REAL,             -- 0..1
  urgency           REAL,             -- 1..5
  business          TEXT,             -- a live project name, or "none"
  financial         REAL,             -- 0..1
  action_required   REAL,             -- 0..1
  classified_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_date ON mail_threads(message_date);
```

A thread that fails Jev classification is still stored (`classified = 0`), so
a bad or timed-out Jev call never loses the thread — the next **Refresh**
retries only the unclassified rows, alongside anything newly arrived.

OAuth state is a separate small JSON file, following the existing
`~/.agentos-ui/sessions.json` convention rather than living in the database:

```
~/.agentos-ui/mail-auth.json   { refreshToken, obtainedAt }
```

## Gmail integration

**Auth.** Google OAuth "Desktop app" client (already created — client
ID/secret to be added to `.env`). New env vars, documented in `.env.example`
next to the existing `HERMES_API_KEY` block:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The redirect URI is a route on the existing Express server
(`http://127.0.0.1:8787/api/mail/oauth/callback`) — no second listener. Flow:

1. `GET /api/mail/connect` redirects the browser to Google's consent screen
   (`scope=gmail.readonly`, `access_type=offline`, `prompt=consent` to force
   a refresh token on every connect).
2. `GET /api/mail/oauth/callback` exchanges the code for tokens, writes
   `mail-auth.json`, redirects back to `/mail`.
3. `POST /api/mail/disconnect` deletes `mail-auth.json`.

A `server/mail/gmail-client.ts` mints a fresh access token from the stored
refresh token before each call (cached in memory until near-expiry), mirroring
`hermesFetch`'s single-authenticated-request shape. A refresh failure (token
revoked) is reported as disconnected, not as a crash — the Mail page then
shows the "connect Gmail" empty state again.

**Fetch scope.** `users.threads.list` with `labelIds=INBOX`, capped at the
100 most recent threads on first sync. Only `From`, `Subject`, `Date` headers
and the built-in `snippet` are read (`format=metadata`) — never the full
message body. This is the "sender, subject, thread metadata, minimum useful
body" boundary from the original brief.

## Jev classification

`server/mail/jev-client.ts`, same shape as `server/hermes/client.ts`: a
`JEV_API_KEY` env var, one `sendToJev(state, questions)` call per new thread
against `POST https://api.typesafe.ai/v1/systemone`.

```jsonc
// state sent to Jev — never the full email body
{
  "from": "gavin@example.com",
  "subject": "Vaja configurator pricing",
  "snippet": "Can we push the pricing tiers live before...",
  "date": "2026-09-23T09:42:00Z"
}
```

```jsonc
// questions — "business" criteria built fresh each call from getProjects()
{
  "category": { "type": "choice", "instructions": "...", "criteria": { "client": "...", "sales": "...", "finance": "...", "admin": "...", "notification": "...", "newsletter": "...", "personal": "...", "spam": "..." } },
  "needs_reply": { "type": "noul", "instructions": "Does this email require a reply from the recipient?" },
  "urgency": { "type": "score", "instructions": "How urgent is this for the recipient to act on?", "criteria": ["Not urgent", "Low", "Medium", "High", "Critical"] },
  "business": { "type": "choice", "instructions": "...", "criteria": { "<live project name>": "...", "none": "Not related to any tracked project or business" } },
  "financial": { "type": "noul", "instructions": "Does this email involve money — an invoice, payment, receipt, or financial decision?" },
  "action_required": { "type": "noul", "instructions": "Does this email require the recipient to take an action beyond replying (approve, pay, sign, review)?" }
}
```

`urgency`'s score answer comes back continuous (e.g. `3.4` against the 5-item
rubric, indexed 0–4) and is stored as-is in the `REAL` column; the bucketing
sort and any on-screen label round it to the nearest integer, so precision is
never lost to an early rounding step. Gmail's `Date` header (RFC 2822) is
parsed to ISO 8601 in `gmail-client.ts` before it reaches storage, so every
timestamp in `mail_threads` is ISO, matching every other date field in this
codebase. Failures are classified the same way
`HermesError` classifies Hermes failures (`not-configured`, `offline`,
`timed-out`, `unauthorized`, `failed`) so the sync route can report which one
happened rather than a generic error.

## Bucketing — deterministic, not modeled

`server/mail/bucketing.ts`, a pure function, unit-tested — same philosophy as
`server/mission-control/attention.ts`: Jev's output feeds it, but which
bucket a thread lands in is ordinary code, so the screen says the same thing
twice in a row.

```ts
function bucketFor(t: ClassifiedThread): "needs_you" | "fyi" | "low_priority" {
  if (t.needsReply >= 0.5 || t.actionRequired >= 0.5) return "needs_you";
  if (t.financial >= 0.5 || ["client", "sales", "finance", "admin"].includes(t.category)) return "fyi";
  return "low_priority";
}
```

Within `needs_you`, sorted by `urgency` descending, then `messageDate`
descending. Unclassified threads (Jev failed) are pinned to the top of `fyi`
with a "not yet classified" tag, so a failed classification is visible rather
than silently dropped into low priority.

## API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/mail/status` | GET | `{ configured, connected, lastSyncedAt, threadCount }` |
| `/api/mail/connect` | GET | Redirects to Google's consent screen |
| `/api/mail/oauth/callback` | GET | Exchanges code, stores token, redirects to `/mail` |
| `/api/mail/disconnect` | POST | Clears the stored refresh token |
| `/api/mail/sync` | POST | Fetches new INBOX threads, classifies new/unclassified ones, returns `{ added, failed }` |
| `/api/mail` | GET | Reads stored threads, bucketed and sorted |

All failure modes return the classified reason (`"not-configured"`,
`"offline"`, etc.) in the error body, matching the existing `AgentFailureReason`
vocabulary already used by Hermes and workers, rather than inventing a new one
for this feature.

## Frontend

- `src/config/navigation.ts`: new **Mail** item, position 2 (right after
  Mission Control, matching the "attention layer" placement from the original
  brief).
- `src/features/mail/` — new feature folder, following the existing
  convention (`mail-model.ts` for types + React Query hooks, `mail-page.tsx`,
  `bucket-section.tsx`, `thread-row.tsx`). Clicking a row expands it inline
  in the list (no navigation).
- Empty states: not configured (missing env vars) and not connected
  (configured but no token yet) both use the existing `EmptyState` component
  from `src/components/os/`, worded to say exactly what's missing.
- Once connected, a small **Disconnect** action sits near the refresh button
  (hits `/api/mail/disconnect`), so revoking access never requires leaving
  the app.

**Styling — scoped to this screen only.** A dedicated `src/styles/mail.css`
with its own `--mail-*` custom properties (sandy desk canvas, paper-white
window, hairline borders, amber CTA, flame-orange/moss-green/amber tag
pills), imported only by `src/features/mail/`. It does not touch
`src/styles/agentos.css` or the shared `components/ui` primitives — nothing
else in the app changes. Two new font packages, loaded only by this feature:
`@fontsource-variable/inter-tight` and `@fontsource/ibm-plex-sans` (IBM Plex
Mono is already a dependency). If this style is later adopted app-wide, that
is a separate, deliberate step — not a side effect of this one.

## Error handling

- Neither `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` nor `JEV_API_KEY` set →
  `/api/mail/status` reports `configured: false`; the Mail page shows an
  empty state naming the missing `.env` variables.
- Configured but never connected → empty state with a **Connect Gmail**
  button (hits `/api/mail/connect`).
- A Gmail refresh token that stops working (revoked, expired) → treated as
  disconnected, not a crash; the connect empty state reappears.
- A Jev call failing for one thread never fails the whole sync — that thread
  is stored unclassified and retried on the next **Refresh**, the same
  partial-degradation rule Mission Control already follows for its five
  sources.

## Testing

Following the existing `tsx --test` convention:

- `server/mail/__tests__/bucketing.test.ts` — pure function, the bulk of the
  real logic in this feature.
- `server/mail/__tests__/jev-client.test.ts` — request shaping and failure
  classification, with `fetch` mocked (no live Jev calls in tests).
- `server/mail/__tests__/gmail-client.test.ts` — token refresh and metadata
  parsing, with `fetch` mocked (no live Gmail calls in tests).

OAuth's browser-redirect leg and a real Jev/Gmail call are not covered by
automated tests — verified manually against the real APIs once `.env` is
filled in, the way Hermes and the worker providers already are.

## Follow-ups explicitly deferred

- Automatic polling on an interval.
- Hermes actions on a thread (summarize / draft / extract task).
- Tracking Jev decisions vs. corrections to measure calibration.
- Extending the "business" match beyond current AgentOS projects once
  Workspaces (Step 59+) distinguishes businesses/clients from software
  projects.
- Deciding whether the paper/cork visual style spreads beyond this screen.

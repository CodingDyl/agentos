# Traction — roadmap

Step 60: *Traction — Customer Acquisition Operating System.* The metric that
matters is **qualified customer conversations created per week**, not how
sophisticated the module gets.

## Done

| Phase | What shipped |
| --- | --- |
| 1 | Traction page, daily acquisition queue (Done / Snooze / Open / Ask Hermes), prospects, pipeline, ICP, offer library, experiments, weekly targets, outreach guard, `CrmProvider` + local store, Traction on Today |
| 2 | Waiting On (clients and prospects) with chases in the queue, Gmail reply → prospect suggestions that change nothing until confirmed, Clients & referrals tab, weekly review (deterministic numbers plus Hermes interpretation), linked threads on the prospect, Waiting On and replies on Today |
| 3 | Read-only Virtec connector: money, follow-ups (in the daily queue), pending quotes, active projects, leads and clients to import. Cached five minutes; each endpoint degrades on its own |
| 4 | Case-study engine: finished Virtec projects and completed workspaces become opportunities (and queue items); Hermes drafts empty sections only, marks unmeasured results `[NEEDS DATA]`, never writes the testimonial or mentions prices; a study with gaps cannot be marked ready; testimonial asks go on Waiting On; Markdown export |
| 5 | Virtec write-back behind a separate write key: Done/Snooze on a Virtec follow-up marks it in Virtec, importing a lead moves it to reviewing, "Not a fit" disqualifies it. Virtec side: two allow-listed PATCH routes, constant-time key checks, audit record in the same transaction, per-instance rate limit |
| 6 | Screenshots on case studies: up to 12 Creative images per study (picked from the workspace first, or uploaded from the editor), ordered, exported as a ZIP of `case-study.md` plus `images/` with matching paths. Hermes carries a no-em-dash house style on every call, with replies cleaned as a guarantee |
| 7 | Website lead capture: every form on Virtara (start a project, contact, SEO, packages, health check, audit) and Jurivo's demo request lands in Virtec's `inbound_leads` through a keyed server-to-server route (one key per site; the key sets the track). Unanswered leads sit at the top of the Traction queue; "Replied" makes them a prospect in conversation and marks them replied in Virtec. Virtec has a Website sub-tab to triage them |
| 8 | Lead magnets: a Traction tab where Hermes drafts a checklist, scorecard, guide or template plus its landing page (empty fields only; unknown facts become `[NEEDS DATA]` and block shipping), a Creative cover, a linked offer and a one-click experiment. Export is a ZIP (`<slug>.json`, cover, README) the Virtara or Jurivo repo takes as-is; both sites render `/guides`, `/guides/<slug>` and a soft-gated, printable `/guides/<slug>/read`. Signups reach Virtec as `magnet-<slug>`, are counted per magnet, and carry the magnet's experiment and offer when taken into Traction |
| 9 | Signup email: each magnet has a short plain-text email (Hermes drafts it with the rest; `{{firstName}}`, `{{link}}`) that Virtec sends through Resend the moment someone signs up. Switched on, updated and off from AgentOS (PUT to Virtec, audited); it links to the read page with `?via=email`, which both sites let straight in. Sent and failed counts per magnet; the outcome is on each lead in Virtec |
| 10 | Second touch: a magnet signup who got the guide email is left alone for 3 days, then becomes a "Second touch" queue item; Hermes drafts a short personal note from the guide and the email they already got, and "Sent" makes them a contacted prospect (counted as outreach, tagged with the magnet's experiment) so ordinary follow-ups take over. A signup who wrote back (a message from their address in the Inbox cache since signing up) jumps to "Reply" at the top; one whose guide email failed gets "Reply" at once |
| 11 | Replies in the queue: a message from a prospect we are working on (target to proposal) that is newer than our last touch becomes a top-of-queue "They replied" item with the message preview, replacing the misleading "no response" follow-up. Ask Hermes drafts the answer (their words fenced, told to ask for the rest rather than guess); "Move to conversation" and "Not theirs" are in the item; "Replied" records the touch and clears it. Linking a thread does not clear it, only answering does |

## Next

1. **Prospect email in Virtec sends**: a Traction prospect can be told the
   same day a Virtec quote or agreement is opened by the client, once Virtec
   records opens (not built; needs a Virtec change first).
2. Places + Jev profiling of local candidates (parked below).

## Parked — noted, not started

### Local prospect discovery: Google Places API (New) + Jev profiling

Requested by Dylan, to build once the manual loop is running daily.

**Update (phase 3):** Virtec's leads already carry `googlePlaceId`,
`lat`/`lng`, `rating`, `reviewCount`, `scanRunId`, a 0–100 `score` and
`scoreReasons` — Virtec appears to run Places scans itself. Before building
discovery in AgentOS, check whether extending Virtec's scan (new areas, the
ICP's category) and adding Jev scoring there is the better home; AgentOS
already imports the results.

**Idea.** Pull candidate businesses near him that match the active ICP (e.g.
estate agencies in Johannesburg) from the **Places API (New)**, then have
**Jev** profile each one against the ICP so only good fits become prospects.

**Shape it would likely take**

```text
ICP (segment + geography)
   ↓
Places API (New) — Text Search, e.g. "estate agency in Johannesburg"
   ↓  name, address, website, rating, review count, place id
Jev — score each candidate against the ICP's "ideal prospect" traits
   ↓
Candidate list in Traction → a person accepts → becomes a Prospect (source: other/outbound)
```

- Server-side only. `GOOGLE_PLACES_API_KEY` lives in `.env` beside
  `JEV_API_KEY` and never reaches the browser — the same rule as Hermes.
- Jev already has a client (`server/mail/jev-client.ts`) using `choice` /
  `score` questions; profiling would reuse that pattern with ICP criteria.
- Candidates are suggestions. Nothing enters the pipeline without a person
  accepting it — the same rule as Gmail suggestions.
- Use a field mask on every Places request; the new API bills by the
  fields requested.

**Check before building** (not verified yet):

- Google Maps Platform terms limit how long most Places content may be
  cached; place IDs are the exception. Store the place ID and re-fetch
  details rather than keeping copies.
- POPIA restricts unsolicited electronic direct marketing to individuals.
  Business contacts are treated differently, but get this checked before
  cold-emailing anyone found this way.
- Cost: set a monthly cap on the Places key before it is used in a loop.

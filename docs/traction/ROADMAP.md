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

## Next

1. **Screenshots on case studies** — link Creative assets to a study, so the
   Markdown export carries its images.
2. **Lead magnets** — Hermes content + Creative visuals + a landing page, with
   an experiment tracking it.

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

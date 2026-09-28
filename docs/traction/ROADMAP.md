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

## Next

1. **Virtec write-back** — once Virtec has write endpoints (its `AGENTOS.md`
   lists them as phase 2): mark a follow-up sent, move a lead's status. Until
   then, handling a Virtec follow-up in AgentOS only holds it off the queue
   for three days.
2. **Case-study engine** — a completed workspace milestone raises a case-study
   opportunity; Hermes drafts Problem / Solution / Implementation / Result.
3. **Lead magnets** — Hermes content + Creative visuals + a landing page, with
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

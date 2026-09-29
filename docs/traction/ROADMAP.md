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
| 12 | ICP fit scoring: Jev scores Virtec's Places candidates against the ICP (0 to 4, plus whether the data shows a checkable gap). On demand, 15 a click and 60 a day, remembered until the ICP changes. Only public business details are sent (never an email or phone). The list re-ranks: good fits first, unscored by Virtec's score, poor fits last; importing carries Jev's fit into the prospect. Places discovery stays in Virtec, which already runs the scans and holds that key |
| 13 | Client opens a quote or agreement: Virtec already stamped `portalLastViewedAt` per project; it now ignores link-preview bots, scanners and the operator's preview, so "opened" means a person. AgentOS reads it: a client who opened their portal within 7 days, after the quote existed, with the quote still pending or the agreement unanswered, gets an "Opened" queue item, or, when Virtec already has a quote or agreement follow-up due for them, that follow-up says so and moves up. Ask Hermes drafts a light note and is never told when they opened it, and is told not to hint at it. Done holds it a week; a view on another day raises a new item |
| 14 | Loose ends: the blog newsletter signup and the Unsubscribe page wrote to Firestore from the browser, which the CRM's rules refuse, so both had never worked for visitors. They now go through virtara-backend to a new Virtec route (`/api/inbound/subscribers`, site key, same answer whether or not the list changed). The Firebase client and its hardcoded config are removed from the Virtara site. `/api/send-email`, which sent any caller's raw HTML as info@virtara.co.za, is escaped, size capped, rate limited and prefixed until it can be deleted |

## Next

1. **Places scan for the ICP** (parked below), once the two checks are done.
2. **Per-quote views** would need Virtec to stamp each quote, not the project;
   today a view means "the portal", and the item says so.

## Parked, noted, not started

### Local prospect discovery in the ICP's own area (Virtec's scan)

Jev scoring is built (phase 12). What is not: starting a Places scan **for the
active ICP** (its category and geography) from AgentOS. That belongs in
Virtec, which runs the scans, holds the Places key and pays for it. It would
be one Virtec route that takes a category and an area, with a monthly cap on
the key. Before building it, get answers to the two checks below.

**Check before building** (not verified yet):

- Google Maps Platform terms limit how long most Places content may be
  cached; place IDs are the exception. Store the place ID and re-fetch
  details rather than keeping copies. (AgentOS keeps only scores, no Places
  content.)
- POPIA restricts unsolicited electronic direct marketing to individuals.
  Business contacts are treated differently, but get this checked before
  cold-emailing anyone found this way.
- Cost: set a monthly cap on the Places key before it is used in a loop.

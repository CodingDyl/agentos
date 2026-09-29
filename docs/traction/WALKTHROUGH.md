# Traction: how to use it, start to finish

Three ways in, one place to work. Website forms, lead magnets and your own
outreach all end up as items in **Traction > Overview > Today**. Work that
list top to bottom.

## 0. Once, before anything

Check each of these. Nothing below works without them.

| Where | What |
|---|---|
| AgentOS `.env` | `VIRTEC_BASE_URL`, `VIRTEC_API_KEY`, `VIRTEC_WRITE_API_KEY`. Restart AgentOS. The Virtec tab should say write-back is on. |
| Virtec (Vercel) | `AGENTOS_API_KEY`, `AGENTOS_WRITE_API_KEY`, `VIRTARA_SITE_LEADS_KEY`, `JURIVO_SITE_LEADS_KEY`, `RESEND_API_KEY` |
| Virtec (Vercel), emails | `VIRTARA_FROM_EMAIL`, `JURIVO_FROM_EMAIL` on a domain verified in Resend. Set `VIRTARA_REPLY_TO` and `JURIVO_REPLY_TO` to the Gmail inbox AgentOS syncs. Optional: `INBOUND_NOTIFY_EMAIL` for an alert per lead. |
| Virtec, once | `firebase deploy --only firestore:rules` from the virtec-crm repo |
| virtara-backend and Jurivo (Vercel) | `VIRTEC_BASE_URL` plus that site's key (`VIRTARA_SITE_LEADS_KEY` or `JURIVO_SITE_LEADS_KEY`) |
| AgentOS Inbox | Gmail connected, so replies can be seen |

Test it: submit the Jurivo demo form with your own email. It should appear
in Virtec (Local leads > Website) and at the top of your Today list. Mark it
Spam afterwards.

## 1. A website form comes in

Every form on Virtara (start a project, contact, SEO, the three packages,
health check, audit) and Jurivo's demo request lands in Virtec.

1. It appears at the top of Today as **Reply to Jane (Firm)**, with where it
   came from and how long it has waited.
2. **Ask Hermes** drafts a first reply. Their message is treated as their
   words, never as instructions.
3. Edit it and send it from your own mail.
4. Press **Replied**. They become a prospect in conversation, it counts as
   today's follow-up, and Virtec marks them replied.
5. Not worth a reply? Open the Virtec tab, **Website leads**: Not a fit or Spam.

## 2. Make a lead magnet

1. **Traction > Lead magnets**. Working title, site, format (a checklist is
   fastest), the offer it leads to. **Add**.
2. **Track with an experiment**: one click, so signups are measured.
3. **Draft with Hermes**. It fills only empty fields and marks anything it
   cannot know as `[NEEDS DATA]`.
4. Edit everything. Replace each `[NEEDS DATA]` with a real fact. Add a cover
   (Choose from Creative, or Upload cover).
5. **Save**, then **Mark ready**. It refuses while anything is missing.
6. **Download for the site**. Unzip: put the `.json` in `content/lead-magnets/`
   (Jurivo) or `src/content/lead-magnets/` (Virtara), the cover in
   `public/lead-magnets/`. Commit and deploy.
7. Open `/guides/<slug>` on the live site and check it.
8. Back in AgentOS, paste that address into **Live at**, Save, **Mark live**.

## 3. The signup email

1. In the same magnet, **Signup email**: Hermes drafted it in step 3 above.
   Keep `{{link}}` in it. `{{firstName}}` is optional.
2. Check the preview. Save.
3. **Switch on in Virtec** (needs the live address from step 8).
4. From now on, each signup gets it at once. Edit the text later and press
   **Publish changes**. **Switch off** stops it.

The visitor sees the guide straight away; the email is a copy they can find
later and it links back to the read page.

## 4. A signup arrives

- Today shows nothing yet for a signup who got the email. That is on purpose.
- The magnet's row shows Signups, Last 7 days and Emailed. If some emails
  failed, it says so and the lead in Virtec shows the reason.
- If the email failed, Today shows **Reply to** straight away. Send them the
  guide yourself.

## 5. Three days later: second touch

1. **Second touch: Sam (Partner Law)** appears, with "guide emailed 3 days
   ago, no reply".
2. **Ask Hermes**: a short personal note from you, built from the guide and
   the email they already got.
3. Send it from your mail, then press **Sent**. They become a contacted
   prospect (counted as outreach, tagged with the magnet's experiment) and
   ordinary follow-ups take over.

## 6. They reply

1. Any message from a prospect (target to proposal) that is newer than your
   last touch becomes **Reply to X**, above everything else.
2. It shows the start of their message. **Ask Hermes** drafts the answer.
3. **Move to conversation** confirms the stage move. Nothing moves unless you
   press it. **Not theirs** dismisses a wrong match (it flags matches made
   only by website domain).
4. Send your answer, press **Replied**. That clears it until they write again.
   Confirming the move does not clear it; only answering does.
5. The Inbox has to have synced. A reply from minutes ago may not show yet.

## 7. Pick better local candidates (Jev fit scoring)

1. **Traction > Virtec > Leads to import**. This is Virtec's Places
   candidates, ordered by Virtec's own score.
2. Make sure the **ICP** has its ideal-prospect traits filled in (Overview).
   Jev scores candidates against those.
3. Press **Score 15 against the ICP**. It scores the best unscored
   candidates: 15 a click, 60 a day. If the list has a track switch, it
   scores only the track you have selected.
4. Read the **Fit** column: 3+ is green, 2 to 3 amber, under 2 grey. Hover
   for the words, confidence and whether the data shows a checkable gap.
   Good fits move to the top; poor fits sink to the bottom rather than vanish.
5. **Import** the good ones. The prospect starts with Jev's fit (not Virtec's
   score) and a first reason saying so. You still add a specific observation
   before outreach is drafted.
6. Change the ICP and the old scores stop counting; score again.

Jev returns a number, not a reason: the "Why" column is still Virtec's own.

## 8. Weekly

- **Experiments**: each magnet's experiment counts contacted and conversations
  from real prospects.
- **Lead magnets**: signups, emailed, followed up, conversations per magnet.
- **Weekly review**: Hermes interprets the numbers; the numbers are counted, not typed.

## Limits worth knowing

- The `/read` page is a soft gate: the content ships with the site.
- Anyone can type any address into a guide form, so keep the email plain.
- Rate limits are per server instance. The site keys are the real protection.
- `/api/send-email` on virtara-backend is unused and should be deleted once
  the new Virtara site is live.

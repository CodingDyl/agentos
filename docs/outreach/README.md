# Outreach

Traction → Outreach is where a business on the prospect list becomes one sent email:

1. **Get to know them.** Hermes reads their website and fills the brief.
2. **Decide how to help.** Pick *Build it first* (build their site, send the link, charge monthly) or *Pitch a custom build* (a standard cold email for a bigger project). Hermes suggests one and gives ideas for framing the offer.
3. **Write the email.** Choose which of your companies it is from, let Hermes draft it, edit it, review it, and send it (or save it as a Gmail draft).

Everything about one business lives in a single **outreach case**. You, Hermes and coding agents read and write the same record through the same endpoint, and each field remembers who last filled it (`you`, `hermes`, `agent`). The screen shows a small Hermes/Agent tag next to a field until you edit it.

## For coding agents and Hermes: adding research

The data adapter runs on `http://127.0.0.1:8787`. Prospect ids look like `pr_3b3d34c170fb` (`GET /api/traction` lists them).

Read a case:

```bash
curl -s http://127.0.0.1:8787/api/outreach/cases/pr_3b3d34c170fb
```

Write any subset of fields. Send `"by": "agent"` so the screen shows it came from you, and send `null` to clear a field:

```bash
curl -s -X PATCH http://127.0.0.1:8787/api/outreach/cases/pr_3b3d34c170fb \
  -H 'Content-Type: application/json' \
  -d '{"by":"agent","patch":{"notes":"Owner is Thandi (LinkedIn). 4.6 stars, 210 reviews.","findings":["The Book Now button on mobile opens a 404 page"]}}'
```

Unknown fields are refused (400), so a typo never disappears quietly. Lists replace the whole list. Writing `hook` (or the first finding, when there is no hook) also updates the prospect's `observation`, which the rest of Traction reads.

Other endpoints:

| Method and path | What it does |
| --- | --- |
| `GET /api/outreach/cases` | Every case, keyed by prospect id |
| `POST /api/outreach/cases/:id/brief` | Hermes reads the website and fills **empty** fields. `{"replace": true}` overwrites. Framing ideas are always refreshed. |
| `POST /api/outreach/cases/:id/draft` | Hermes drafts from the case; the draft is saved on the case (`draft`). Nothing is sent. |
| `GET/POST /api/outreach/senders`, `PUT/DELETE /api/outreach/senders/:id` | Your companies |
| `POST /api/outreach/prospects/:id/send` | Sends. Body: `subject`, `body`, `confirm: true`, `senderId`, `play`. Only a person's button press calls this. |
| `GET /api/outreach/stats` | Sent emails, reply rates, follow-ups due |

Agents must not call `send` or `gmail-draft`. Sending is a person's decision, made after the review screen.

## Case fields

Defined in `shared/outreach-case.ts` (`OutreachCaseSchema` and `CASE_FIELDS`).

| Field | What it holds | Filled by the Hermes brief |
| --- | --- | --- |
| `about` | What the business does | yes |
| `findings` | Problems noticed, one per item, each checkable by the owner | yes (plus AgentOS's own website checks) |
| `howWeHelp` | What you would do for them | yes |
| `hook` | The email's opening line | yes |
| `path` | `build_first` or `cold_pitch` | yes (a suggestion) |
| `pathReason` | Why that path | yes |
| `framing` | Ideas for framing the offer | yes |
| `offer` | The offer as the email puts it | yes |
| `previewUrl` | Build-first: the live link to the site you built | no |
| `monthlyPrice`, `setupPrice`, `projectPrice` | Quoted exactly as written; prefilled from the company's usual prices | no |
| `senderId` | Which company it is from | no |
| `notes` | Free research notes; Hermes reads them for the brief and the draft | no |
| `draft` | `{ subject, body }`, the email being edited | the draft endpoint |

Hermes never sets prices. They come from you, or from your company's defaults.

## Adding a field

1. Add it to `OutreachCaseSchema` (with a default) and to `OutreachCasePatchSchema` in `shared/outreach-case.ts`.
2. Add it to `CASE_FIELDS` with a label and hint. Set `hermes: true` if the brief should fill it, then add it to `HermesBriefSchema` and to the patch built in `briefCase` (`server/outreach/cases.ts`).
3. If the draft should use it, add a line to `buildCaseDraftPacket`.
4. Show it in `src/features/traction/traction-outreach-case.tsx` with `<CaseText field="…" />` or `<CaseLine field="…" />`. Both read the label and hint from `CASE_FIELDS` and save on blur.

## Rules the server holds

- One email to one prospect per send, only to their stored address, never on a timer.
- A cold email must carry the chosen company's signature and opt-out line.
- Sequence: up to three emails to someone who has not replied, the second at least 3 days after the first and the third 4 days after that. A reply ends the sequence.
- The do-not-contact list and the daily cap (`OUTREACH_DAILY_CAP`, default 10) always apply.
- Emails go from the connected outreach mailbox. A company sets the sender *name* and signature, not a different mailbox.

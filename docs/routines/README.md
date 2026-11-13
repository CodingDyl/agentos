# Hermes routines

Written 2026-11-13, after a review of how AgentOS uses Hermes.

## What the review found

Measured on the owner's machine (`~/.hermes`, Hermes Agent v0.21.7):

| Hermes feature | State |
|---|---|
| API calls from AgentOS (planning, review, drafting) | In use: 268 sessions |
| Scheduled jobs (cron) | 2 jobs. Morning Brief runs. Weekly Review has been paused since 2026-09-27 |
| Telegram gateway | Connected, home channel set. **0 Telegram sessions, and no job delivers to it** |
| No-model script jobs, monitor mode | Not used |
| Webhooks | Off |
| Kanban | Empty |
| Memory (`USER.md`) | 734 bytes. Hermes knows almost nothing about the owner |
| Discord, WhatsApp | Configured but failing, so the gateway reports "degraded" |

AgentOS uses Hermes as a model it calls. The thing people use Hermes for most
is the reverse: Hermes reaches you, on your phone, on a schedule. That part
was switched on and never used.

How other people use it (Hermes docs and community guides):

- A scheduled job delivers to Telegram, not to a file.
- A script collects the data and the model only reasons about it. Where the
  script already has the final text, the job runs with `--no-agent`: no model,
  no cost, nothing sent when the script prints nothing.
- Prompts are self-contained, because a scheduled run remembers no chat.
- A watcher replies `[SILENT]` (or prints nothing) when nothing changed.

Sources: [Automate with cron](https://hermes-agent.nousresearch.com/docs/guides/automate-with-cron),
[Daily briefing bot](https://hermes-agent.nousresearch.com/docs/guides/daily-briefing-bot),
[Automation templates](https://hermes-agent.nousresearch.com/docs/guides/automation-templates).

## Ideas, rated

Built means it is in this change. The bar to build was above 7 out of 10.

| Idea | Rating | Decision |
|---|---|---|
| Routines: AgentOS writes a message, Hermes sends it to Telegram on a schedule | 9 | Built |
| Routine: follow-ups due (outreach replies, then emails due) | 9 | Built |
| "Send to phone" on any existing job (Morning Brief, Weekly Review) | 9 | Built |
| Routine: inbox needs you | 8 | Built |
| Routine: evening wrap | 8 | Built |
| Routine: money check (overdue invoices) | 8 | Built |
| Resume the Weekly Review and send it to the phone | 8 | No code needed: Resume, then Send to phone |
| Routine: worker jobs waiting for review, or failed | 7 | Next |
| Routine: client site down (`--monitor-url`) | 7 | Next |
| Overnight prospect research with Hermes' browser | 7 | Next. It costs model calls and needs a spend limit first |
| Fill Hermes' `USER.md` from Compass | 7 | Next. It edits Hermes' memory, so it needs the owner's OK |
| Webhooks (a Vercel deploy fails, Hermes tells you) | 6 | Not now. It needs a public tunnel |
| Weekly AI news digest | 6 | Not now. Today already has Tech and AI |
| Hermes kanban | 4 | No. It would be a second copy of worker jobs |

## How a routine works

1. Operations → Scheduled tasks → Routines lists what `server/routines/catalog.ts` offers.
2. **Preview** shows the message as it would read now (`GET /api/routines/:id/preview`).
3. **Install** (`POST /api/routines/:id/install`) writes
   `~/.hermes/scripts/agentos-routine-<id>.sh` and runs
   `hermes cron create "<schedule>" --name "AgentOS: <name>" --deliver telegram --script agentos-routine-<id>.sh --no-agent`.
4. On schedule Hermes runs the script. The script asks AgentOS for the text
   (`GET /api/routines/feed/<id>`) and Hermes sends that text as it is.
5. No text means nothing to report, and nothing is sent. The same happens when
   AgentOS is not running.

Rules that hold:

- **No model reads the message.** A subject line or company name written by
  someone else can never act as an instruction, and a run costs nothing.
- **AgentOS keeps no record.** A routine is installed when Hermes has a job
  running its script. Pause, run and remove it like any other job.
- **Installing twice does nothing.** Removing a job stays in Hermes:
  `hermes cron remove <id>`.
- **Send to phone** changes only where a job delivers
  (`hermes cron edit <id> --deliver telegram|local`). Hermes still writes its
  output file, so Today's brief keeps working.

## Adding a routine

1. Add its id to `RoutineIdSchema` in `shared/routine-types.ts`.
2. Add an entry to `ROUTINES` in `server/routines/catalog.ts`.
3. Add a formatter and a `buildFeed` case in `server/routines/feeds.ts`. Return
   `""` when there is nothing to say.
4. Test the formatter in `server/routines/__tests__/feeds.test.ts`.

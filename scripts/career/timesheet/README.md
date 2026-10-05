# Timesheet extractor

Toggl Track → Entelect timesheet rows. Ported from the "Dylan TimesheetsRunner"
Colab notebook; AgentOS's Career → Routines → Timesheet runs it.

```
Toggl API (AgentOS, toggl.read_time_entries)
  → extract.py (career.timesheet.transform)
  → preview in Career (career.timesheet.preview)
  → open Entelect Timesheet (entelect.timesheet.open)
  → you submit, then mark it submitted (entelect.timesheet.submit, approval)
```

## Setup

- `TOGGL_API_TOKEN` in AgentOS's `.env` (Connectors → Toggl Track). Toggl
  profile → API token. **Never paste it into this script** — the old notebook
  had tokens inline; rotate those tokens in Toggl if that notebook was ever shared.
- `TOGGL_WORKSPACE_ID` — `8248226` for the Standard Bank workspace (the older FNB notebook used `6550194`).
- Optional: `pip install xlsxwriter` to also get the upload `.xlsx`.

AgentOS looks for the script in this order:

1. `AGENTOS_TIMESHEET_SCRIPT` (absolute path)
2. `<AgentOS vault>/scripts/career/timesheet/extract.py`
3. this repository's copy

## Mappings (`mappings.json`)

| Key | Meaning |
| --- | --- |
| `billableProjects` | Toggl project names marked billable |
| `projectAliases` | Toggl project name → Entelect project name |
| `categoryAliases` | First Toggl tag → Entelect category |
| `requireTag` | An untagged entry is unmapped (needs a category) |
| `rounding` | `up` (any started 15 min counts, current notebook) or `nearest` (ties down, old FNB notebook) |
| `aggregate` | Sum same day/project/tag/description before rounding; `false` = one row per Toggl entry like the notebook |
| `defaults` | `sentiment`, `workedFrom`, `ticketNumber` per row |

## Run by hand

```sh
echo '{"entries":[],"projects":[],"weekStart":"2026-09-28","weekEnd":"2026-10-04"}' \
  | python3 extract.py --xlsx-dir ./out
```

Rounding defaults to up to the next 15 minutes (1–15 → 15, 16–30 → 30), as the
Standard Bank notebook did. With `aggregate`, entries with the same day,
project, tag and description are summed before rounding, so ten 3-minute
entries bill 30m rather than 2h30m.

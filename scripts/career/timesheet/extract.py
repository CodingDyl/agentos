#!/usr/bin/env python3
"""
Toggl time entries -> Entelect timesheet rows.

Ported from the "Dylan TimesheetsRunner" Colab notebook. The notebook fetched
Toggl itself with a token pasted into the code; here AgentOS fetches Toggl
(through the `toggl.read_time_entries` connector capability, token in .env)
and this script only transforms. That keeps the logic testable and keeps
secrets out of the script.

Input (stdin, JSON):
  {
    "entries":  [Toggl v9 time entries],
    "projects": [{"id": 1, "name": "R - FNB - Backbase"}],
    "weekStart": "2026-09-28", "weekEnd": "2026-10-04"
  }

Output (stdout, JSON):
  {"rows": [...], "runningEntries": n, "warnings": [...], "uploadFile": "..."|null}

Changes from the notebook, each one from its own "Issues" list:
  - entries with the same date, project, tag and description are aggregated
    before rounding, so five 10-minute entries become 45m rather than 5 x 15m
  - running entries (negative duration) are skipped and counted
  - rows are flagged unmapped instead of silently written as
    "Project Not Found" / "Untagged"
  - the xlsx upload file is written only when xlsxwriter is installed and
    --xlsx-dir is given; the JSON is the source of truth either way
"""

import argparse
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))

HEADERS = ["Date", "Project", "Category", "Hours", "Minutes", "Billable", "Description", "TicketNumber", "Sentiment", "WorkedFrom"]


def round_minutes(minutes, mode="up"):
    """
    Quarter hours.

    - "up":      any started quarter counts (the Standard Bank notebook: 1-15 -> 15)
    - "nearest": nearest quarter, ties down (the earlier FNB notebook: 7.5 -> 0)
    """
    if minutes <= 0:
        return 0
    quarters = int(minutes // 15)
    remainder = minutes - quarters * 15
    if remainder == 0:
        return quarters * 15
    if mode == "nearest":
        return quarters * 15 + (15 if remainder > 7.5 else 0)
    return quarters * 15 + 15


def load_mappings(path):
    with open(path, encoding="utf-8") as handle:
        mappings = json.load(handle)
    mappings.setdefault("billableProjects", [])
    mappings.setdefault("projectAliases", {})
    mappings.setdefault("categoryAliases", {})
    mappings.setdefault("requireTag", True)
    mappings.setdefault("defaults", {})
    mappings.setdefault("rounding", "up")
    mappings.setdefault("aggregate", True)
    if mappings["rounding"] not in ("up", "nearest"):
        raise SystemExit("mappings.json: rounding must be 'up' or 'nearest'")
    return mappings


def transform(payload, mappings):
    projects = {project["id"]: project["name"] for project in payload.get("projects", []) if "id" in project}
    week_start = payload.get("weekStart")
    week_end = payload.get("weekEnd")
    defaults = mappings["defaults"]

    grouped = {}
    running = 0
    warnings = []

    for entry in payload.get("entries", []):
        duration = entry.get("duration") or 0
        if duration < 0:
            running += 1
            continue
        day = (entry.get("start") or "")[:10]
        if not day or (week_start and day < week_start) or (week_end and day > week_end):
            continue

        toggl_project = projects.get(entry.get("project_id"))
        tags = entry.get("tags") or []
        tag = tags[0] if tags else None
        description = (entry.get("description") or "").strip()

        project = mappings["projectAliases"].get(toggl_project, toggl_project) if toggl_project else None
        category = mappings["categoryAliases"].get(tag, tag) if tag else None

        # Without aggregation every Toggl entry is its own row, as the notebook wrote them.
        key = (day, project or "", category or "", description) if mappings["aggregate"] else (day, project or "", category or "", description, entry.get("id"))
        if key not in grouped:
            grouped[key] = {"seconds": 0, "toggl_project": toggl_project, "project_id": entry.get("project_id")}
        grouped[key]["seconds"] += int(duration)

    rows = []
    for key, group in sorted(grouped.items(), key=lambda item: tuple(str(part) for part in item[0])):
        day, project, category, description = key[:4]
        seconds = group["seconds"]
        total = round_minutes(seconds / 60, mappings["rounding"])
        issue = None
        if not project:
            issue = "No Toggl project" if group["project_id"] is None else "Toggl project not found"
        elif not category and mappings["requireTag"]:
            issue = "No tag, so no timesheet category"
        elif not description:
            issue = "No description"
        if total == 0:
            warnings.append(f"{day}: '{description or project or 'entry'}' rounds to 0 minutes and is left out.")
            continue
        rows.append({
            "date": day,
            "project": project or "",
            "category": category or "",
            "hours": total // 60,
            "minutes": total % 60,
            "billable": bool(project) and (group["toggl_project"] in mappings["billableProjects"] or project in mappings["billableProjects"]),
            "description": description,
            "ticketNumber": defaults.get("ticketNumber", ""),
            "sentiment": defaults.get("sentiment", "Neutral"),
            "workedFrom": defaults.get("workedFrom", "Home"),
            "mapped": issue is None,
            "issue": issue,
            "recordedSeconds": seconds,
        })
    return rows, running, warnings


def write_xlsx(rows, directory, week_start):
    try:
        import xlsxwriter  # type: ignore
    except ImportError:
        return None
    os.makedirs(directory, exist_ok=True)
    name = f"timesheet-{week_start or date.today().isoformat()}.xlsx"
    workbook = xlsxwriter.Workbook(os.path.join(directory, name))
    sheet = workbook.add_worksheet("TimesheetUpload")
    date_format = workbook.add_format({"num_format": "yyyy/mm/dd"})
    for column, header in enumerate(HEADERS):
        sheet.write(0, column, header)
    from datetime import datetime
    for index, row in enumerate(r for r in rows if r["mapped"]):
        line = index + 1
        sheet.write_datetime(line, 0, datetime.strptime(row["date"], "%Y-%m-%d"), date_format)
        sheet.write(line, 1, row["project"])
        sheet.write(line, 2, row["category"])
        sheet.write(line, 3, row["hours"])
        sheet.write(line, 4, row["minutes"])
        sheet.write(line, 5, "Yes" if row["billable"] else "No")
        sheet.write(line, 6, row["description"])
        sheet.write(line, 7, row["ticketNumber"])
        sheet.write(line, 8, row["sentiment"])
        sheet.write(line, 9, row["workedFrom"])
    workbook.close()
    return name


def main():
    parser = argparse.ArgumentParser(description="Transform Toggl entries into Entelect timesheet rows.")
    parser.add_argument("--mappings", default=os.path.join(HERE, "mappings.json"))
    parser.add_argument("--xlsx-dir", default=None, help="Also write the upload spreadsheet here (needs xlsxwriter).")
    args = parser.parse_args()

    payload = json.load(sys.stdin)
    mappings = load_mappings(args.mappings)
    rows, running, warnings = transform(payload, mappings)
    upload = write_xlsx(rows, args.xlsx_dir, payload.get("weekStart")) if args.xlsx_dir else None
    json.dump({"rows": rows, "runningEntries": running, "warnings": warnings, "uploadFile": upload}, sys.stdout)


if __name__ == "__main__":
    main()

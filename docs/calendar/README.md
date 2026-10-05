# Overview calendar

The Today overview now includes an interactive calendar after the daily priorities, before the workspace and activity sections. It opens in month view; click a date to open its day schedule. Month, week and day views are available from the view switcher.

## Connect Google

AgentOS reuses the Google connection configured in **Connectors**. Choose **Reconnect Google** in the calendar to grant `calendar.events` access. Older `calendar.readonly` grants still display events but cannot create or edit them. The Google Calendar API must be enabled in the existing Google Cloud project.

Events are read from and written to your **primary Google calendar**. The visible date range refreshes every minute while the page is open, on window focus when stale, or when you press Refresh. This is direct API synchronization, not a background webhook service. Google tokens remain on the server.

## Events and preparation

- Use **New event**, or click a time slot in the week view, to create an event.
- Open an event to edit its title, dates, description or location. All-day end dates in the editor are inclusive; Google receives its required exclusive end date.
- Editing an occurrence of a recurring event changes that occurrence only. Recurrence-rule and attendee editing are outside this editor; existing attendees receive Google's event-update notifications.
- Enable **Allow tasks for this event**, write preparation notes with one task per line, then save the event.
- **Create task** opens a task form. **Review suggestions** shows your preparation lines for review; it neither invents tasks nor creates anything until you save a task.
- Linked tasks survive an event being untagged or removed. AgentOS does not silently reschedule or delete preparation work when an event changes.

## Tasks

Tasks belong to existing AgentOS workspaces. Drag one from the calendar or **Unscheduled tasks** to a day or hour; alternatively, open it and edit its date and time. On touch devices and with a keyboard, the task editor provides the same scheduling controls.

Task IDs, completion and titles stay in the workspace's `TASKS.md`. Scheduling and event links are stored in the readable task tail:

```markdown
- [ ] [PP-024] Prepare slides · scheduled 2026-10-05@09:30/45 · event google_event_id
```

This means 5 October, 09:30, for 45 minutes. A schedule without `@HH:mm` is an anytime task. Rename, completion, section moves and existing task mutations preserve this metadata. Clearing the date removes the schedule without deleting the task. These are AgentOS tasks, not Google Tasks or duplicate Google events.

Scheduled tasks appear in **Scheduled today** on their assigned date, feed the daily focus shortlist, and are included in `/api/today/agenda` for the existing Hermes morning brief. Future scheduled tasks are excluded from the daily shortlist. Completing a task in the calendar updates the same workspace task.

## Conflicts and verification

Google updates use the event's last-read ETag. Task edits use the vault writer's revision guard. If another editor changes an item, refresh and reopen it before saving. Calendar writes reject cross-site browser requests, and event-task opt-in is enforced on the server.

Validation covers Google permission upgrades, event payloads, pagination, concurrent edits, task round-trips, date boundaries, opt-in enforcement and browser create/edit/reschedule flows. Browser tests use a disposable fixture vault and mocked Google responses; they do not alter the real Google account.

```sh
npx tsx --test server/calendar/__tests__/*.test.ts src/features/calendar/__tests__/*.test.ts
npm run test:e2e -- e2e/calendar.spec.ts
npm run build
```

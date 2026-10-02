# Compass

The Compass is where you are heading: direction, what matters, life areas, goals, projects and this week's outcomes. It lives in the vault at `me/COMPASS.md`, beside `PROFILE.md`, `GOALS.md` and `CURRENT_FOCUS.md`. It never rewrites those files. When they disagree, the Compass is the current word.

Today reads it every morning to pick your three things. The Sunday review keeps it current.

## The file

```markdown
# Compass

## Direction

A life where my income and freedom don't depend entirely on employment.

## What matters

- Independence
- Financial growth

## Areas

- Business: on track
- Health: neglected
- Money: slipping
- Learning: unrated

## Goals

- [G1] R100,000/month income | area: Money | by: 2027-12 | measure: monthly income | now: R38,000 | target: R100,000
- [G2] First recurring product revenue | area: Business | by: 2026-12

## Projects

- AgentOS | serves: G2 | status: active
- Driver's licence | serves: - | status: admin

## This week

1. Send 10 outreach emails
2. Gym 3x
```

Rules:

- **Areas:** `- Name: status`. Status is one of `on track`, `slipping`, `neglected`, `unrated`.
- **Goals:** `- [G<n>] Title`, then optional `| key: value` fields: `area`, `by`, `measure`, `now`, `target`. Ids are unique.
- **Projects:** `- Name | serves: G1, G2 | status: active`. Status is one of `active`, `paused`, `admin`, `done`. `serves` may only name goals in the file; `-` means none.
- **This week:** a numbered or bulleted list, at most five items.
- **What matters:** one per line, or several on one line separated by `·` or commas.
- **Other sections:** any `##` section with another name is yours. AgentOS keeps it exactly as written.
- **Lines it can't read:** a line in a known section that doesn't fit the format is shown on the Compass page with its line number, and stays in the file until you fix it.

## Reading and writing

The data adapter runs on `http://127.0.0.1:8787`.

| Method and path | What it does |
| --- | --- |
| `GET /api/compass` | `{ exists, compass, problems, revision }` |
| `PUT /api/compass` | `{ compass, revision }`. Writes the whole Compass. Refused (409) if the file changed since `revision`, so an edit in Obsidian is never overwritten. |
| `POST /api/compass/interview/questions` | Hermes reads the `me/` files and the workspace list, and returns the questions to ask. Saves nothing. |
| `POST /api/compass/interview/draft` | `{ answers: [{ question, answer }] }`. Hermes drafts a full Compass. Saves nothing. |

Agents can also edit `me/COMPASS.md` directly, as long as they keep the format above.

## Where the code is

- `shared/compass-types.ts`: the shape.
- `server/compass/compass.ts`: parsing and writing the file.
- `server/compass/interview.ts`: the first-time interview. Hermes calls go out with a system message that rules out tools and asks for JSON only. Without it, Hermes's persona wins.
- `src/features/compass/`: the page.

## Hermes

Hermes runs on a hosted model through OpenRouter. The upstream stream sometimes stalls for minutes and Hermes retries by itself, so Compass calls wait up to 280 seconds. A typical answer takes 20 to 30 seconds.

## Today: the check-in and your three

On the first open of Today each day, a full-screen check-in asks for energy, time and anything on your mind. Then:

1. **Shortlist** (`server/focus/shortlist.ts`): plain rules, no model, at most 8 items. This week's outcomes, outreach follow-ups due, open tasks in `areas/<area>/TASKS.md`, and up to two Now tasks per active workspace. Work that serves a goal in a slipping or neglected area is lifted; projects the Compass marks paused or done are left out.
2. **Picks** (`server/focus/today.ts`): Hermes picks three from the shortlist, by id, with a reason. If Hermes fails or takes more than 2 minutes, the rules pick, quick jobs first when energy or time is low.
3. **Done:** ticking one off also ticks the task in its workspace `TASKS.md` or area `TASKS.md`.
4. **Journal:** check-ins, picks and done items are appended to `me/journal/YYYY-MM.md` under a heading per day. The Sunday review reads this.

| Method and path | What it does |
| --- | --- |
| `GET /api/focus/today` | `{ day, shortlist }` |
| `POST /api/focus/check-in` | `{ energy: low/ok/high, time: under_1h/1_3h/most_of_day, mind }` |
| `POST /api/focus/skip` | Skips today's check-in |
| `POST /api/focus/swap` | `{ slot: 0-2, candidateId }` |
| `POST /api/focus/done` | `{ candidateId, done }` |

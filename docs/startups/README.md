# Startups

The Startups page (`/startups`) walks a SaaS idea from first thought to live users, one gated stage at a time. Everything is filed under `saas/` in the vault, so later ventures learn from earlier ones.

## Stages

| # | Stage | Phase | Gate |
|---|-------|-------|------|
| 1 | Idea | 1 | The problem, who has it, and how the product would help |
| 2 | Value | 1 | Who pays, why, and what they do today instead |
| 3 | Validate | 1 | Persona reviews and a validity score of **8/10 or more** |
| 4 | MVP | 1 | One user, one problem, one core workflow, a success metric, kill criteria |
| 5 | Design | 2 | Design brief and DESIGN.md |
| 6 | Tech | 2 | Stack, structure, POPIA checklist |
| 7–10 | Build, Test, Refine, Launch | 3 | |

Phase 1 (stages 1–4) is built. Hermes asks questions and drafts each stage; nothing is saved until you edit and save it. A stage stays locked until the one before it is saved, and the server enforces the locks.

## Validate

1. **Competitor scan**, drafted by Hermes. Check anything it names.
2. **Persona reviews.** Personas are field experts played by a model (an attorney for a legal product). Hermes suggests the roles; a persona is written once, edited by you, saved to `saas/personas/`, and offered again to every venture it fits. Each review walks the idea through the persona's working week and returns fit (1–10), would-pay, deal-breakers and what is missing. Reviews are always marked **simulated**.
3. **Real conversations** (optional). Logged ones count as real-world evidence.
4. **Validity score.** Hermes scores each dimension 0–10 with evidence; AgentOS computes the weighted total (one decimal, so 7.95 passes and 7.94 does not):

| Dimension | Weight |
|-----------|--------|
| Problem severity | 15% |
| How often it hurts | 10% |
| Willingness to pay | 15% |
| Gap in the market | 10% |
| Persona fit (average of the reviews, computed) | 15% |
| Can reach buyers | 10% |
| MVP feasible for one builder | 10% |
| Founder fit | 5% |
| Real-world evidence | 10% |

With no logged conversations, the real-world weight is shared out over the rest, so personas alone can reach the bar. Weights and the threshold live in `shared/startup-types.ts`.

**Below 8:** one pivot. Hermes revises the idea aimed at the weakest dimensions, you run the personas again and re-score. A second miss, or declining the pivot, stops the venture and appends the lesson to `saas/LEARNINGS.md`.

## MVP and the scope guard

The MVP contract is strict. The scope guard checks anything you want to add against it: **in** (the workflow needs it), **later** (parked in `LATER.md`), or **pivot** (it changes the user or the problem). Once the contract is saved, **Create the workspace** makes a normal workspace: the core workflow becomes its Now tasks, everything else waits under Later, and the workspace gets a Startup tab that keeps the contract in view.

## Files

```
saas/
  LEARNINGS.md                 lessons from every venture decision, read by every new venture
  personas/<persona>.md        the shared persona library
  <venture>/
    VENTURE.md                 stage, status, pivots, outcome, workspace
    01-idea.md  02-value.md  03-validation.md  04-mvp.md
    validation/persona-<persona>.md   one review per persona
    validation/score.md        every scoring attempt with its breakdown
    LATER.md                   parked ideas
    DECISIONS.md               dated decisions
```

Each file is readable markdown with its structured content in front matter. Writes go through the vault writer, so each one is backed up and undoable.

## API

`/api/startups` (local only): `GET /`, `POST /`, `POST /brainstorm`, `GET /personas`, `POST /personas/draft`, `PUT /personas/:persona`, `GET /by-workspace/:workspace`, `GET /:slug`, `POST /:slug/stages/:stage/questions`, `POST /:slug/stages/:stage/draft`, `PUT /:slug/stages/:stage`, `POST /:slug/personas/suggest`, `POST /:slug/personas/:persona/review`, `POST /:slug/score`, `POST /:slug/pivot`, `POST /:slug/stop`, `POST /:slug/scope-check`, `POST /:slug/later`, `POST /:slug/decision`, `POST /:slug/graduate`.

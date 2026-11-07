# AgentOS evals

Evals answer one question: *did that change make the agent better or worse?* They run [Promptfoo](https://www.promptfoo.dev) from this folder, which is its **own package** so Promptfoo's dependency tree (about 33 MB) never touches the app.

Evals are **never part of CI**. They call a paid API, so CI only tests the plumbing around them (`server/evals/__tests__`). You run them by hand.

## Run it

```sh
npm run eval:install   # once: installs Promptfoo (pinned) into evals/node_modules
npm run eval:mail      # mail triage on 12 invented threads (a small Jev spend)
```

It needs `JEV_API_KEY` in `.env`. It prints the score and compares it to the last run:

```
Mail triage (synthetic): 10/12 passed in 3s.
10/12, better than 6/12 last time.
```

Each run adds one line to `~/.agentos-ui/evals/history.jsonl`: when, which suite, which commit, passed and total. **No prompt or response text is stored there.** The latest score also shows as one quiet line at the bottom of Operations → Outcomes.

### On your own mail

```sh
tsx scripts/evals/export-mail-corrections.ts   # your corrections → ~/.agentos-ui/evals/mail-corrections.json (mode 0600)
npm run eval:mail:real
```

`eval:mail:real` sends **real mail subjects and snippets to Jev**, so only you run it, on purpose. Each corrected thread is a case, and its own correction is left out of the examples sent with it (leave-one-out). Otherwise it would be shown its own answer and the score would mean nothing. Results land in the history under the suite `mail-real`.

## Read it

- A **pass** means the classifier and the Mail page's bucketing put the thread in the bucket (and category) the case expects.
- A **miss** says what it got and what was wanted: `bucket fyi, wanted low_priority`. The full table is in `evals/output/mail-result.json` (git-ignored).
- Compare scores **on the same dataset**. If you change a case's expectation, the score moves without the classifier changing: write that in the commit.
- 12 cases is small. One case is about 8 points. Treat a one-case swing as noise and a trend as signal.

## Add a case

Open `evals/datasets/mail-synthetic.json` and add an object:

```json
{
  "description": "What this case is about, in words",
  "vars": {
    "from": "someone@example.com",
    "subject": "…",
    "snippet": "…",
    "date": "2026-11-02T09:00:00Z",
    "expectedBucket": "needs_you",
    "expectedCategory": "client"
  }
}
```

- **Invented data only.** The repo is public: only `example.com`, `example.org` or `example.net` addresses, no real names, mail or amounts. `server/evals/__tests__/dataset.test.ts` enforces the domains.
- Every case needs `expectedBucket` or `expectedCategory`. Buckets: `needs_you`, `fyi`, `low_priority`. Categories are the app's own: `client`, `sales`, `finance`, `admin`, `notification`, `newsletter`, `personal`, `spam`.
- Leave out the category when it is genuinely ambiguous, rather than guessing one.

## Add a suite

1. A provider in `evals/providers/` (a class with `id()` and `callApi(prompt, context)` that runs the real code under test).
2. A `<name>.promptfooconfig.yaml` beside `mail.promptfooconfig.yaml`, with its own dataset and an assertion.
3. A branch in `scripts/evals/run.ts` and an `eval:<name>` script in the root `package.json`.

## What this does not do

- It never runs `promptfoo share`, and telemetry and update checks are off (`PROMPTFOO_DISABLE_TELEMETRY`, `PROMPTFOO_DISABLE_UPDATE`). Promptfoo's own state is kept in `~/.agentos-ui/evals/promptfoo`.
- The classifier runs against an empty vault and a fresh state folder, so none of your project names are sent with the synthetic cases.

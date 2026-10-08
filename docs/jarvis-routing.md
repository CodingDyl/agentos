# Jarvis request routing (Jev)

Jev reads every sentence said or typed to Jarvis. It answers simple things in
the same model call and routes the rest to a stronger model, a registered
worker, or Hermes. Code lives in `server/jarvis/`; the browser side is
`src/features/voice/jarvis-context.tsx` and `src/lib/agentos/jarvis-routing.ts`.

## Flow

```text
Jarvis panel ──► POST /api/jarvis/converse
                   │
                   ├─ action waiting + "confirm" / "cancel"  → run or drop it (no model involved)
                   │
                   └─ quick Ollama model → profile (JSON, validated)
                        ├─ invalid → one correction retry → fallback model → clear failure
                        ├─ clarify                    → one focused question
                        ├─ chat / simple answer       → the profile's own direct_response
                        ├─ deep tool-free question    → strong model (or Hermes)
                        ├─ retrieve / task / act      → registered worker
                        │     └─ hermes.agent         → handed back to the browser's Hermes run
                        └─ no suitable worker         → says so
```

A page that takes Jarvis over (Operator) still hears everything first, exactly
as before. With routing off, or the data adapter unreachable, Jarvis behaves
as it did before Jev: small talk is answered locally and everything else goes
to Hermes.

## Profile

The quick model returns this object, which is validated with zod
(`shared/jarvis-routing-types.ts`) and sent to Ollama as a structured-output
JSON Schema:

```json
{
  "intent": "chat",
  "complexity": "low",
  "requires_tools": false,
  "requires_current_information": false,
  "needs_clarification": false,
  "clarification_question": null,
  "target_worker": null,
  "response_model": "local_fast",
  "execution_policy": "answer_directly",
  "inputs": {},
  "direct_response": "Good morning, sir."
}
```

| Field | Values |
| --- | --- |
| `intent` | `chat`, `answer`, `retrieve`, `task`, `act` |
| `complexity` | `low`, `medium`, `high` |
| `response_model` | `local_fast`, `strong` |
| `execution_policy` | `answer_directly`, `delegate`, `clarify` |

Validation rejects unknown fields, inconsistent combinations (for example
`answer_directly` without a `direct_response`, or a `retrieve` answered
directly), worker ids not in the registry, and workers that do not handle the
intent. The profile is data, not authority: it cannot grant a permission.

## Configuration

Set these in `.env`. Ollama is reached at the address configured in
Operations → AI Stack (default `http://127.0.0.1:11434`), which is already
checked to be this machine.

| Variable | Default | Meaning |
| --- | --- | --- |
| `JARVIS_QUICK_MODEL` | unset | Ollama model that profiles every request and answers simple ones, e.g. `qwen3:4b`. **Unset turns Jev routing off.** |
| `JARVIS_STRONG_MODEL` | `hermes` | Deeper tool-free questions and drafting: an Ollama model name, or `hermes`. |
| `JARVIS_FALLBACK_MODEL` | unset | Ollama model used when the quick model is unreachable or twice returns an invalid profile. |
| `JARVIS_ADDRESS` | `sir` | How Jarvis addresses you in quick answers. |
| `JARVIS_PROFILE_TIMEOUT_MS` | `20000` | Per profiling call. |
| `JARVIS_STRONG_TIMEOUT_MS` | `120000` | Per strong-model call. |
| `JARVIS_INLINE_WAIT_MS` | `1500` | How long a request waits for delegated work before acknowledging it and letting the browser poll. |

Check what is active with `GET /api/jarvis/workers`.

## Workers

Registered in `server/jarvis/default-jarvis-workers.ts`. Only these ids are
accepted from a profile.

| Id | Intents | What it does | Required inputs |
| --- | --- | --- | --- |
| `business.overdue_invoices` | retrieve | Overdue invoices from the local business ledger, using the Billing tab's own rule (issued, unvoided, past due in Johannesburg time, balance after payments above zero). Read-only, local. | none (`business` optional) |
| `writer.draft` | task | Drafts text with the strong model and keeps it in the conversation. Never sends. | `topic` |
| `writer.revise` | task | Changes a draft from this conversation ("make it shorter"). | the draft (resolved from "it") |
| `mail.send_draft` | act | Emails a draft from Gmail, after the `gmail.send` connector policy and your spoken or typed "confirm". Never retried automatically. | the draft, `to` |
| `hermes.agent` | retrieve, task, act | Hands the request, as you said it, to the existing Hermes run flow with its skills and approvals. | none |

### Adding a worker

1. Implement `JarvisWorker` (`server/jarvis/jarvis-worker-registry.ts`): `id`,
   `name`, `description`, `capabilities`, `intents`, `requiredInputs`,
   `safeRetry`, `run()`, and `available()` when it can be switched off.
2. Register it in `defaultJarvisWorkers()`. The description, intents and
   inputs are what the quick model sees, so write them for the model.
3. For anything that changes the outside world: check the existing connector
   policy (`decide()` in `server/connectors/policy.ts`), prepare a pending
   action with `store.setPendingAction`, and do the work in
   `executeConfirmed()`. That method is reached only from the deterministic
   "confirm" path, never from a profile.

## Conversation state

`JarvisConversationStore` keeps, per browser session, the last 12 turns, up
to 10 outputs (drafts) and at most one pending action, in memory, forgotten
after two idle hours or a restart. "It" resolves to the output a model named
by id, else the only output, else the one the previous reply produced;
anything else is asked about. A pending action expires after five minutes and
is dropped by any message other than "confirm" or "cancel".

## Failures

- Invalid profile: one correction prompt, then the fallback model once, then
  a clear failure. Nothing is executed from an invalid or unresolved profile.
- Ollama unreachable or model missing: straight to the fallback model; if that
  is unavailable or unset, the reply says so and names the setting.
- A worker that throws is reported as failed. Jobs are never retried
  automatically; `safeRetry` records which ones could be.
- Two steps where the second sends something ("draft a proposal and send it")
  are clarified before anything runs.

## Logging

Each request logs one `[jarvis] route` line: request id, conversation id,
outcome, intent, complexity, policy, worker, model, who decided, model calls
and duration. A delegated job logs `[jarvis] job settled` when it ends.
Message text, drafts and recipients are never logged.

## Testing

- `npm test` runs `server/jarvis/__tests__/jev-request-router.test.ts`, which
  covers every acceptance example with a scripted model.
- `npm run smoke:jarvis` checks the greeting fast path against your running
  Ollama (one quick-model call, no worker, a brief reply). Add `--all` for the
  other examples as routing evidence, `--model` / `--base-url` to choose. Exit
  code 2 means Ollama or the model was not there, which is inconclusive, not a
  pass. Mail sending is replaced by a recorder, so nothing is sent.

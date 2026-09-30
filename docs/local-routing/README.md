# Local routing (Ollama)

Small, bounded text tasks run on an enabled local Ollama model. Anything that
needs tools, a repository, the web, or more context than the model is
configured for goes to an existing worker. Every choice is recorded with its
reason.

> Naming: the ticket calls the router "Jev". `Jev` already means the hosted
> classification API used by Mail, Finance and Traction, so the code lives in
> `server/route-policy/` and the UI calls it "Route".

## How a task is routed

```
task ready -> profile -> eligibility (hard filters) -> preference -> route decision
          -> existing job pipeline -> validation -> your review -> result
```

1. **Profile** (`profile.ts`): category, complexity with a reason, estimated
   input tokens, output budget, required capabilities, constraints. Explicit
   metadata beats keyword rules. No model is called. Ambiguous tasks are marked
   uncertain and go to a capable worker.
2. **Eligibility** (`policy.ts`): capabilities, categories, input/output limits
   (never truncated), deadline, budget, local-only, embedding-only, enabled,
   available. These are hard filters.
3. **Preference**: only among what survived. Small bounded tasks prefer local,
   loaded model first. Complex/uncertain/tool tasks prefer a capable worker.
   Several eligible cloud workers: Hermes chooses, but only among them.
4. **Persisted** on the job: profile, policy version, reason, rejected options
   with reasons, fallback plan, override flag, and one entry per attempt (exact
   model id and digest, tokens, queue/load/total time, failure, validation).

Routing happens once, before dispatch. A running job is never re-profiled.

## Configure

Workers -> Local models (Ollama). Discovery lists installed models; nothing is
routable until you enable it with categories and limits. Starting limits are
conservative policies, not measured guarantees: 2,000 input tokens, 512 output
tokens, 30 s deadline (model load included), 1 concurrent job. Tune them from
the smoke report below.

The Ollama address must be this machine. Set `AGENTOS_OLLAMA_ALLOW_REMOTE=1`
to override (this defeats "local-only" for that host).

## Failure and fallback

| Situation | Behaviour |
|---|---|
| Ollama offline / model missing / load failed / timeout | One fallback at most, only if you allowed cloud fallback **and** the task is not local-only |
| Local-only task, no local model available | Refused with the reason. Never sent to the cloud |
| Invalid or schema-violating JSON | One repair attempt on the same local model inside the same deadline, then the job fails |
| Cancelled | No retry, no fallback |
| Fallback worker also fails | Job fails. No third attempt |

Text results are reviewed by you (approve/reject). Hermes' diff review does not
apply to text, and is not run on local-only output.

## Run the smoke test on your Mac

Prerequisites: Ollama running, `ollama pull qwen3:4b` done (AgentOS never
downloads models).

```
npm run smoke:ollama -- --out docs/local-routing/evidence.md
# to also run the remote implementation job for real (spends on that worker):
npm run smoke:ollama -- --run-remote --out docs/local-routing/evidence.md
```

It uses a throwaway state directory, never your real one. It exits non-zero on
any failure. Scenarios:

| # | What it proves |
|---|---|
| A | Short summary -> qwen3:4b, cold and warm latency, validation, review, completion |
| B | JSON extraction is schema-valid, or fails closed |
| C | Repository change routes to a tool-capable worker, not Ollama |
| D | A real local timeout fails cleanly; local-only does not reach the cloud |
| E | Local-only with Ollama unreachable is blocked with a reason |
| F | Two simultaneous local jobs run one at a time |
| G | Cancelling a running job makes no retry or fallback |
| H | Regression: an existing worker still runs the unchanged pipeline |

**C reports "inconclusive" unless a real implementation worker is available.**
Enable one in Operations -> AI Stack (or set `ANTHROPIC_API_KEY`) and re-run
with `--run-remote` for the remote-route sample.

## Completion evidence

The ticket is complete when a report from your Mac shows these four jobs with
real numbers. Do not mark it complete from mocked tests alone.

First run: `evidence-2026-09-30.md` (M4, 16 GB, Ollama 0.35.0, qwen3:4b
`359d7dd4bcda`). Read it with the reviewer note at its top.

| Sample | Scenario | Routing reason | Measured | Result |
|---|---|---|---|---|
| Local summary | A | small bounded summarisation within local limits | cold 21.9 s (model load 4.8 s), warm 16.3 s, 131 in / 512 out tokens | **Not accepted**: reasoning transcript, truncated at the token cap. Re-run needed |
| Remote implementation | C (`--run-remote`) | grok: needs repository, tools, file_writes | routing decision only, not run | **Not demonstrated**: routed, never executed |
| Handled local failure | D | local timeout at a 1 s deadline on a cold model | 1 attempt, `timeout`, no cloud attempt | Pass |
| Local-only blocked | E | Ollama unreachable, local-only | refused, "not sent to the cloud" | Pass |

Also measured: JSON extraction 2.3 s (valid, but with an invented year), and
two simultaneous jobs ran strictly one at a time (second waited 15.5 s).

Remaining before completion: re-run with the fixes, get a five-bullet summary
in a few seconds, and run C with `--run-remote`.

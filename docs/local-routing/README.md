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

## Choosing a model

Installed does not mean suitable, and a model that reports `thinking` support is
not necessarily one that can be told to stop. Bounded tasks (summaries,
extraction, rewriting) need a **non-thinking instruct model** that answers in
tens of tokens. The smoke test's scenario T checks this directly.

Measured on an M4 / 16 GB / Ollama 0.35.0 with `qwen3:4b`
(`359d7dd4bcda`, capabilities `completion, tools, thinking`), same five-bullet
summary, 512-token cap:

| Request | Outcome |
|---|---|
| `think=false` (what AgentOS sends) | Ignored. Reasoning transcript in the content, cut off at 512 tokens, 20.3 s |
| flag omitted | Reasoning goes to the `thinking` field (2,106 chars) and uses the whole budget; content empty, 15.4 s |
| `/no_think` appended | Ignored. Same as `think=false` |

So this build cannot be bounded to a small budget, and AgentOS correctly refuses
its output (`output_truncated`) instead of passing a transcript to review. It
is not a fit for the 512-token / 30 s policy; raising the limits to fit its
reasoning (about 600+ tokens, 20 s+ of generation) leaves no headroom for a cold
load inside a 30 s deadline.

Measured with the Test model button on the same machine:

| Model | Result | Detail |
|---|---|---|
| `qwen3:4b` (`359d7dd4bcda`) | Failed | Reasoning transcript, 21 bullet-like lines, stopped at the 512-token limit, 20.5 s |
| `qwen2.5-coder:7b` (`dae161e27b0e`) | **Passed** | Five bullets in 61 tokens, 12.4 s cold of which 8.7 s was model load (about 3.7 s of work) |

**A model's test result affects routing.** A model with a current failing
result is skipped for automatic routing (and shown under "Ruled out" with the
reason), even if it is the one already loaded in memory. Among usable local
models, one that passed its test is preferred over an untested one, and
"already loaded" only breaks a tie after that. "Current" means the same build
and the same limits: re-pulling the model, or editing its limits, makes the
result read "test again" and lifts the skip until it is tested again. An
untested model is still usable, because testing is evidence, not a gate on new
models.

**Test model.** Every installed model in Workers -> Local models has a
**Test model** button. It runs a real five-bullet task (and a JSON task if the
model is marked for structured output) with the limits currently on screen,
through the same one-at-a-time gate as real jobs, and checks that the model
finishes inside the output limit, returns five bullets, and meets the
deadline. If it fails it also tries the thinking flag omitted and `/no_think`,
and says which of them changes the outcome. The result is stored against the
model's digest: re-pulling the model, or changing its limits, marks it "test
again". A model that failed can still be enabled, but it carries a warning.
Testing never changes a setting. `npm run smoke:ollama` scenario T runs the
identical test.

To find a suitable model: pull a non-thinking instruct model with Ollama (for
example an instruct variant of Qwen3-4B, `llama3.2:3b`, or `gemma3:4b`; check
the exact tags on ollama.com/library) and run
`npm run smoke:ollama -- --model <name> --out docs/local-routing/evidence-<name>.md`.
Enable it in Workers -> Local models only after scenarios T and A pass.

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

Run 2 (`evidence.md`): M4, 16 GB, Ollama 0.35.0, `qwen2.5-coder:7b`
(`dae161e27b0e`), default limits (2,000 in / 512 out / 30 s / 1 concurrent).
9 pass, 0 fail, 0 inconclusive. The earlier run with `qwen3:4b`
(`evidence-2026-09-30.md`) is kept as history: that model cannot be bounded.

| Sample | Scenario | Routing reason | Measured | Result |
|---|---|---|---|---|
| Local summary | A | small bounded summarisation within local limits; passed its suitability test | cold 10.9 s (model load 7.3 s), warm 3.0 s, 129 in / 61 out tokens; exactly five correct bullets; approved, completed | Pass |
| Handled local failure | D | local-only; cold model, 1 s deadline | 1 attempt, `timeout`, no cloud attempt | Pass |
| Local-only blocked | E | Ollama unreachable, local-only | refused, "not sent to the cloud" | Pass |
| Remote implementation | C | grok: needs repository, tools, file_writes; `qwen2.5-coder:7b` ruled out (lacks capability) | routing decision only | **Route shown, job not run.** Run with `--run-remote` (spends on grok) |

Also measured: JSON extraction 3.1 s, schema-valid with no invented dates;
two simultaneous jobs ran strictly one at a time (second waited 3.2 s);
cancelling a running job made no retry or fallback; an existing worker (mock)
still ran the unchanged pipeline.

**Limits.** With this model the defaults have wide margins: cold 10.9-12.8 s
against a 30 s deadline (most of it disk load), warm about 3 s, outputs of 53-61
tokens against a 512 cap, prompts of about 130-140 tokens against 2,000. No
change is needed. The cost to plan for is the cold load (7-9 s): Ollama unloads
an idle model after its own keep-alive (five minutes by default), so the first
task after a quiet period is the slow one.

Remaining before completion: run C with `--run-remote` (it defaults to a small
task, "add a CONTRIBUTING.md", not the ticket's whole-application example; pass
`--remote-objective` to choose) and record the result here.

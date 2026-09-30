# Local routing: real-hardware evidence

- Run: 2026-09-30T07:06:55.827Z
- Machine: darwin arm64, Apple M4, 16 GB RAM, Node v26.8.1, Ollama 0.35.0
- Ollama: http://127.0.0.1:11434, model `qwen3:4b`, digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`
- Limits under test: 2000 input tokens, 512 output tokens, 30 s deadline, 1 concurrent (starting policies, not measured guarantees)
- Result: 8 pass, 0 fail, 0 inconclusive

| # | Scenario | Result |
|---|---|---|
| A | Short summary routes to local qwen3:4b, is validated, and completes via review | PASS |
| B | Extraction returns schema-valid JSON, or fails closed (never a bad result marked done) | PASS |
| C | Repository change routes to a tool-capable existing worker, never the text-only model | PASS |
| D | A real local timeout (cold model, 1s deadline) fails cleanly; local-only never falls back to the cloud | PASS |
| E | Local-only task with Ollama unreachable is blocked with a reason, not sent to the cloud | PASS |
| F | Two simultaneous local jobs run one at a time | PASS |
| G | Cancelling a running local job stops it with no retry or fallback | PASS |
| H | Regression: an existing worker (mock, explicit choice) runs the unchanged pipeline with a worktree | PASS |

## A. Short summary routes to local qwen3:4b, is validated, and completes via review

**PASS**

- route: ollama (qwen3:4b): small bounded summarisation, simple task within local limits.
- attempt 1: ollama:qwen3:4b succeeded, tokens 131/512, queue 0ms, load 4815ms, total 21903ms, digest 359d7dd4bcda
- cold total (wall): 21903ms of which model load 4815ms
- warm rerun: attempt 1: ollama:qwen3:4b succeeded, tokens 131/512, queue 0ms, load 3ms, total 16318ms, digest 359d7dd4bcda
- output: "We are given meeting notes and need to summarize into five bullets.\n The notes: \n   \"Weekly sync, 29 Sep. Priya will ship the invoice export by Friday 3 October. Marcus owns the QA pass and reports on Monday 6 October. Budget for the pilot was approved at R45,000. Open risk: the bank feed sandbox is flaky. Decision: postpone the mobile redesign to November.\"\n\n Steps:\n 1. Identify key points and br"
- approval: approved, job completed

## B. Extraction returns schema-valid JSON, or fails closed (never a bad result marked done)

**PASS**

- attempt 1: ollama:qwen3:4b succeeded, tokens 142/65, queue 0ms, load 3ms, total 2261ms, digest 359d7dd4bcda
- status: awaiting_review
- output: "{\n  \"items\": [\n    {\n      \"person\": \"Priya\",\n      \"date\": \"2023-10-03\"\n    },\n    {\n      \"person\": \"Marcus\",\n      \"date\": \"2023-10-06\"\n    }\n  ]\n}"
- generation attempts: 1

## C. Repository change routes to a tool-capable existing worker, never the text-only model

**PASS**

- route: grok: Needs repository, tools, file_writes, which a text-only model cannot supply. Routed to a capable existing worker.
- ruled out claude: ANTHROPIC_API_KEY is not set. The Claude worker runs in its own configuration directory, so an interactive `claude` login on this machine does not reach it.
- ruled out claude-code: Claude Code is switched off in Operations → AI Stack.
- ruled out codex: Codex is switched off in Operations → AI Stack.
- ruled out gemini: Gemini CLI is switched off in Operations → AI Stack.
- ruled out hermes-worker: Hermes Agent is switched off in Operations → AI Stack.
- ruled out ollama:qwen2.5-coder:7b: Installed but not enabled for routing. Enable it and configure its capabilities first.
- ruled out ollama:qwen3:4b: Lacks required capability: repository, tools, file_writes.
- route only; pass --run-remote to actually run it (this spends on the selected worker)

## D. A real local timeout (cold model, 1s deadline) fails cleanly; local-only never falls back to the cloud

**PASS**

- attempt 1: ollama:qwen3:4b failed (timeout), tokens ?/?, queue n/a, load n/a, total n/a
- status: failed, error: Ollama did not finish within 1s.
- attempts made: 1, all local: true

## E. Local-only task with Ollama unreachable is blocked with a reason, not sent to the cloud

**PASS**

- result: refused: Task is local-only and no local model is available right now. It was not sent to the cloud.

## F. Two simultaneous local jobs run one at a time

**PASS**

- attempt 1: ollama:qwen3:4b succeeded, tokens 131/512, queue 0ms, load 1ms, total 15525ms, digest 359d7dd4bcda
- attempt 1: ollama:qwen3:4b succeeded, tokens 131/512, queue 15495ms, load 6ms, total 15952ms, digest 359d7dd4bcda
- the second job waited 15495ms for the first

## G. Cancelling a running local job stops it with no retry or fallback

**PASS**

- status: cancelled
- attempt 1: ollama:qwen3:4b cancelled (cancelled), tokens ?/?, queue n/a, load n/a, total n/a

## H. Regression: an existing worker (mock, explicit choice) runs the unchanged pipeline with a worktree

**PASS**

- status: awaiting_review
- worktree isolated: true
- route policy not involved: true

## Notes

- Local execution has no provider API charge. Electricity and hardware use are not included, and no cloud saving is claimed.
- Token counts are Ollama's own; the pre-run input check is a character estimate.
- Cold timings include loading the model from disk. Warm timings are the second run.

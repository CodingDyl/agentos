# Local routing: real-hardware evidence

- Run: 2026-09-30T09:09:53.721Z
- Machine: darwin arm64, Apple M4, 16 GB RAM, Node v26.8.1, Ollama 0.35.0
- Ollama: http://127.0.0.1:11434, model `qwen2.5-coder:7b`, digest `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`
- Limits under test: 2000 input tokens, 512 output tokens, 30 s deadline, 1 concurrent (starting policies, not measured guarantees)
- Result: 9 pass, 0 fail, 0 inconclusive

| # | Scenario | Result |
|---|---|---|
| T | Suitability test (identical to the Test model button in Workers) | PASS |
| A | Short summary routes to local qwen3:4b, is validated, and completes via review | PASS |
| B | Extraction returns schema-valid JSON, or fails closed (never a bad result marked done) | PASS |
| C | Repository change routes to a tool-capable existing worker, never the text-only model | PASS |
| D | A real local timeout (cold model, 1s deadline) fails cleanly; local-only never falls back to the cloud | PASS |
| E | Local-only task with Ollama unreachable is blocked with a reason, not sent to the cloud | PASS |
| F | Two simultaneous local jobs run one at a time | PASS |
| G | Cancelling a running local job stops it with no retry or fallback | PASS |
| H | Regression: an existing worker (mock, explicit choice) runs the unchanged pipeline with a worktree | PASS |

## T. Suitability test (identical to the Test model button in Workers)

**PASS**

- Suitable for bounded tasks within the configured limits.
- pass: Finishes inside the output limit: 61 of 512 tokens.
- pass: Answers the task (five bullets): Returned five bullets.
- pass: Meets the deadline: 12.8s of 30s (model load 9.1s).
- pass: Returns schema-valid JSON: Valid and matched the schema.
- As AgentOS sends it: ended stop, 61 tokens, thinking 0 chars, 12760ms, starts "- Priya to ship invoice export by Friday, 3 October\n- Marcus to report on QA pass by Monday, 6 Octob"
- JSON extraction: ended stop, 53 tokens, thinking 0 chars, 3059ms, starts "{\n  \"items\": [\n    {\n      \"person\": \"Priya\",\n      \"date\": \"Friday 3 October\"\n    },\n    {\n      \"p"

## A. Short summary routes to local qwen3:4b, is validated, and completes via review

**PASS**

- route: ollama (qwen2.5-coder:7b): small bounded summarisation, simple task within local limits.
- attempt 1: ollama:qwen2.5-coder:7b succeeded, tokens 129/61, queue 0ms, load 7333ms, total 10895ms, digest dae161e27b0e
- cold total (wall): 10895ms of which model load 7333ms
- warm rerun: attempt 1: ollama:qwen2.5-coder:7b succeeded, tokens 129/61, queue 0ms, load 6ms, total 2953ms, digest dae161e27b0e
- bullet lines in the output: 5 (the task asked for 5)
- output: "- Priya to ship invoice export by Friday, 3 October\n- Marcus to report on QA pass by Monday, 6 October\n- Budget for the pilot approved at R45,000\n- Bank feed sandbox is flaky, open risk\n- Mobile redesign postponed to November"
- approval: approved, job completed

## B. Extraction returns schema-valid JSON, or fails closed (never a bad result marked done)

**PASS**

- attempt 1: ollama:qwen2.5-coder:7b succeeded, tokens 140/53, queue 0ms, load 5ms, total 3059ms, digest dae161e27b0e
- status: awaiting_review
- no invented years detected
- output: "{\n  \"items\": [\n    {\n      \"person\": \"Priya\",\n      \"date\": \"Friday 3 October\"\n    },\n    {\n      \"person\": \"Marcus\",\n      \"date\": \"Monday 6 October\"\n    }\n  ]\n}"
- generation attempts: 1

## C. Repository change routes to a tool-capable existing worker, never the text-only model

**PASS**

- route: grok: Needs repository, tools, file_writes, which a text-only model cannot supply. Routed to a capable existing worker.
- ruled out claude: ANTHROPIC_API_KEY is not set. The Claude worker runs in its own configuration directory, so an interactive `claude` login on this machine does not reach it.
- ruled out claude-code: Claude Code is switched off in Operations → AI Stack.
- ruled out codex: Codex is switched off in Operations → AI Stack.
- ruled out gemini: Gemini CLI is switched off in Operations → AI Stack.
- ruled out hermes-worker: Hermes Agent is switched off in Operations → AI Stack.
- ruled out ollama:qwen2.5-coder:7b: Lacks required capability: repository, tools, file_writes.
- ruled out ollama:qwen3:4b: Installed but not enabled for routing. Enable it and configure its capabilities first.
- route only; pass --run-remote to actually run it (this spends on the selected worker)

## D. A real local timeout (cold model, 1s deadline) fails cleanly; local-only never falls back to the cloud

**PASS**

- attempt 1: ollama:qwen2.5-coder:7b failed (timeout), tokens ?/?, queue n/a, load n/a, total n/a
- status: failed, error: Ollama did not finish within 1s.
- attempts made: 1, all local: true

## E. Local-only task with Ollama unreachable is blocked with a reason, not sent to the cloud

**PASS**

- result: refused: Task is local-only and no local model is available right now. It was not sent to the cloud.

## F. Two simultaneous local jobs run one at a time

**PASS**

- attempt 1: ollama:qwen2.5-coder:7b succeeded, tokens 129/61, queue 0ms, load 3ms, total 3257ms, digest dae161e27b0e
- attempt 1: ollama:qwen2.5-coder:7b succeeded, tokens 129/61, queue 3215ms, load 4ms, total 2933ms, digest dae161e27b0e
- the second job waited 3215ms for the first

## G. Cancelling a running local job stops it with no retry or fallback

**PASS**

- status: cancelled
- attempt 1: ollama:qwen2.5-coder:7b cancelled (cancelled), tokens ?/?, queue n/a, load n/a, total n/a

## H. Regression: an existing worker (mock, explicit choice) runs the unchanged pipeline with a worktree

**PASS**

- status: awaiting_review
- worktree isolated: true
- route policy not involved: true

## Notes

- Local execution has no provider API charge. Electricity and hardware use are not included, and no cloud saving is claimed.
- Token counts are Ollama's own; the pre-run input check is a character estimate.
- Cold timings include loading the model from disk. Warm timings are the second run.

/**
 * Real-hardware smoke test for local Ollama routing.
 *
 *   npm run smoke:ollama                       # local scenarios, spends nothing
 *   npm run smoke:ollama -- --run-remote       # also RUNS the remote implementation job (spends)
 *   npm run smoke:ollama -- --out report.md    # where the evidence report goes
 *   npm run smoke:ollama -- --base-url http://127.0.0.1:11434 --model qwen3:4b
 *
 * Drives the real job manager, policy, adapter and review path against your
 * running Ollama. Nothing is mocked. State is written to a throwaway directory,
 * never to your real ~/.agentos-ui, and models are only ever read and run:
 * nothing is downloaded, copied or deleted.
 *
 * The output is a Markdown evidence report. A scenario that could not be
 * exercised is reported as inconclusive, never as a pass.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE_URL = option("base-url", "http://127.0.0.1:11434");
const MODEL = option("model", "qwen3:4b");
const OUT = path.resolve(option("out", "ollama-smoke-report.md"));
const RUN_REMOTE = flag("run-remote");

// Must be set before any AgentOS module reads its state directory.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-smoke-"));
process.env.AGENTOS_UI_DIR = STATE_DIR;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Verdict = "pass" | "fail" | "inconclusive";

interface Scenario {
  id: string;
  title: string;
  verdict: Verdict;
  routing?: string;
  observed: string[];
}

const scenarios: Scenario[] = [];

function record(scenario: Scenario): void {
  scenarios.push(scenario);
  const mark = scenario.verdict === "pass" ? "PASS" : scenario.verdict === "fail" ? "FAIL" : "----";
  console.log(`\n[${mark}] ${scenario.id} ${scenario.title}`);
  for (const line of scenario.observed) console.log(`       ${line}`);
}

async function json(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(new URL(pathname, BASE_URL), init);
  return response.json();
}

async function main(): Promise<void> {
  console.log(`AgentOS local-routing smoke test\n  Ollama: ${BASE_URL}\n  Model:  ${MODEL}\n  State:  ${STATE_DIR} (throwaway)`);

  /* -------------------------------- preflight -------------------------------- */

  let version = "unknown";
  let digest: string | undefined;
  try {
    version = String(((await json("/api/version")) as { version?: string }).version ?? "unknown");
    const tags = (await json("/api/tags")) as { models?: Array<{ name: string; digest?: string }> };
    digest = tags.models?.find((model) => model.name === MODEL)?.digest;
    if (!digest) {
      console.error(`\n${MODEL} is not installed in Ollama. Install it with Ollama (AgentOS never downloads models), then re-run.`);
      console.error(`Installed: ${(tags.models ?? []).map((m) => m.name).join(", ") || "(none)"}`);
      process.exit(2);
    }
  } catch (error) {
    console.error(`\nCould not reach Ollama at ${BASE_URL}: ${error instanceof Error ? error.message : error}. Is it running?`);
    process.exit(2);
  }

  const cpu = os.cpus()[0]?.model ?? "unknown CPU";
  const machine = `${os.platform()} ${os.arch()}, ${cpu}, ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB RAM, Node ${process.version}, Ollama ${version}`;
  console.log(`  Machine: ${machine}`);

  const settings = await import("../../ai-stack/settings");
  const { defaultOllamaModelConfig } = await import("../../../shared/route-policy-types");
  const manager = await import("../../workers/job-manager");
  const review = await import("../../workers/review");
  const store = await import("../../workers/job-store");
  const dispatch = await import("../dispatch");

  const configure = (over: { baseUrl?: string; timeoutMs?: number; fallback?: "none" | "cloud" } = {}) => {
    settings.resetAiSettingsCache();
    settings.setOllamaSettings({
      baseUrl: over.baseUrl ?? BASE_URL,
      maxConcurrent: 1,
      fallback: over.fallback ?? "none",
      models: {
        [MODEL]: {
          ...defaultOllamaModelConfig(),
          enabled: true,
          structuredOutput: true,
          timeoutMs: over.timeoutMs ?? 30_000,
        },
      },
    });
  };

  const settle = async (jobId: string) => {
    for (let i = 0; i < 1200 && manager.isRunning(jobId); i += 1) await sleep(100);
    const job = await store.readJob(jobId);
    if (!job) throw new Error(`job ${jobId} vanished`);
    return job;
  };

  const ms = (n: number | undefined) => (n === undefined ? "n/a" : `${n}ms`);
  const describe = (job: Awaited<ReturnType<typeof settle>>) =>
    (job.attempts ?? []).map(
      (a) =>
        `attempt ${a.attempt}: ${a.optionId} ${a.outcome}${a.failureKind ? ` (${a.failureKind})` : ""}, ` +
        `tokens ${a.inputTokens ?? "?"}/${a.outputTokens ?? "?"}, queue ${ms(a.queueMs)}, load ${ms(a.loadMs)}, total ${ms(a.totalMs)}` +
        (a.modelDigest ? `, digest ${a.modelDigest.replace("sha256:", "").slice(0, 12)}` : ""),
    );

  const NOTES =
    "Weekly sync, 29 Sep. Priya will ship the invoice export by Friday 3 October. " +
    "Marcus owns the QA pass and reports on Monday 6 October. Budget for the pilot was approved at R45,000. " +
    "Open risk: the bank feed sandbox is flaky. Decision: postpone the mobile redesign to November.";

  /* ---------- T. suitability: the same test as the "Test model" button ---------- */

  {
    const { probeModel } = await import("../model-probe");
    const result = await probeModel({
      baseUrl: BASE_URL,
      model: MODEL,
      config: { ...defaultOllamaModelConfig(), enabled: true, structuredOutput: true },
      maxConcurrent: 1,
    });

    record({
      id: "T",
      title: "Suitability test (identical to the Test model button in Workers)",
      verdict: result.verdict === "suitable" ? "pass" : "fail",
      observed: [
        result.summary,
        ...result.checks.map((check) => `${check.passed ? "pass" : "FAIL"}: ${check.name}: ${check.detail}`),
        ...result.variants.map(
          (v) =>
            `${v.label}: ${v.error ?? `ended ${v.doneReason}, ${v.outputTokens ?? "?"} tokens, thinking ${v.thinkingChars ?? 0} chars, ${v.totalMs ?? "?"}ms`}` +
            (v.startsWith ? `, starts ${JSON.stringify(v.startsWith.slice(0, 100))}` : ""),
        ),
        ...(result.recommendation ? [`advice: ${result.recommendation}`] : []),
      ],
    });
  }

  /* ---------------- A. local summary, cold then warm, then review ---------------- */


  // Start cold, so the first number is an honest cold-load figure.
  await fetch(new URL("/api/generate", BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
  }).catch(() => undefined);
  await sleep(1500);

  configure();
  const summary = (extra = {}) => ({
    worker: "auto" as const,
    project: "agentos",
    objective: "Summarise these meeting notes into five bullets",
    inputText: NOTES,
    ...extra,
  });

  {
    const started = await manager.startJob(summary());
    if (!started.job) {
      record({ id: "A", title: "Local summary", verdict: "fail", observed: [`Could not start: ${started.error}`] });
    } else {
      const job = await settle(started.job.id);
      if (job.status === "failed") console.log(`       (A job failed: ${job.error})`);
      const first = job.attempts?.[0];
      const routedLocal = job.resolvedWorker === "ollama" && first?.modelId === MODEL;

      // Same task again, model now resident: the warm figure.
      const warmStart = await manager.startJob(summary());
      const warm = warmStart.job ? await settle(warmStart.job.id) : undefined;

      const approved = job.status === "awaiting_review" ? await review.approveJob(job.id) : undefined;
      const final = await store.readJob(job.id);

      // Judged on what the task asked for (five bullets), not merely on "some
      // text came back": a reasoning transcript is non-empty and still wrong.
      const bullets = (job.result?.summary ?? "").split("\n").filter((line) => /^\s*(?:[-*\u2022]|\d+[.)])\s+\S/.test(line)).length;
      const ok =
        routedLocal &&
        job.status === "awaiting_review" &&
        bullets === 5 &&
        Boolean(first?.modelDigest) &&
        final?.status === "completed";
      record({
        id: "A",
        title: "Short summary routes to local qwen3:4b, is validated, and completes via review",
        verdict: ok ? "pass" : "fail",
        routing: job.routing?.policy?.reason,
        observed: [
          `route: ${job.routing?.policy?.reason ?? "(none)"}`,
          ...describe(job),
          `cold total (wall): ${ms(first?.totalMs)} of which model load ${ms(first?.loadMs)}`,
          warm ? `warm rerun: ${describe(warm).join(" | ")}` : "warm rerun did not start",
          `bullet lines in the output: ${bullets} (the task asked for 5)`,
          `output: ${JSON.stringify(job.result?.summary?.slice(0, 400))}`,
          `approval: ${approved?.ok ? "approved, job completed" : (approved?.error ?? "not attempted")}`,
        ],
      });
    }
  }

  /* ------------------------ B. structured extraction ------------------------ */

  {
    const started = await manager.startJob({
      worker: "auto",
      project: "agentos",
      objective: "Extract every person, and the date they are due to deliver something, as JSON",
      inputText: NOTES,
      expectedOutput: {
        format: "json",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "object", properties: { person: { type: "string" }, date: { type: "string" } }, required: ["person", "date"] },
            },
          },
          required: ["items"],
        },
      },
    });
    if (!started.job) {
      record({ id: "B", title: "JSON extraction", verdict: "fail", observed: [`Could not start: ${started.error}`] });
    } else {
      const job = await settle(started.job.id);
      let parsed: unknown;
      try {
        parsed = JSON.parse(job.result?.summary ?? "");
      } catch {
        parsed = undefined;
      }
      // Either outcome is legitimate; what must never happen is an invalid
      // result marked successful.
      const validOk = job.status === "awaiting_review" && parsed !== undefined;
      const failedClosed = job.status === "failed" && job.attempts?.at(-1)?.failureKind === "invalid_output";
      record({
        id: "B",
        title: "Extraction returns schema-valid JSON, or fails closed (never a bad result marked done)",
        verdict: validOk || failedClosed ? "pass" : "fail",
        observed: [...describe(job), `status: ${job.status}`,
          /\b(19|20)\d\d\b/.test(job.result?.summary ?? "") && !/\b(19|20)\d\d\b/.test(NOTES)
            ? "NOTE: the output contains a year that is not in the input. Valid JSON is not the same as correct content; review extractions."
            : "no invented years detected", `output: ${JSON.stringify(job.result?.summary?.slice(0, 400))}`, `generation attempts: ${job.result?.providerMetrics?.attempts ?? "n/a (failed)"}`],
      });
    }
  }

  /* ---------------------- C. remote implementation route ---------------------- */

  {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-smoke-repo-"));
    execFileSync("git", ["init", "-q", "."], { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "# smoke\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=s@s", "-c", "user.name=s", "commit", "-qm", "init"], { cwd: repo });

    const request = {
      worker: "auto" as const,
      project: "agentos",
      objective: "Implement authentication across this application and run its tests",
      repoPath: repo,
    };
    const planned = await dispatch.planRoute(request);
    const record_ = planned?.record;
    const selected = record_?.selected;
    const notLocal = selected?.workerId !== "ollama";
    const observed = [
      planned ? `route: ${record_?.status === "selected" ? record_.reason : record_?.blockedReason}` : "policy had nothing to add; legacy Hermes routing applies",
      ...(record_?.rejected ?? []).map((r) => `ruled out ${r.optionId}: ${r.reason}`),
    ];

    if (RUN_REMOTE && selected) {
      const started = await manager.startJob(request);
      if (started.job) {
        const job = await settle(started.job.id);
        observed.push(`ran on ${job.resolvedWorker}: status ${job.status}`, ...describe(job));
      } else {
        observed.push(`could not start: ${started.error}`);
      }
    } else if (selected) {
      observed.push("route only; pass --run-remote to actually run it (this spends on the selected worker)");
    }

    record({
      id: "C",
      title: "Repository change routes to a tool-capable existing worker, never the text-only model",
      // Passing needs a real tool-capable worker selected; a blocked route proves
      // only that Ollama was not used, which is not the demonstration wanted.
      verdict: !notLocal ? "fail" : selected ? "pass" : "inconclusive",
      routing: selected ? `${selected.workerId}` : "blocked",
      observed: selected ? observed : [...observed, "No implementation worker is available on this machine right now, so the route is blocked. That is correct (it is not sent to Ollama) but it is not a demonstration of a successful remote route. Configure a worker and re-run."],
    });
  }

  /* ------------------ D. real local failure: timeout, local-only ------------------ */

  {
    await fetch(new URL("/api/generate", BASE_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
    }).catch(() => undefined);
    await sleep(1500);
    configure({ timeoutMs: 1000, fallback: "cloud" });

    const started = await manager.startJob(summary({ routingHints: { localOnly: true } }));
    if (!started.job) {
      record({ id: "D", title: "Handled local failure", verdict: "fail", observed: [`Could not start: ${started.error}`] });
    } else {
      const job = await settle(started.job.id);
      const attempts = job.attempts ?? [];
      const timedOut = job.status === "failed" && attempts[0]?.failureKind === "timeout";
      const noCloud = attempts.length === 1 && attempts.every((a) => a.location === "local");
      record({
        id: "D",
        title: "A real local timeout (cold model, 1s deadline) fails cleanly; local-only never falls back to the cloud",
        verdict: timedOut ? (noCloud ? "pass" : "fail") : job.status === "awaiting_review" ? "inconclusive" : "fail",
        observed: [
          ...describe(job),
          `status: ${job.status}, error: ${job.error ?? "none"}`,
          job.status === "awaiting_review" ? "The model answered inside 1s (it was still resident), so no failure occurred. Re-run after `ollama stop " + MODEL + "`." : `attempts made: ${attempts.length}, all local: ${noCloud}`,
        ],
      });
    }
  }

  /* ------------------------ E. local-only with Ollama down ------------------------ */

  {
    configure({ baseUrl: "http://127.0.0.1:9" });
    const started = await manager.startJob(summary({ routingHints: { localOnly: true } }));
    const refused = !started.job && /not sent to the cloud/.test(started.error ?? "");
    record({
      id: "E",
      title: "Local-only task with Ollama unreachable is blocked with a reason, not sent to the cloud",
      verdict: refused ? "pass" : "fail",
      observed: [`result: ${started.job ? `STARTED as ${started.job.resolvedWorker}` : `refused: ${started.error}`}`],
    });
  }

  /* ------------- F. concurrency (one at a time) and G. cancellation ------------- */

  configure();
  {
    const a = await manager.startJob(summary());
    const b = await manager.startJob(summary());
    if (a.job && b.job) {
      const [ja, jb] = await Promise.all([settle(a.job.id), settle(b.job.id)]);
      const queue = Math.max(ja.attempts?.[0]?.queueMs ?? 0, jb.attempts?.[0]?.queueMs ?? 0);
      record({
        id: "F",
        title: "Two simultaneous local jobs run one at a time",
        verdict: queue > 0 ? "pass" : "inconclusive",
        observed: [...describe(ja), ...describe(jb), queue > 0 ? `the second job waited ${ms(queue)} for the first` : "neither job queued; they may not have overlapped"],
      });
    } else {
      record({ id: "F", title: "Concurrency", verdict: "fail", observed: [`could not start both: ${a.error ?? ""} ${b.error ?? ""}`] });
    }
  }

  {
    await fetch(new URL("/api/generate", BASE_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
    }).catch(() => undefined);
    await sleep(1000);
    const started = await manager.startJob(summary());
    if (started.job) {
      await sleep(400);
      await manager.cancelJob(started.job.id);
      const job = await settle(started.job.id);
      await sleep(500);
      const after = await store.readJob(started.job.id);
      record({
        id: "G",
        title: "Cancelling a running local job stops it with no retry or fallback",
        verdict: job.status === "cancelled" && (after?.attempts?.length ?? 0) === 1 ? "pass" : "fail",
        observed: [`status: ${job.status}`, ...describe(after ?? job)],
      });
    }
  }

  /* --------------------- H. regression: an existing worker --------------------- */

  {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-smoke-repo-"));
    execFileSync("git", ["init", "-q", "."], { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "# smoke\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=s@s", "-c", "user.name=s", "commit", "-qm", "init"], { cwd: repo });

    // The explicit-worker path with no routing mode: exactly what existed before.
    const started = await manager.startJob({ worker: "mock", project: "agentos", objective: "Regression: existing worker pipeline", repoPath: repo });
    if (started.job) {
      const job = await settle(started.job.id);
      const untouched = job.routing?.policy === undefined && job.attempts === undefined;
      record({
        id: "H",
        title: "Regression: an existing worker (mock, explicit choice) runs the unchanged pipeline with a worktree",
        verdict: job.status === "awaiting_review" && Boolean(job.worktreePath) && untouched ? "pass" : "fail",
        observed: [`status: ${job.status}`, `worktree isolated: ${Boolean(job.worktreePath)}`, `route policy not involved: ${untouched}`],
      });
    } else {
      record({ id: "H", title: "Regression: existing worker", verdict: "fail", observed: [`could not start: ${started.error}`] });
    }
  }

  /* -------------------------------- report -------------------------------- */

  const failed = scenarios.filter((s) => s.verdict === "fail").length;
  const inconclusive = scenarios.filter((s) => s.verdict === "inconclusive").length;
  const report = [
    "# Local routing: real-hardware evidence",
    "",
    `- Run: ${new Date().toISOString()}`,
    `- Machine: ${machine}`,
    `- Ollama: ${BASE_URL}, model \`${MODEL}\`, digest \`${digest}\``,
    `- Limits under test: 2000 input tokens, 512 output tokens, 30 s deadline, 1 concurrent (starting policies, not measured guarantees)`,
    `- Result: ${scenarios.length - failed - inconclusive} pass, ${failed} fail, ${inconclusive} inconclusive`,
    "",
    "| # | Scenario | Result |",
    "|---|---|---|",
    ...scenarios.map((s) => `| ${s.id} | ${s.title} | ${s.verdict.toUpperCase()} |`),
    "",
    ...scenarios.flatMap((s) => [`## ${s.id}. ${s.title}`, "", `**${s.verdict.toUpperCase()}**`, "", ...s.observed.map((line) => `- ${line}`), ""]),
    "## Notes",
    "",
    "- Local execution has no provider API charge. Electricity and hardware use are not included, and no cloud saving is claimed.",
    "- Token counts are Ollama's own; the pre-run input check is a character estimate.",
    "- Cold timings include loading the model from disk. Warm timings are the second run.",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, report);
  console.log(`\n${scenarios.length - failed - inconclusive} pass, ${failed} fail, ${inconclusive} inconclusive. Report written to ${OUT}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

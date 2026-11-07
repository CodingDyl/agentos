import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import os from "node:os";
import { appendEvalRun, compareToPrevious, readEvalHistory } from "../../server/evals/history";
import { uiStateDir } from "../../server/agentos/session-store";

/**
 * `npm run eval:mail` — runs the mail triage eval and records how it scored.
 *
 *   tsx scripts/evals/run.ts mail          synthetic threads (safe, a small Jev spend)
 *   tsx scripts/evals/run.ts mail --real   the owner's own corrections (sends real mail
 *                                          metadata to Jev, so it is only ever run by hand)
 *
 * Promptfoo runs from its own package in `evals/`, with telemetry and update
 * checks off and its state kept in AgentOS's UI folder. Nothing is shared
 * anywhere: this never calls `promptfoo share`.
 */

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const evalsDir = path.join(root, "evals");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

function loadEnvFile(): void {
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {
    // No .env: the key may come from the environment itself.
  }
}

async function currentCommit(): Promise<string> {
  try {
    return (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

interface PromptfooOutput {
  results?: { stats?: { successes?: number; failures?: number; errors?: number } };
}

async function main(): Promise<void> {
  const [suiteName, ...flags] = process.argv.slice(2);
  if (suiteName !== "mail") fail("Usage: tsx scripts/evals/run.ts mail [--real]");
  const real = flags.includes("--real");

  loadEnvFile();
  if (!process.env.JEV_API_KEY?.trim()) {
    fail("JEV_API_KEY is not set, so the mail eval cannot call Jev. Add it to .env (see .env.example), then run it again.");
  }

  const bin = path.join(evalsDir, "node_modules", "promptfoo", "dist", "src", "entrypoint.js");
  if (!(await exists(bin))) fail("Promptfoo is not installed yet. Run: npm run eval:install");

  const stateRoot = path.join(uiStateDir(), "evals");
  const promptfooDir = path.join(stateRoot, "promptfoo");
  await fs.mkdir(promptfooDir, { recursive: true, mode: 0o700 });
  const outputDir = path.join(evalsDir, "output");
  await fs.mkdir(outputDir, { recursive: true });

  let config = path.join(evalsDir, "mail.promptfooconfig.yaml");
  if (real) {
    const corrections = path.join(stateRoot, "mail-corrections.json");
    if (!(await exists(corrections))) fail("There is no exported corrections file yet. Run: tsx scripts/evals/export-mail-corrections.ts");
    // The same config, pointed at the owner's data. It sits in evals/output so nothing private is committed.
    const base = await fs.readFile(config, "utf8");
    const swapped = base
      .replace("tests: file://datasets/mail-synthetic.json", `tests: file://${corrections}`)
      .replace("file://providers/mail-classifier.ts", "file://../providers/mail-classifier.ts");
    if (swapped === base) fail("The eval config no longer has the lines this script rewrites for --real.");
    config = path.join(outputDir, "mail-real.promptfooconfig.yaml");
    await fs.writeFile(config, swapped, { encoding: "utf8", mode: 0o600 });
  }

  // The classifier reads the project list and AI settings from these. Empty
  // ones keep real project names out of what is sent, and the eval independent
  // of which AIs are switched on in the app.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-eval-"));
  const outputFile = path.join(outputDir, `${real ? "mail-real" : "mail"}-result.json`);
  await fs.rm(outputFile, { force: true });

  const started = Date.now();
  try {
    await run(
      process.execPath,
      [bin, "eval", "-c", config, "--output", outputFile, "--no-cache", "--no-progress-bar", "--no-share", "--max-concurrency", "2"],
      {
        cwd: evalsDir,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
        env: {
          ...process.env,
          PROMPTFOO_DISABLE_TELEMETRY: "1",
          PROMPTFOO_DISABLE_UPDATE: "1",
          PROMPTFOO_CONFIG_DIR: promptfooDir,
          AGENTOS_ROOT: path.join(scratch, "vault"),
          AGENTOS_UI_DIR: path.join(scratch, "ui"),
        },
      },
    );
  } catch (error) {
    // Promptfoo exits 100 when some cases fail. That is a score, not a crash.
    const code = (error as { code?: number }).code;
    if (code !== 100) {
      const detail = `${(error as { stderr?: string }).stderr ?? ""}`.trim().split("\n").slice(-6).join("\n");
      fail(`The eval did not finish (exit ${String(code)}).\n${detail}`);
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }

  let output: PromptfooOutput;
  try {
    output = JSON.parse(await fs.readFile(outputFile, "utf8")) as PromptfooOutput;
  } catch {
    fail("The eval ran but its result file could not be read.");
  }
  const stats = output.results?.stats ?? {};
  const passed = stats.successes ?? 0;
  const total = passed + (stats.failures ?? 0) + (stats.errors ?? 0);
  if (total === 0) fail("The eval produced no results.");

  const suite = real ? "mail-real" : "mail";
  await appendEvalRun({ at: new Date().toISOString(), suite, commit: await currentCommit(), passed, total });
  const comparison = compareToPrevious(await readEvalHistory(suite));
  console.log(`\nMail triage (${real ? "your corrections" : "synthetic"}): ${passed}/${total} passed in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log(comparison.line);
}

await main();

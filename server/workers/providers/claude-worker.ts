import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerJob, WorkerJobResult } from "../../../shared/worker-types";
import type { Worker, WorkerRunContext } from "../worker";
import { ClaudeStream } from "./claude-events";

/**
 * Claude, as an AgentOS worker.
 *
 * Run through the Agent SDK: one query per job, a stream of typed messages
 * back, no interactive surface. Everything AgentOS-specific — what the job is,
 * where it runs, what counts as done — is decided elsewhere and handed in.
 * This file knows how to start Claude, read it, and stop it, and nothing else.
 *
 * It is the same contract Grok implements, and deliberately the same shape, so
 * that the two can be compared on their work rather than on their plumbing.
 * Four decisions carry the weight:
 *
 * - **AgentOS owns the isolation.** The job manager already made a worktree.
 *   Claude is pointed at it and confined to it, and is denied the git commands
 *   that would let it make another somewhere nobody is looking.
 * - **The environment is not inherited.** This is the sharp edge. A worker
 *   that picked up the operator's own Claude configuration would be running
 *   with their memory, their skills, and their MCP servers — none of which are
 *   part of the job it was given. Every one of those sources is turned off
 *   explicitly below, because the default is to load them.
 * - **The prompt is not the safety mechanism.** Asking a model not to push is
 *   a request. `dontAsk` with an explicit allowlist is a refusal: anything not
 *   named is denied outright rather than waiting for a prompt nobody is there
 *   to answer, and the deny rules hold regardless.
 * - **Nothing it says is taken as fact.** Its closing summary is recorded as a
 *   claim. What changed is read from git, and whether it works is decided by
 *   running the validation commands.
 */

/** A job that has not finished by now is stuck, not slow. */
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;

const DEFAULT_MAX_TURNS = 30;

/** A ceiling on what one job may spend, in dollars. */
const DEFAULT_MAX_BUDGET_USD = 3;

/**
 * What Claude may do, before the job's own validation commands are added.
 *
 * An allowlist rather than a blocklist, because `dontAsk` denies anything not
 * named here. Reading and editing are the job; the git commands are the three
 * that let a worker see what it has done without being able to publish it.
 *
 * Bash rules are given twice — bare and wildcard — on purpose. `Bash(git diff)`
 * matches only the bare command and `Bash(git diff *)` only the form with an
 * argument, so a single rule would silently let one of the two through to a
 * denial mid-job.
 */
const BASE_TOOLS: readonly string[] = [
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  ...bashRules("git status"),
  ...bashRules("git diff"),
  ...bashRules("git log"),
];

/**
 * What Claude may never do, whatever the prompt says.
 *
 * Deny outranks allow, so these hold even though a validation command could
 * otherwise widen the allowlist into them. They are the same refusals Grok
 * runs under: the two workers are not trusted differently.
 */
const DENIED_TOOLS: readonly string[] = [
  // Publishing and history are the operator's, via review. Not a worker's.
  "Bash(git push:*)",
  "Bash(git commit:*)",
  "Bash(git remote:*)",
  "Bash(git reset:*)",
  // A second worktree would put work outside the one being reviewed.
  "Bash(git worktree:*)",
  "Bash(git clean:*)",
  // Destructive and privileged commands have no place in a scoped job.
  "Bash(rm:*)",
  "Bash(sudo:*)",
  // Credentials are not part of any job's context.
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Edit(**/.env)",
];

/**
 * Both forms of one Bash permission rule.
 *
 * `*` is a wildcard rather than a prefix matcher, so the bare command and the
 * command with arguments are two different patterns.
 */
function bashRules(command: string): string[] {
  return [`Bash(${command})`, `Bash(${command} *)`];
}

/**
 * Whether a validation command can safely become a permission rule.
 *
 * A rule is a prefix, so anything that could chain or substitute another
 * command behind that prefix would grant far more than the command itself.
 * Such a command is simply not granted — AgentOS runs the validation itself
 * either way, so the only thing lost is Claude checking its own work.
 */
function isSimpleCommand(command: string): boolean {
  return (
    command.length > 0 &&
    command.length <= 120 &&
    !/[;&|`$(){}<>\n\\'"*?[\]!#~]/.test(command)
  );
}

/**
 * Permission rules for this job's validation commands.
 *
 * Generated rather than hardcoded, so a job in a Gradle or Cargo repository
 * gets the commands it needs without Bash being opened up in general.
 */
export function validationRules(
  commands: readonly string[] | undefined,
): string[] {
  const rules = new Set<string>();

  for (const raw of commands ?? []) {
    const command = raw.trim();
    if (!isSimpleCommand(command)) continue;

    for (const rule of bashRules(command)) rules.add(rule);
  }

  return [...rules];
}

/** Everything Claude is allowed to do on this job. */
export function allowedTools(job: WorkerJob): string[] {
  return [...BASE_TOOLS, ...validationRules(job.validationCommands)];
}

export function deniedTools(): string[] {
  return [...DENIED_TOOLS];
}

function model(): string {
  return process.env.CLAUDE_WORKER_MODEL?.trim() || "sonnet";
}

function boundedNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxTurns(): number {
  return Math.floor(
    boundedNumber(process.env.CLAUDE_WORKER_MAX_TURNS, DEFAULT_MAX_TURNS),
  );
}

function maxBudgetUsd(): number {
  return boundedNumber(
    process.env.CLAUDE_WORKER_MAX_BUDGET_USD,
    DEFAULT_MAX_BUDGET_USD,
  );
}

function jobTimeoutMs(): number {
  return boundedNumber(
    process.env.CLAUDE_WORKER_TIMEOUT_MS,
    DEFAULT_JOB_TIMEOUT_MS,
  );
}

/**
 * Where the worker keeps its own Claude configuration.
 *
 * Deliberately not `~/.claude`. That directory is the operator's, and a worker
 * reading it would inherit a personal setup that has nothing to do with the
 * job — which is exactly the failure this integration exists to avoid.
 */
export function workerConfigDir(): string {
  return (
    process.env.CLAUDE_WORKER_CONFIG_DIR?.trim() ||
    path.join(homedir(), ".agentos-worker", "claude")
  );
}

/**
 * The environment the SDK's process runs in.
 *
 * Setting `env` replaces the child's environment rather than extending it, so
 * `process.env` is spread first — without it the run loses PATH and HOME and
 * fails for reasons that look nothing like the cause.
 */
function isolatedEnvironment(): Record<string, string | undefined> {
  return {
    ...process.env,
    // The worker's own configuration directory, never the operator's.
    CLAUDE_CONFIG_DIR: workerConfigDir(),
    // Project and user memory files are another way personal context arrives.
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: "agentos",
  };
}

/**
 * What is added to Claude Code's own coding prompt.
 *
 * The preset is kept because it is what makes Claude good at this work. What
 * is appended is only what it specifically needs to be told: that it is
 * running unattended, which things are refused rather than discouraged, who
 * decides whether the work is any good, and what to say at the end.
 */
export const WORKER_SYSTEM_PROMPT = `You are an AgentOS implementation worker.

Execute only the worker job you are given, in the checkout you are given.

Do not:
- commit, push, or change git remotes
- create git worktrees
- modify AgentOS state or vault files
- expand the scope of the job

Committing, pushing, and creating worktrees are blocked rather than merely
discouraged. Leave your work uncommitted in the working tree.

AgentOS owns validation: it reads the changed files from git and runs the
validation commands itself. Reporting success does not make a job pass.
Hermes owns review. The operator owns final approval.

When you are finished, reply with a short summary of what you changed and
anything that blocked you. That summary is what a person reads first.`;

/** The brief Claude is actually sent. */
export function buildClaudePrompt(contextPacket: string): string {
  return [
    "AGENTOS WORKER JOB",
    "",
    "You are running unattended as a worker for AgentOS. You have been given",
    "one scoped job in an isolated checkout that exists only for this job.",
    "",
    contextPacket,
  ].join("\n");
}

/**
 * Everything the SDK is told about one run.
 *
 * Built here rather than inline at the call site so that the properties this
 * integration actually depends on can be asserted in a test. The isolation
 * below is the whole reason a worker can be trusted with an unattended run,
 * and an untested claim of isolation is not much of a claim.
 */
export function buildQueryOptions(
  job: WorkerJob,
  worktreePath: string,
  controller: AbortController,
): Options {
  return {
    // Both the working directory and the boundary for this run.
    cwd: worktreePath,

    model: model(),
    maxTurns: maxTurns(),
    maxBudgetUsd: maxBudgetUsd(),
    abortController: controller,

    // Unattended means nothing can wait on a prompt. `dontAsk` denies anything
    // the allowlist does not name, rather than hanging on a question with
    // nobody there to answer it.
    permissionMode: "dontAsk",
    allowedTools: allowedTools(job),
    disallowedTools: deniedTools(),

    // The four sources of inherited context, each turned off explicitly.
    // Every one is loaded by default, and every one would be the operator's
    // rather than the job's:
    //
    // - `settingSources` covers user, project, and local settings files.
    // - `skills` covers everything installed on the machine.
    // - `mcpServers` with `strictMcpConfig` covers external servers, which
    //   would otherwise reach tools this job was never scoped to.
    settingSources: [],
    skills: [],
    mcpServers: {},
    strictMcpConfig: true,

    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: WORKER_SYSTEM_PROMPT,
    },

    env: isolatedEnvironment(),
  };
}

/** Live runs, by job id, so a job can be stopped. */
const controllers = new Map<string, AbortController>();

export const claudeWorker: Worker = {
  id: "claude",
  name: "Claude",
  role: "Implementation — writes code in an isolated checkout",
  capabilities: ["code", "review", "research"],

  /**
   * Whether Claude can be run at all.
   *
   * Checks for a key rather than sending a prompt: health is checked every
   * time the workers screen loads, and a check that ran a query would spend
   * money to answer a question an environment variable already answers.
   *
   * A key is genuinely required here, rather than merely preferred. The run
   * is pointed at its own empty configuration directory, so an operator's
   * existing interactive login is deliberately not visible to it.
   */
  async healthCheck() {
    const key =
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.ANTHROPIC_AUTH_TOKEN?.trim();

    if (!key) {
      return {
        available: false,
        reason:
          "ANTHROPIC_API_KEY is not set. The Claude worker runs in its own configuration directory, so an interactive `claude` login on this machine does not reach it.",
      };
    }

    return { available: true, reason: `Model: ${model()}` };
  },

  async start(
    job: WorkerJob,
    { emit, signal, worktreePath, contextPacket }: WorkerRunContext,
  ): Promise<WorkerJobResult> {
    // Isolation is the whole basis for running this unattended. Without a
    // worktree, Claude would be writing into the operator's live checkout.
    if (!worktreePath) {
      throw new Error(
        "Claude needs an isolated worktree. Give the job a repository so one can be created.",
      );
    }

    const configDir = workerConfigDir();

    // Created rather than assumed: the SDK is being told to use a directory
    // that exists only because AgentOS makes it.
    await mkdir(configDir, { recursive: true });

    const allowed = allowedTools(job);
    const denied = deniedTools();
    const budget = maxBudgetUsd();
    const turns = maxTurns();

    const controller = new AbortController();
    controllers.set(job.id, controller);

    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => controller.abort(), jobTimeoutMs());
    timeout.unref?.();

    emit("job.progress", "Starting Claude", {
      model: model(),
      maxTurns: turns,
      maxBudgetUsd: budget,
      allowedTools: allowed.length,
      deniedTools: denied.length,
      configDir,
    });

    const stream = new ClaudeStream();

    try {
      const messages = query({
        prompt: buildClaudePrompt(contextPacket),
        options: buildQueryOptions(job, worktreePath, controller),
      });

      for await (const message of messages) {
        for (const emission of stream.handleMessage(message)) {
          emit(emission.type, emission.message, emission.metadata);
        }
      }

      if (controller.signal.aborted) throw new Error("Cancelled");

      return finish(stream, worktreePath, budget);
    } catch (error) {
      // A run that stopped at a ceiling AgentOS set is not a broken run, and
      // the SDK is not consistent about which of the two it looks like: it
      // reports the stop as a result, but also throws when the underlying
      // process exits non-zero. The stream already recorded why it stopped, so
      // that is trusted over the shape the ending happened to arrive in.
      //
      // Deliberately narrow. Only the two ceilings this worker itself imposes
      // are treated this way; every other failure, an expired key included,
      // still fails the job.
      if (!controller.signal.aborted && stoppedAtACeiling(stream.stopReason)) {
        return finish(stream, worktreePath, budget);
      }

      if (controller.signal.aborted && !signal.aborted) {
        // Aborted by this worker rather than by the operator: the only thing
        // that does that on its own is the timeout.
        throw new Error(
          `Claude did not finish within ${Math.round(
            jobTimeoutMs() / 60_000,
          )} minutes and was stopped.`,
          { cause: error },
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      controllers.delete(job.id);
    }
  },

  /**
   * Stops a running job.
   *
   * The job manager aborts the run signal for every worker, which already
   * reaches the query. This is here so cancelling works even if that path
   * changes, and it is safe to call for a job that has already gone.
   */
  async cancel(jobId: string): Promise<void> {
    controllers.get(jobId)?.abort();
  },
};

/**
 * Whether the run stopped because it reached a limit AgentOS gave it.
 *
 * These are the job being bounded as designed, not the runner breaking. What
 * was done up to that point is real work, and validation decides whether it
 * stands.
 */
function stoppedAtACeiling(stopReason: string | undefined): boolean {
  return (
    stopReason === "error_max_turns" || stopReason === "error_max_budget_usd"
  );
}

/**
 * What the run amounted to.
 *
 * Everything Claude claims is recorded as a claim: `changedFiles` is left for
 * the job manager to fill from git, and the tests come from AgentOS running
 * the validation commands itself.
 */
function finish(
  stream: ClaudeStream,
  worktreePath: string,
  budgetUsd: number,
): WorkerJobResult {
  const blockers = [...stream.blockers];

  for (const unfinished of stream.unfinishedTools) {
    blockers.push(`${unfinished} never reported finishing.`);
  }

  return {
    summary: stream.summary || "Claude finished without a closing summary.",
    blockers: blockers.length > 0 ? blockers : undefined,
    worktreePath,
    // `provider` names who billed it, which is not the same as which worker
    // ran it: the usage screen groups spend by the account it lands on.
    providerMetrics: { ...stream.metrics, provider: "anthropic", budgetUsd },
  };
}

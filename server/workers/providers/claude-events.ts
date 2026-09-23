import type { WorkerEventType } from "../../../shared/worker-types";

/**
 * Claude's stream, translated.
 *
 * The Agent SDK yields typed `SDKMessage` objects. AgentOS speaks worker
 * events. This module is the whole of the translation, kept apart from the
 * query handling so the mapping can be tested by feeding it messages rather
 * than by spending tokens on a real run.
 *
 * The same two properties that govern the Grok adapter govern this one:
 *
 * - **An unrecognised message never breaks a job.** The SDK's message union is
 *   long and grows; anything not mapped here is ignored rather than thrown on,
 *   and the handful of shapes worth seeing are carried through as progress.
 * - **The log stays readable.** Thinking, partial frames, and the SDK's
 *   internal bookkeeping are dropped. What survives is what a person would
 *   want to read afterwards: what Claude said, what it ran, what it wrote.
 *
 * Messages are read defensively, by shape rather than by cast. The union is
 * wide enough that a version bump changing a field should thin the log, not
 * fail a run.
 */

/** One worker event, before the manager stamps an id and a time on it. */
export interface ClaudeEmission {
  type: WorkerEventType;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * What the run cost, as the SDK counted it.
 *
 * The Agent SDK is the best-instrumented runner AgentOS has: it reports a
 * priced total alongside a full token breakdown, so everything here is the
 * provider's own accounting rather than a reconstruction. That is what lets
 * these records be marked `exact` — and what makes Grok's missing price
 * legible as a real difference rather than as a bug.
 */
export interface ClaudeMetrics {
  costUsd?: number;
  turns?: number;
  sessionId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  measurement?: "exact" | "estimated" | "unknown";
}

/**
 * Ceilings on what one run may write.
 *
 * A worker that loops does not get to fill the disk with its own event log.
 * Generous enough that a normal job never reaches them.
 */
const MAX_TOOL_EVENTS = 500;
const MAX_TEXT_EVENTS = 200;
const MAX_SUMMARY_CHARS = 4_000;

/** How much of one assistant message is worth putting in the timeline. */
const MAX_PROGRESS_CHARS = 300;

/**
 * The SDK's token block, in the metrics vocabulary.
 *
 * Cache creation and cache read are summed into one figure. Anthropic prices
 * them differently, but AgentOS never prices anything itself — it reads the
 * cost the SDK already computed — so keeping them apart would add a
 * distinction that nothing downstream consumes.
 *
 * A result with no usage block leaves `measurement` undefined rather than
 * claiming `exact` over nothing, so a run the SDK did not instrument is
 * reported as unmeasured instead of as free.
 */
function readUsage(value: unknown): Partial<ClaudeMetrics> {
  const usage = asRecord(value);
  if (!usage) return {};

  const cacheRead = asNumber(usage.cache_read_input_tokens);
  const cacheWrite = asNumber(usage.cache_creation_input_tokens);

  const cachedTokens =
    cacheRead === undefined && cacheWrite === undefined
      ? undefined
      : (cacheRead ?? 0) + (cacheWrite ?? 0);

  const inputTokens = asNumber(usage.input_tokens);
  const outputTokens = asNumber(usage.output_tokens);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedTokens === undefined
  ) {
    return {};
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens: asNumber(usage.reasoning_output_tokens),
    totalTokens:
      (inputTokens ?? 0) + (outputTokens ?? 0) + (cachedTokens ?? 0),
    measurement: "exact",
  };
}

/** Tools whose successful use means a file on disk changed. */
const WRITING_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The content blocks of an assistant or user message, however it is shaped. */
function contentBlocks(message: Record<string, unknown>): unknown[] {
  const inner = asRecord(message.message);
  const content = inner?.content;

  return Array.isArray(content) ? content : [];
}

/**
 * A tool call named the way a person would name it.
 *
 * `Bash` on its own says nothing; `Bash: npm run build` says what happened.
 * The detail is taken from the one input field that identifies the call and
 * truncated, because a tool input can be an entire file.
 */
function describeTool(name: string, input: unknown): string {
  const fields = asRecord(input) ?? {};

  const detail =
    asString(fields.command) ??
    asString(fields.file_path) ??
    asString(fields.path) ??
    asString(fields.pattern) ??
    asString(fields.description);

  if (!detail) return name;

  const oneLine = detail.replace(/\s+/g, " ").trim();

  return `${name}: ${
    oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine
  }`;
}

/** A tool call still open, and what it would have written if it succeeds. */
interface OpenTool {
  title: string;
  name: string;
  /** The file it claimed it was writing, for narration only. */
  path?: string;
}

/**
 * One Claude run's stream, folded into worker events.
 *
 * Stateful because the stream is: a tool result carries only the id of the
 * call it answers, so the title that call opened with has to be remembered to
 * write a line a person can read.
 */
export class ClaudeStream {
  /** Open tool calls, by the SDK's tool_use id. */
  private readonly openTools = new Map<string, OpenTool>();
  private readonly text: string[] = [];
  private readonly issues: string[] = [];

  private toolEvents = 0;
  private textEvents = 0;
  private truncated = false;

  private resultText?: string;
  private stopReasonValue?: string;
  private metricsValue: ClaudeMetrics = {};

  /**
   * Claude's own closing words.
   *
   * The SDK's final result carries the closing message directly, which is
   * better than reassembling it from the stream — so that is preferred, and
   * the accumulated text is only a fallback for a run that ended without one.
   *
   * Read as a claim either way. What actually changed comes from git, and
   * whether it works comes from the validation commands.
   */
  get summary(): string {
    const text = this.resultText?.trim() || this.text.join("\n\n").trim();

    return text.slice(0, MAX_SUMMARY_CHARS);
  }

  /** What went wrong, in the SDK's words and Claude's. */
  get blockers(): string[] {
    return [...this.issues];
  }

  /** Why the run ended, when the SDK said. */
  get stopReason(): string | undefined {
    return this.stopReasonValue;
  }

  /** What the run cost, for the job record. */
  get metrics(): ClaudeMetrics {
    return { ...this.metricsValue };
  }

  /** Tool calls never reported as finished when the stream ended. */
  get unfinishedTools(): string[] {
    return [...this.openTools.values()].map((tool) => tool.title);
  }

  /** Reads one message from the SDK's stream. */
  handleMessage(message: unknown): ClaudeEmission[] {
    const record = asRecord(message);
    if (!record) return [];

    switch (record.type) {
      case "assistant":
        return this.assistant(record);

      case "user":
        return this.user(record);

      case "system":
        return this.system(record);

      case "result":
        return this.result(record);

      // Partial frames, status pings, task bookkeeping. Real messages, and
      // none of them say anything about this job that the cases above do not.
      default:
        return [];
    }
  }

  /**
   * What Claude said and what it decided to run.
   *
   * Thinking is dropped: it is long, it is not a record of what happened, and
   * it is not the operator's business. Text and tool calls are kept.
   */
  private assistant(record: Record<string, unknown>): ClaudeEmission[] {
    const emissions: ClaudeEmission[] = [];

    for (const block of contentBlocks(record)) {
      const entry = asRecord(block);
      if (!entry) continue;

      if (entry.type === "text") {
        const text = asString(entry.text)?.trim();
        if (!text) continue;

        this.text.push(text);
        emissions.push(...this.narrate(text));
        continue;
      }

      if (entry.type === "tool_use") {
        const id = asString(entry.id);
        const name = asString(entry.name) ?? "Tool";
        const title = describeTool(name, entry.input);

        if (id) {
          this.openTools.set(id, {
            title,
            name,
            path:
              asString(asRecord(entry.input)?.file_path) ??
              asString(asRecord(entry.input)?.notebook_path),
          });
        }

        emissions.push(
          ...this.tool({
            type: "tool.started",
            message: title,
            metadata: { toolName: name, toolUseId: id },
          }),
        );
      }
    }

    return emissions;
  }

  /**
   * Tool results, which the SDK delivers as a user message.
   *
   * The result content itself is deliberately not logged. It is the whole of
   * a file read or a build's output, and putting that in the timeline would
   * bury the run in its own transcript.
   */
  private user(record: Record<string, unknown>): ClaudeEmission[] {
    const emissions: ClaudeEmission[] = [];

    for (const block of contentBlocks(record)) {
      const entry = asRecord(block);
      if (!entry || entry.type !== "tool_result") continue;

      const id = asString(entry.tool_use_id);
      const open = id ? this.openTools.get(id) : undefined;
      const failed = entry.is_error === true;

      if (id) this.openTools.delete(id);

      const title = open?.title ?? "Tool call";

      emissions.push(
        ...this.tool({
          type: "tool.completed",
          message: failed ? `${title} — failed` : title,
          metadata: { toolUseId: id, status: failed ? "failed" : "completed" },
        }),
      );

      // Narration only. What the job reports as changed is read from git,
      // never from what a worker said it touched.
      if (!failed && open?.path && WRITING_TOOLS.has(open.name)) {
        emissions.push({
          type: "file.changed",
          message: open.path,
          metadata: { path: open.path, reportedBy: "claude" },
        });
      }
    }

    return emissions;
  }

  /**
   * The SDK's own notices.
   *
   * Only two are worth a line. `init` says what the run actually started with,
   * which is the evidence that the isolation held. A denial says a rule
   * refused something, which is the mechanism working — recorded rather than
   * hidden, because a job that quietly did less than asked is worth knowing
   * about when the review comes up short.
   */
  private system(record: Record<string, unknown>): ClaudeEmission[] {
    if (record.subtype === "init") {
      const tools = Array.isArray(record.tools) ? record.tools.length : 0;

      this.metricsValue.sessionId = asString(record.session_id);
      // The run's actual model, which is not necessarily the one configured:
      // an alias like `sonnet` resolves upstream, and the usage screen should
      // report what ran rather than what was asked for.
      this.metricsValue.model = asString(record.model) ?? this.metricsValue.model;

      return [
        {
          type: "job.progress",
          message: "Claude session started",
          metadata: {
            model: asString(record.model),
            tools,
            sessionId: this.metricsValue.sessionId,
            cwd: asString(record.cwd),
          },
        },
      ];
    }

    if (record.subtype === "permission_denied") {
      const tool = asString(record.tool_name) ?? "A tool";
      const reason = asString(record.decision_reason);

      const message = `Refused: ${tool}${reason ? ` — ${reason}` : ""}`;

      this.issues.push(message);

      return [
        {
          type: "job.progress",
          message,
          metadata: {
            toolName: tool,
            decisionReason: asString(record.decision_reason_type),
          },
        },
      ];
    }

    return [];
  }

  /**
   * The turn's outcome.
   *
   * The SDK reports a run that stopped early — a turn limit, a spent budget —
   * as a result rather than as a thrown error, so this is where those are
   * turned into blockers. They are not failures of the run: the work that was
   * done is real, and validation is what decides whether it stands.
   */
  private result(record: Record<string, unknown>): ClaudeEmission[] {
    const subtype = asString(record.subtype);

    this.stopReasonValue = subtype;

    const usage = readUsage(record.usage);
    const model = asString(record.model) ?? this.metricsValue.model;

    this.metricsValue = {
      ...this.metricsValue,
      costUsd: asNumber(record.total_cost_usd),
      turns: asNumber(record.num_turns),
      sessionId: asString(record.session_id) ?? this.metricsValue.sessionId,
      // Spread conditionally rather than assigning `undefined`: a metrics
      // object carrying explicit `undefined` keys reads, to anything comparing
      // records, as a run that reported a model and got nothing.
      ...(model === undefined ? {} : { model }),
      ...usage,
    };

    if (subtype === "success") {
      const text = asString(record.result);

      // `is_error` on a success result means the turn ended on an API error,
      // and `result` carries that error rather than a closing summary.
      if (record.is_error === true) {
        this.issues.push(text ?? "Claude ended the turn on an error.");
      } else {
        this.resultText = text;
      }
    } else {
      for (const error of Array.isArray(record.errors) ? record.errors : []) {
        const detail = asString(error);
        if (detail) this.issues.push(detail);
      }

      this.issues.push(describeStop(subtype));
    }

    // The run being over is not the job being done. Validation has not
    // happened yet, so this is progress — the job manager decides the ending.
    return [
      {
        type: "job.progress",
        message: "Claude finished",
        metadata: {
          stopReason: subtype,
          turns: this.metricsValue.turns,
          costUsd: this.metricsValue.costUsd,
        },
      },
    ];
  }

  /** Assistant text, up to the ceiling. */
  private narrate(text: string): ClaudeEmission[] {
    if (this.textEvents >= MAX_TEXT_EVENTS) return this.noteTruncation();

    this.textEvents += 1;

    return [
      {
        type: "job.progress",
        message:
          text.length > MAX_PROGRESS_CHARS
            ? `${text.slice(0, MAX_PROGRESS_CHARS)}…`
            : text,
      },
    ];
  }

  /** Tool chatter, up to the ceiling. */
  private tool(emission: ClaudeEmission): ClaudeEmission[] {
    if (this.toolEvents >= MAX_TOOL_EVENTS) return this.noteTruncation();

    this.toolEvents += 1;
    return [emission];
  }

  /** Says once that the log stopped recording, rather than silently thinning. */
  private noteTruncation(): ClaudeEmission[] {
    if (this.truncated) return [];

    this.truncated = true;

    return [
      {
        type: "job.progress",
        message:
          "Further Claude events are not being recorded — too many to log",
      },
    ];
  }
}

/** Why a run stopped early, said in a way an operator can act on. */
export function describeStop(subtype: string | undefined): string {
  switch (subtype) {
    case "error_max_turns":
      return "Claude stopped at its turn limit before finishing.";

    case "error_max_budget_usd":
      return "Claude stopped at its cost ceiling before finishing.";

    case "error_during_execution":
      return "Claude stopped on an error during the run.";

    default:
      return `Claude stopped early: ${subtype ?? "unknown"}.`;
  }
}

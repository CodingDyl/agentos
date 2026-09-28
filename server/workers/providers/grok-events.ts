import type {
  WorkerEventType,
  WorkerProviderMetrics,
} from "../../../shared/worker-types";

/**
 * Grok's stream, translated.
 *
 * Grok speaks NDJSON ACP session updates on stdout. AgentOS speaks worker
 * events. This module is the whole of the translation, kept apart from the
 * process handling so the mapping can be tested by feeding it lines rather than
 * by starting a model.
 *
 * Two properties matter more than completeness here:
 *
 * - **An unrecognised line never breaks a job.** Grok's event list is
 *   explicitly non-exhaustive, so anything unknown is carried through as
 *   progress with its raw payload attached, not dropped and not thrown on.
 * - **The log stays readable.** `thought` and `text` arrive one token per line;
 *   turning those into worker events would bury the few lines that say what
 *   actually happened under thousands that do not.
 */

/** One worker event, before the manager stamps an id and a time on it. */
export interface GrokEmission {
  type: WorkerEventType;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ceilings on what one run may write.
 *
 * A worker that loops does not get to fill the disk with its own event log.
 * These are generous enough that a normal job never notices them.
 */
const MAX_TOOL_EVENTS = 500;
const MAX_UNKNOWN_EVENTS = 25;
const MAX_SUMMARY_CHARS = 4_000;

/** Tool kinds that mean a file was written, for live narration of changes. */
const WRITING_KINDS = new Set(["edit", "write", "delete", "move"]);

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

/** File paths a tool call touched, as ACP reports them. */
function locationPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => asString(asRecord(entry)?.path))
    .filter((path): path is string => path !== undefined);
}

/**
 * One Grok run's stream, folded into worker events.
 *
 * Stateful because the stream is: a `tool_call_update` says only that call
 * `call_1` finished, so the title it opened with has to be remembered to write
 * a line a person can read.
 */
export class GrokStream {
  /** Titles of tool calls still open, by ACP tool call id. */
  private readonly openTools = new Map<string, string>();
  private readonly text: string[] = [];
  private readonly issues: string[] = [];

  private toolEvents = 0;
  private unknownEvents = 0;
  private truncated = false;

  private stopReasonValue?: string;
  private usageValue?: Record<string, unknown>;
  private turnCount = 0;
  private inputTokens?: number;
  private outputTokens?: number;

  /**
   * Grok's own closing words.
   *
   * Its summary of what it did — reported as the job's summary, and read as a
   * claim rather than as a finding. What actually changed comes from git, and
   * whether it works comes from the validation commands.
   */
  get summary(): string {
    return this.text.join("").trim().slice(0, MAX_SUMMARY_CHARS);
  }

  /** What Grok said went wrong, in its own words. */
  get blockers(): string[] {
    return [...this.issues];
  }

  /** Why the turn ended: `end_turn`, `max_turns`, `refusal`, and so on. */
  get stopReason(): string | undefined {
    return this.stopReasonValue;
  }

  get usage(): Record<string, unknown> | undefined {
    return this.usageValue;
  }

  /**
   * What the run cost, as far as Grok will say.
   *
   * Grok reports tokens and turns; it does not price them. `costUsd` is
   * therefore left out entirely rather than estimated, so a sprint reading
   * cost across workers can tell "Grok spent nothing" apart from "nobody
   * knows what Grok spent" — which are the two answers that matter, and the
   * two an invented figure would merge.
   */
  get metrics(): WorkerProviderMetrics {
    const measured =
      this.inputTokens !== undefined || this.outputTokens !== undefined;

    return {
      provider: "xai",
      turns: this.turnCount > 0 ? this.turnCount : undefined,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: measured
        ? (this.inputTokens ?? 0) + (this.outputTokens ?? 0)
        : undefined,
      // Grok's own counts when it gave any, and an honest `unknown` when it
      // did not — never `exact` over an empty stream.
      measurement: measured ? "exact" : "unknown",
    };
  }

  /** Tool calls that were never reported as finished when the stream ended. */
  get unfinishedTools(): string[] {
    return [...this.openTools.values()];
  }

  /**
   * Reads one line of Grok's stdout.
   *
   * A line that is not JSON is not an error worth failing a job over — it is
   * kept as progress so it survives in the log, and the run carries on.
   */
  handleLine(line: string): GrokEmission[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return this.unknown("grok emitted a line that was not JSON", {
        raw: trimmed.slice(0, 500),
      });
    }

    return this.handleEvent(parsed);
  }

  /** Reads one already-parsed Grok event. */
  handleEvent(event: unknown): GrokEmission[] {
    const record = asRecord(event);
    if (!record) return [];

    switch (record.type) {
      // Reasoning and answer text stream a token at a time. The answer is kept
      // for the summary; the reasoning is not the operator's business.
      case "text":
        this.text.push(typeof record.data === "string" ? record.data : "");
        return [];

      case "thought":
        return [];

      // Listing every tool and slash command Grok has says nothing about this
      // job, and is long enough to swamp the log on its own.
      case "available_commands":
        return [];

      case "tool_call":
        return this.toolStarted(record);

      case "tool_call_update":
        return this.toolUpdated(record);

      case "plan":
        return this.plan(record);

      // One per model response. Grok says nothing else about where one answer
      // ends and the next begins, so without this the text it wrote before a
      // tool call runs straight into what it wrote after it.
      case "usage":
        // One per model response, which makes counting them the only turn
        // count Grok offers. Any token figures it carries are taken here too,
        // so a run that never reaches `end` still reports what it used.
        this.turnCount += 1;
        this.readUsage(record.usage ?? record);

        if (this.text.length > 0 && !/\s$/.test(this.text.at(-1) ?? "")) {
          this.text.push("\n\n");
        }

        return [];

      case "end":
        this.stopReasonValue = asString(record.stopReason);
        this.usageValue = asRecord(record.usage);
        // A closing total, when there is one, is better evidence than the sum
        // of what streamed — so it replaces rather than adds to it.
        this.readUsage(record.usage);
        return [];

      case "error": {
        const message =
          asString(record.message) ?? "Grok reported an error with no message.";
        this.issues.push(message);

        return [{ type: "job.progress", message: `Grok: ${message}` }];
      }

      case "max_turns_reached": {
        this.issues.push("Grok stopped at its turn limit before finishing.");

        return [
          { type: "job.progress", message: "Grok reached its turn limit" },
        ];
      }

      default:
        return this.unknown(`Grok: ${String(record.type)}`, { raw: record });
    }
  }

  /**
   * Takes whatever token counts a usage payload happens to carry.
   *
   * Defensive because the shape is Grok's, not ours: fields that are not there
   * leave what was already recorded alone, so a payload naming only output
   * tokens cannot erase an input count read a moment earlier.
   */
  private readUsage(value: unknown): void {
    const usage = asRecord(value);
    if (!usage) return;

    this.inputTokens =
      asNumber(usage.input_tokens) ??
      asNumber(usage.inputTokens) ??
      this.inputTokens;

    this.outputTokens =
      asNumber(usage.output_tokens) ??
      asNumber(usage.outputTokens) ??
      this.outputTokens;
  }

  private toolStarted(record: Record<string, unknown>): GrokEmission[] {
    const id = asString(record.toolCallId);
    const title =
      asString(record.title) ?? asString(record.toolName) ?? "Tool call";

    if (id) this.openTools.set(id, title);

    return this.tool({
      type: "tool.started",
      message: title,
      metadata: {
        toolName: record.toolName,
        kind: record.kind,
        toolCallId: id,
      },
    });
  }

  private toolUpdated(record: Record<string, unknown>): GrokEmission[] {
    const status = asString(record.status);

    // Only the boundaries are worth a line; a long tool call can report itself
    // in progress many times over.
    if (status !== "completed" && status !== "failed") return [];

    const id = asString(record.toolCallId);
    const title = (id ? this.openTools.get(id) : undefined) ?? "Tool call";

    if (id) this.openTools.delete(id);

    const emissions = this.tool({
      type: "tool.completed",
      message: status === "failed" ? `${title}: failed` : title,
      metadata: { toolCallId: id, status },
    });

    // Narration only. What the job reports as changed is read from git, never
    // from what a worker said it touched.
    const kind = asString(record.kind);

    if (status === "completed" && (!kind || WRITING_KINDS.has(kind))) {
      for (const path of locationPaths(record.locations)) {
        emissions.push({
          type: "file.changed",
          message: path,
          metadata: { path, reportedBy: "grok" },
        });
      }
    }

    return emissions;
  }

  private plan(record: Record<string, unknown>): GrokEmission[] {
    const entries = Array.isArray(record.entries) ? record.entries : [];

    return [
      {
        type: "job.progress",
        message: `Plan updated: ${entries.length} ${
          entries.length === 1 ? "step" : "steps"
        }`,
        metadata: { entries: entries.length },
      },
    ];
  }

  /** Tool chatter, up to the ceiling. */
  private tool(emission: GrokEmission): GrokEmission[] {
    if (this.toolEvents >= MAX_TOOL_EVENTS) return this.noteTruncation();

    this.toolEvents += 1;
    return [emission];
  }

  /** Something not in Grok's documented set. Kept, with its payload. */
  private unknown(
    message: string,
    metadata: Record<string, unknown>,
  ): GrokEmission[] {
    if (this.unknownEvents >= MAX_UNKNOWN_EVENTS) return this.noteTruncation();

    this.unknownEvents += 1;

    return [
      {
        type: "job.progress",
        message,
        metadata: { provider: "grok", ...metadata },
      },
    ];
  }

  /** Says once that the log stopped recording, rather than silently thinning. */
  private noteTruncation(): GrokEmission[] {
    if (this.truncated) return [];

    this.truncated = true;

    return [
      {
        type: "job.progress",
        message: "Further Grok events are not being recorded (too many to log)",
      },
    ];
  }
}

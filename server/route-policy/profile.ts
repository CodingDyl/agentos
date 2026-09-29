import type {
  ExecutionConstraints,
  RequiredCapability,
  TaskCategory,
  TaskComplexity,
  TaskProfile,
} from "../../shared/route-policy-types";

/**
 * Reading a prepared task into a profile.
 *
 * Deterministic on purpose: explicit metadata first, keyword rules second, and
 * "uncertain" when neither settles it. No model is called here. A routing
 * decision that needs a model to classify every trivial task has spent more
 * than the task is worth; genuinely ambiguous tasks are marked uncertain and
 * the policy sends them to a capable worker rather than guessing.
 */

/** Chars-per-token for English prose. An estimate, never a tokenizer count. */
const CHARS_PER_TOKEN = 4;

/** Output budget when the deliverable gives no better hint. */
const DEFAULT_OUTPUT_TOKENS = 512;
const CODING_OUTPUT_TOKENS = 4096;

export interface TaskProfileInput {
  objective: string;
  /** Supplied material the task works on (notes, a snippet, a document). */
  context?: string;
  contextFiles?: string[];
  repoPath?: string;
  validationCommands?: string[];
  metadata?: {
    category?: TaskCategory;
    complexity?: TaskComplexity;
    capabilities?: RequiredCapability[];
    localOnly?: boolean;
    deadlineMs?: number;
    budgetUsd?: number;
    reviewRequired?: boolean;
    /** Expected deliverable, e.g. a JSON schema forces structured output. */
    deliverable?: "text" | "json" | "code_change";
    outputBudgetTokens?: number;
  };
}

export function estimateTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

const RULES: ReadonlyArray<[TaskCategory, RegExp]> = [
  ["summarisation", /\b(summari[sz]e|summary|tl;?dr|recap|condense|key points|bullets?)\b/i],
  ["extraction", /\b(extract|pull out|list (all )?the (dates|names|tasks|items)|parse|to json|as json)\b/i],
  ["rewriting", /\b(rewrite|rephrase|reword|proofread|polish|make (it|this) (shorter|more (formal|casual|concise)))\b/i],
  ["classification", /\b(classify|categori[sz]e|label|triage|tag (each|these|this))\b/i],
  ["explanation", /\b(explain|what does|walk me through|why does)\b/i],
  ["research", /\b(research|find (out|current|latest)|look up|compare|investigate)\b/i],
  ["coding", /\b(implement|refactor|fix|debug|build|add (a |an )?(feature|endpoint|component|test)|write (a |the )?(function|class|test)|migrate|wire up)\b/i],
];

const REPOSITORY_SIGNALS =
  /\b(repo(sitory)?|codebase|across (this|the) (app|application|codebase|project)|run (its |the |all )?tests?|test suite|pull request|branch|commit)\b/i;
const FILE_WRITE_SIGNALS =
  /\b(modify|edit|change|update|create|write|implement|refactor|fix|delete|rename)\b[^.]{0,60}\b(files?|repo(sitory)?|codebase|code|app|application)\b/i;
const WEB_SIGNALS =
  /\b(current|latest|today'?s|online|on the web|search the web|web ?search|news|price of|as of (now|today))\b/i;
const VISION_SIGNALS = /\b(image|screenshot|photo|picture|diagram|figure)\b/i;
const PLANNING_SIGNALS =
  /\b(architect(ure)?|design the system|plan|strategy|trade-?offs?|end.to.end|whole|entire|redesign|across)\b/i;

const CODE_FENCE = /```|^\s{4}\S/m;

function decideCategory(input: TaskProfileInput): {
  category: TaskCategory;
  matched: boolean;
} {
  if (input.metadata?.category) {
    return { category: input.metadata.category, matched: true };
  }

  // A repository or test run is coding regardless of the other verbs used.
  if (REPOSITORY_SIGNALS.test(input.objective) || input.repoPath) {
    return { category: "coding", matched: true };
  }

  for (const [category, pattern] of RULES) {
    if (pattern.test(input.objective)) return { category, matched: true };
  }

  return { category: "other", matched: false };
}

function decideCapabilities(
  input: TaskProfileInput,
  category: TaskCategory,
): RequiredCapability[] {
  const needs = new Set<RequiredCapability>(["text"]);
  const text = `${input.objective}\n${input.context ?? ""}`;

  for (const capability of input.metadata?.capabilities ?? []) {
    needs.add(capability);
  }

  if (input.repoPath || REPOSITORY_SIGNALS.test(input.objective)) {
    needs.add("repository");
    needs.add("tools");
  }

  if (
    (category === "coding" && (input.repoPath || REPOSITORY_SIGNALS.test(input.objective))) ||
    FILE_WRITE_SIGNALS.test(input.objective)
  ) {
    needs.add("file_writes");
    needs.add("tools");
  }

  if ((input.validationCommands?.length ?? 0) > 0) needs.add("tools");
  if (WEB_SIGNALS.test(input.objective)) needs.add("web");
  if (VISION_SIGNALS.test(text) && /\b(image|screenshot|photo|picture)\b/i.test(text)) {
    needs.add("vision");
  }

  if (
    input.metadata?.deliverable === "json" ||
    category === "extraction" && /\bjson\b/i.test(input.objective)
  ) {
    needs.add("structured_output");
  }

  return [...needs];
}

function decideConstraints(input: TaskProfileInput): ExecutionConstraints {
  const meta = input.metadata ?? {};

  return {
    locality: meta.localOnly ? "local_only" : "cloud_allowed",
    deadlineMs: meta.deadlineMs,
    budgetUsd: meta.budgetUsd,
    // Local output is reviewed like any other; the profile can only add to
    // that, never opt a task out of it.
    reviewRequired: meta.reviewRequired ?? true,
  };
}

export function profileTask(input: TaskProfileInput): TaskProfile {
  const meta = input.metadata ?? {};
  const { category, matched } = decideCategory(input);
  const capabilities = decideCapabilities(input, category);

  const inputTokens = estimateTokens(input.objective) + estimateTokens(input.context);
  const needsTools = capabilities.some((c) =>
    ["tools", "repository", "file_writes", "web"].includes(c),
  );

  const missingInformation: string[] = [];
  const refersToSupplied =
    /\b(these|this|the following|attached|below|above|my)\b[^.]{0,30}\b(notes?|text|email|message|document|transcript|snippet|code|file)\b/i.test(
      input.objective,
    );
  if (
    refersToSupplied &&
    !input.context?.trim() &&
    !(input.contextFiles?.length ?? 0) &&
    !CODE_FENCE.test(input.objective)
  ) {
    missingInformation.push(
      "The task refers to supplied material, but none was provided.",
    );
  }

  let complexity: TaskComplexity;
  let complexityReason: string;

  if (meta.complexity) {
    complexity = meta.complexity;
    complexityReason = "Set explicitly in the task metadata.";
  } else if (needsTools) {
    complexity = "complex";
    complexityReason = `Needs ${capabilities
      .filter((c) => ["tools", "repository", "file_writes", "web"].includes(c))
      .join(", ")}, which a text-only model cannot supply.`;
  } else if (PLANNING_SIGNALS.test(input.objective) && category !== "summarisation") {
    complexity = "complex";
    complexityReason = "Reads as planning or design work spanning multiple concerns.";
  } else if (inputTokens > 6000) {
    complexity = "complex";
    complexityReason = `About ${inputTokens} input tokens (estimated) is a large context.`;
  } else if (inputTokens > 1500 || category === "coding" || category === "research") {
    complexity = "moderate";
    complexityReason =
      inputTokens > 1500
        ? `About ${inputTokens} input tokens (estimated).`
        : `${category} work with no repository or tool access needed.`;
  } else {
    complexity = "simple";
    complexityReason = `Short ${category} task, about ${inputTokens} input tokens (estimated).`;
  }

  const outputBudgetTokens =
    meta.outputBudgetTokens ??
    (meta.deliverable === "code_change" || (category === "coding" && needsTools)
      ? CODING_OUTPUT_TOKENS
      : DEFAULT_OUTPUT_TOKENS);

  const routingUncertain =
    !matched || missingInformation.length > 0 || category === "other";

  const explicit =
    Boolean(meta.category) || Boolean(meta.capabilities?.length) || Boolean(meta.complexity);

  return {
    category,
    complexity,
    complexityReason,
    estimatedInputTokens: inputTokens,
    outputBudgetTokens,
    requiredCapabilities: capabilities,
    constraints: decideConstraints(input),
    missingInformation,
    routingUncertain,
    source: explicit ? (matched && !meta.category ? "mixed" : "metadata") : "rules",
  };
}

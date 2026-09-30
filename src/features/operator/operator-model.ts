import type {
  OperatorMode,
  OperatorRun,
  OperatorRunStatus,
  OperatorRunSummary,
  OperatorStep,
  OperatorStepStatus,
  RequestDomain,
  RunRisk,
} from "@shared/operator-types";

/**
 * Operator's wording, kept out of the components so it can be tested. The
 * rule that matters most: a step AgentOS couldn't do must never read as done,
 * and a run that stopped short must never read as completed.
 */

export const MODES: readonly { value: OperatorMode; label: string; hint: string; action: string }[] = [
  { value: "ask", label: "Ask", hint: "Read-only. Answers from your vault and workspaces; changes nothing.", action: "Ask" },
  { value: "plan", label: "Plan", hint: "Objective, steps, agents, connectors, cost and risks. Nothing runs.", action: "Plan" },
  { value: "run", label: "Run", hint: "Plans, asks you to approve anything that writes, then does it.", action: "Run" },
];

export type Tone = "green" | "flame" | "muted" | "marigold" | "blue";

export function runStatusLabel(status: OperatorRunStatus): string {
  switch (status) {
    case "planning":
      return "Planning";
    case "awaiting_approval":
      return "Needs approval";
    case "running":
      return "Running";
    case "blocked":
      return "Stopped short";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

export function runStatusTone(status: OperatorRunStatus): Tone {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "flame";
    case "awaiting_approval":
    case "blocked":
    case "stopped":
      return "marigold";
    case "planning":
    case "running":
      return "blue";
  }
}

/** Whether Stop applies: anything not yet settled. */
export function isStoppable(status: OperatorRunStatus): boolean {
  return status === "planning" || status === "awaiting_approval" || status === "running";
}

/** The glyph a step's line starts with. Text, so it reads the same to a screen reader as the label beside it. */
export function stepGlyph(status: OperatorStepStatus): string {
  switch (status) {
    case "done":
      return "✓";
    case "running":
      return "●";
    case "pending":
      return "○";
    case "failed":
      return "✕";
    case "blocked":
      return "⊘";
    case "skipped":
      return "–";
    case "stopped":
      return "■";
  }
}

export function stepStatusLabel(status: OperatorStepStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "running":
      return "Running";
    case "pending":
      return "Waiting";
    case "failed":
      return "Failed";
    case "blocked":
      return "Can't run here";
    case "skipped":
      return "Skipped";
    case "stopped":
      return "Stopped";
  }
}

export const RISK_LABEL: Record<RunRisk, string> = {
  read: "Read-only",
  "local-write": "Local writes",
  "external-write": "External writes",
  communication: "Communication",
};

export const DOMAIN_LABEL: Record<RequestDomain, string> = {
  coding: "Coding",
  seo: "SEO",
  business: "Business",
  research: "Research",
  operations: "Operations",
};

export function stepNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** The steps that would change something outside this machine, if approved. What the approval box lists. */
export function pendingExternalSteps(plan: readonly OperatorStep[]): OperatorStep[] {
  return plan.filter((step) => step.external && step.status === "pending");
}

export function stepCounts(plan: readonly OperatorStep[]): { runnable: number; blocked: number; done: number; total: number } {
  return {
    runnable: plan.filter((step) => step.status === "pending" || step.status === "running").length,
    blocked: plan.filter((step) => step.status === "blocked").length,
    done: plan.filter((step) => step.status === "done").length,
    total: plan.length,
  };
}

/**
 * The decisions panel, in the order a person reads them: what it is, where
 * it goes, who builds it, where it lives, how risky, and why.
 */
export function decisionRows(run: OperatorRun): { label: string; value: string }[] {
  const intent = run.intent;
  if (!intent) return [];

  const connectors = new Set(run.connectors);
  const worker = run.plan.find((step) => ["Claude", "Grok", "Worker"].includes(step.actor))?.actor;
  const rows: { label: string; value: string }[] = [
    { label: "Interpreted as", value: intent.interpretedAs },
    { label: "Intent", value: intent.intent },
  ];

  if (intent.workspace) rows.push({ label: "Workspace", value: `${intent.workspace.action === "create" ? "Create" : "Use"} · ${intent.workspace.name}` });
  if (worker) rows.push({ label: "Implementation worker", value: worker === "Worker" ? "Chosen by the route policy" : worker });
  if (connectors.has("github")) rows.push({ label: "Repository", value: "GitHub" });
  if (connectors.has("vercel")) rows.push({ label: "Host", value: "Vercel" });
  if (intent.targetUrl) rows.push({ label: "Site", value: intent.targetUrl });
  rows.push({ label: "Risk", value: RISK_LABEL[intent.risk] });
  rows.push({ label: "Router", value: intent.router === "rules" ? "AgentOS rules" : intent.router === "hermes" ? "Hermes" : "Jev" });
  return rows;
}

export function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Recent runs under Today, Yesterday, then dates. Newest first within each. */
export function groupRunsByDay(runs: readonly OperatorRunSummary[], now: Date = new Date()): { label: string; runs: OperatorRunSummary[] }[] {
  const today = dayKey(now.toISOString());
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday.toISOString());

  const groups = new Map<string, { label: string; runs: OperatorRunSummary[] }>();
  for (const run of [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const key = dayKey(run.startedAt);
    const label =
      key === today
        ? "Today"
        : key === yesterdayKey
          ? "Yesterday"
          : new Date(run.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(run.startedAt).getFullYear() === now.getFullYear() ? undefined : "numeric" });
    const group = groups.get(key) ?? { label, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(from: string, to: string | undefined): string | undefined {
  if (!to) return undefined;
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Whether a link leaves AgentOS. Only http(s) is ever treated as a link at all. */
export function linkKind(href: string | undefined): "internal" | "external" | "none" {
  if (!href) return "none";
  if (href.startsWith("/") && !href.startsWith("//")) return "internal";
  return /^https?:\/\//i.test(href) ? "external" : "none";
}

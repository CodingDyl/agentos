import {
  maxRisk,
  RequestDomainSchema,
  WorkflowIdSchema,
  type DomainScore,
  type OperatorMode,
  type RequestDomain,
  type RouteDecision,
  type RouteWorkspace,
  type WorkflowId,
} from "../../shared/operator-types";
import { toSlug } from "../agentos/mutations/projects";
import { HermesError, sendToHermes } from "../hermes/client";
import { extractJson } from "../hermes/worker-review";
import { runbookFor, type RunbookContext } from "./runbooks";

/**
 * The router answers "what kind of thing is this?" — fast, and nothing more.
 *
 * It does not plan. Domain, risk and which runbook to use are decisions a
 * small, cheap classifier can make; what needs to happen inside the runbook
 * is Hermes' job, later. Keeping the two apart is what lets AgentOS run with
 * no model at all (the rules), with Hermes, or with Jev once it is reachable,
 * without anything downstream noticing which one answered.
 */

export interface RouteRequest {
  input: string;
  mode: OperatorMode;
  /** The workspaces that exist, so "Virtara" can be recognised as one. */
  workspaces: readonly { slug: string; name: string }[];
  projectsRoot?: string;
}

export interface IntentRouter {
  readonly id: RouteDecision["router"];
  route(request: RouteRequest): Promise<RouteDecision>;
}

// ------------------------------------------------------------------ signals

/** Weighted phrases per domain. Multi-word phrases score higher: they are rarer and surer. */
const DOMAIN_SIGNALS: Record<RequestDomain, readonly (readonly [RegExp, number])[]> = {
  coding: [
    [/\b(build|code|implement|refactor|scaffold|prototype)\b/, 2],
    [/\b(app|saas|website|site|landing page|dashboard|component|api|endpoint)\b/, 1],
    [/\b(next\.?js|react|vite|tailwind|typescript|supabase|postgres|node)\b/, 3],
    [/\b(repo|repository|github|git|commit|branch|pull request)\b/, 2],
    [/\b(deploy|deployment|vercel|hosting)\b/, 2],
    [/\b(bug|fix|feature|page|button|form)\b/, 1],
  ],
  seo: [
    [/\bseo\b/, 4],
    [/\b(search console|core web vitals|sitemap|robots\.txt|backlinks?|serp)\b/, 3],
    [/\b(rank|ranking|rankings|keywords?|queries|metadata|meta description|organic|indexing|crawl)\b/, 2],
    [/\b(audit|ga4|analytics|traffic|internal linking)\b/, 1],
  ],
  business: [
    [/\b(business|venture|startup|idea)\b/, 3],
    [/\b(market|customers?|icp|pricing|revenue|traction|experiment|validate|test a saas)\b/, 2],
    [/\b(agents|agencies|clients?|leads?|sell|sales|niche|competitors?)\b/, 1],
  ],
  research: [
    [/\b(research|compare|investigate|find out|explain|summari[sz]e|analy[sz]e)\b/, 2],
    [/^(what|why|how|which|who|when|where|is|are|should|can|could|does|do)\b/, 2],
    [/\?\s*$/, 2],
  ],
  operations: [
    [/\b(connectors?|automations?|workers?|jobs?|usage|budget|cost|tokens|agentos)\b/, 2],
    [/\b(inbox|email|calendar|schedule)\b/, 1],
  ],
};

const STACK_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bnext\.?js\b/i, "Next.js"],
  [/\breact\b/i, "React"],
  [/\bvite\b/i, "Vite"],
  [/\btailwind\b/i, "Tailwind"],
  [/\bsupabase\b/i, "Supabase"],
  [/\bpostgres(ql)?\b/i, "Postgres"],
  [/\bstripe\b/i, "Stripe"],
  [/\bvercel\b/i, "Vercel"],
];

const QUESTION = /^(what|why|how|which|who|when|where|is|are|should|can|could|does|do|tell me|explain)\b/i;
const CREATE = /\b(new|create|build me|start|spin up|set up|launch|make me)\b/i;

// Common TLDs only, so "Next.js" and "robots.txt" are never read as a domain.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/i;
const DOMAIN_PATTERN = /\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|ai|co|site|xyz|store|shop|agency|studio)(?:\.[a-z]{2})?)\b(?!\.)/i;

export function detectStack(input: string): string[] {
  return STACK_WORDS.filter(([pattern]) => pattern.test(input)).map(([, name]) => name);
}

/** A URL the request names, normalised to https. Only http(s) is ever returned. */
export function detectTargetUrl(input: string): string | undefined {
  const explicit = URL_PATTERN.exec(input)?.[0]?.replace(/[.,;:!?]+$/, "");
  if (explicit) return explicit;

  const domain = DOMAIN_PATTERN.exec(input)?.[1];
  return domain ? `https://${domain.toLowerCase()}` : undefined;
}

export function scoreDomains(input: string): DomainScore[] {
  const text = input.toLowerCase();
  const raw = RequestDomainSchema.options.map((domain) => {
    const points = DOMAIN_SIGNALS[domain].reduce((sum, [pattern, weight]) => {
      const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
      return sum + (matches ? Math.min(matches.length, 3) * weight : 0);
    }, 0);
    return { domain, points };
  });

  const total = raw.reduce((sum, entry) => sum + entry.points, 0);
  if (total === 0) {
    return RequestDomainSchema.options
      .map((domain) => ({ domain, score: domain === "research" ? 1 : 0 }))
      .sort((a, b) => b.score - a.score);
  }

  return raw
    .map((entry) => ({ domain: entry.domain, score: Math.round((entry.points / total) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The workspace the request names, by name or slug. The longest match wins: "Pantry Pilot" over "Pantry". */
export function matchWorkspace(input: string, workspaces: RouteRequest["workspaces"]): { slug: string; name: string } | undefined {
  const text = input.toLowerCase();
  let best: { slug: string; name: string; length: number } | undefined;

  for (const workspace of workspaces) {
    for (const candidate of [workspace.name, workspace.slug, workspace.slug.replace(/-/g, " ")]) {
      const needle = candidate.trim().toLowerCase();
      if (needle.length < 3) continue;
      if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(text) && (!best || needle.length > best.length)) {
        best = { slug: workspace.slug, name: workspace.name, length: needle.length };
      }
    }
  }

  return best ? { slug: best.slug, name: best.name } : undefined;
}

/** A name the request gives its new project: `called RankPulse`, `named "EstateContent"`. */
export function extractProjectName(input: string): string | undefined {
  const called = /\b(?:called|named|name it|codename)\s+["“']?([A-Za-z0-9][\w .-]{0,40}?)["”']?(?=[,.;:!?]|\s+(?:on|in|with|using|use|that|which|and|for|to)\b|$)/i.exec(input);
  const quoted = /["“]([A-Za-z0-9][^"”]{1,40})["”]/.exec(input);
  const name = (called?.[1] ?? quoted?.[1])?.trim();
  return name && name.length > 0 ? name : undefined;
}

function workflowFor(input: string, mode: OperatorMode, top: RequestDomain, matched: boolean): WorkflowId {
  if (mode === "ask") return "question";

  const text = input.trim();
  const creating = CREATE.test(text);
  if (QUESTION.test(text) && !creating) return "question";

  // Naming an existing workspace, without asking for something new, is work
  // on it: "add a pricing page to Pantry Pilot" is a task, not a venture.
  if (matched && !creating) {
    if (top === "seo" && /\b(seo|audit)\b/i.test(text)) return "seo-audit";
    if (top === "business" && /\b(idea|venture|test a)\b/i.test(text)) return "business-venture";
    return "existing-project-task";
  }

  switch (top) {
    case "seo":
      return "seo-audit";
    case "business":
      return "business-venture";
    case "coding":
      return matched && !/\b(new|build me)\b/i.test(text) ? "existing-project-task" : "new-code-project";
    default:
      return "question";
  }
}

function workspaceFor(workflow: WorkflowId, input: string, matched: { slug: string; name: string } | undefined): RouteWorkspace | undefined {
  const creates = workflow === "new-code-project" || workflow === "business-venture";

  if (creates) {
    const name = extractProjectName(input);
    // The request names an existing workspace, and no new name: build there.
    if (!name && matched) return { action: "use", ...matched };
    if (!name) return undefined;
    if (matched && toSlug(name) === matched.slug) return { action: "use", ...matched };
    return { action: "create", slug: toSlug(name) || "new-project", name };
  }

  return matched ? { action: "use", ...matched } : undefined;
}

function whyFor(workflow: WorkflowId, input: string, stack: string[], workspace: RouteWorkspace | undefined, targetUrl: string | undefined): string {
  const text = input.toLowerCase();
  const mentions = [
    ...stack,
    ...(/\bgithub|repo(sitory)?\b/.test(text) ? ["a GitHub repository"] : []),
    ...(/\bdeploy|vercel|hosted?\b/.test(text) ? ["a hosted deployment"] : []),
  ];
  const where = workspace ? ` Workspace: ${workspace.action === "use" ? `${workspace.name} (existing)` : `${workspace.name} (new)`}.` : "";

  switch (workflow) {
    case "new-code-project":
      return `The request asks for a new piece of software${mentions.length > 0 ? `, naming ${[...new Set(mentions)].join(", ")}` : ""}.${where}`;
    case "seo-audit":
      return `The request is about search performance${targetUrl ? ` of ${targetUrl}` : ""}, and asks for work to come out of it.${where}`;
    case "business-venture":
      return `The request describes a business idea to test, not a finished spec to build.${where}`;
    case "existing-project-task":
      return `The request names an existing workspace and a change to make in it.${where}`;
    case "question":
      return `The request asks for an answer, not a change. Read-only.${where}`;
  }
}

/** Everything a router decides beyond domain and workflow is derived the same way, whoever answered. */
export function completeDecision(
  request: RouteRequest,
  partial: { router: RouteDecision["router"]; domainScores: DomainScore[]; workflow: WorkflowId; workspace?: RouteWorkspace; why?: string },
): RouteDecision {
  const runbook = runbookFor(partial.workflow);
  const stack = detectStack(request.input);
  const targetUrl = detectTargetUrl(request.input);
  const context: RunbookContext = { workspace: partial.workspace, targetUrl, projectsRoot: request.projectsRoot, stack };
  const steps = runbook.steps(context);

  return {
    router: partial.router,
    domain: partial.domainScores[0]?.domain ?? "research",
    domainScores: partial.domainScores,
    intent: runbook.intent,
    interpretedAs: runbook.interpretedAs,
    risk: maxRisk(steps.map((entry) => entry.risk)),
    workflow: partial.workflow,
    workspace: partial.workspace,
    requiredCapabilities: [...new Set(steps.flatMap((entry) => (entry.capabilityId ? [entry.capabilityId] : [])))],
    targetUrl,
    why: partial.why ?? whyFor(partial.workflow, request.input, stack, partial.workspace, targetUrl),
  };
}

// ------------------------------------------------------------------ routers

/** Deterministic, instant, free. The default, and every other router's fallback. */
export class RuleBasedRouter implements IntentRouter {
  readonly id = "rules" as const;

  async route(request: RouteRequest): Promise<RouteDecision> {
    const domainScores = scoreDomains(request.input);
    const matched = matchWorkspace(request.input, request.workspaces);
    const top = domainScores[0]?.domain ?? "research";
    const workflow = workflowFor(request.input, request.mode, top, matched !== undefined);

    return completeDecision(request, {
      router: this.id,
      domainScores,
      workflow,
      workspace: workspaceFor(workflow, request.input, matched),
    });
  }
}

/**
 * Hermes as the classifier. Slower and not free, so opt-in
 * (`AGENTOS_OPERATOR_ROUTER=hermes`). Any failure, or an answer outside the
 * vocabulary, falls back to the rules and says so in `why`.
 */
export class HermesRouter implements IntentRouter {
  readonly id = "hermes" as const;

  constructor(private readonly fallback: IntentRouter = new RuleBasedRouter()) {}

  async route(request: RouteRequest): Promise<RouteDecision> {
    let reply: string;
    try {
      reply = await sendToHermes(
        [
          "Classify this request. Do not plan it.",
          "",
          "--- REQUEST ---",
          request.input,
          "",
          `Known workspaces: ${request.workspaces.map((workspace) => workspace.name).join(", ") || "none"}`,
        ].join("\n"),
        {
          operation: "routing",
          timeoutMs: 30_000,
          system: [
            "Reply with one JSON object and nothing else:",
            `{ "domains": { ${RequestDomainSchema.options.map((domain) => `"${domain}": 0.0`).join(", ")} },`,
            `  "workflow": one of ${WorkflowIdSchema.options.map((id) => `"${id}"`).join(", ")},`,
            '  "workspace": the exact name of a known workspace the request is about, or null,',
            '  "newName": the name of a new project the request asks to create, or null }',
          ].join("\n"),
        },
      );
    } catch (error) {
      return this.fallBack(request, error instanceof HermesError ? error.message : "Hermes could not be reached.");
    }

    const payload = extractJson(reply) as Record<string, unknown> | undefined;
    const workflow = WorkflowIdSchema.safeParse(payload?.workflow);
    const domains = payload?.domains && typeof payload.domains === "object" ? (payload.domains as Record<string, unknown>) : undefined;
    if (!workflow.success || !domains) return this.fallBack(request, "Hermes answered outside the routing vocabulary.");

    const scores = RequestDomainSchema.options.map((domain) => ({ domain, raw: Math.max(0, Number(domains[domain]) || 0) }));
    const total = scores.reduce((sum, entry) => sum + entry.raw, 0);
    if (total === 0) return this.fallBack(request, "Hermes gave no domain scores.");

    const domainScores = scores
      .map((entry) => ({ domain: entry.domain, score: Math.round((entry.raw / total) * 100) / 100 }))
      .sort((a, b) => b.score - a.score);

    // Ask mode is a permission, not a suggestion: Hermes can't widen it.
    const chosen = request.mode === "ask" ? "question" : workflow.data;
    const named = typeof payload?.workspace === "string" ? matchWorkspace(payload.workspace, request.workspaces) : undefined;
    const matched = named ?? matchWorkspace(request.input, request.workspaces);
    const newName = typeof payload?.newName === "string" && payload.newName.trim() ? payload.newName.trim().slice(0, 60) : undefined;
    const workspace =
      (chosen === "new-code-project" || chosen === "business-venture") && newName && toSlug(newName) !== matched?.slug
        ? { action: "create" as const, slug: toSlug(newName) || "new-project", name: newName }
        : workspaceFor(chosen, request.input, matched);

    return completeDecision(request, { router: this.id, domainScores, workflow: chosen, workspace });
  }

  private async fallBack(request: RouteRequest, reason: string): Promise<RouteDecision> {
    const decision = await this.fallback.route(request);
    return { ...decision, why: `${decision.why} (Routed by rules: ${reason})` };
  }
}

/** Which router answers. Jev slots in here once it is reachable; nothing else changes. */
export function resolveIntentRouter(env: NodeJS.ProcessEnv = process.env): IntentRouter {
  return env.AGENTOS_OPERATOR_ROUTER?.trim().toLowerCase() === "hermes" ? new HermesRouter() : new RuleBasedRouter();
}

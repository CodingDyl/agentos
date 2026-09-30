import type { ConnectorRecommendation, ConnectorStatus } from "../../shared/connector-types";
import type { WorkspaceType } from "../../shared/workspace";

/**
 * Which connectors are worth adding, and why — about the actual work.
 *
 * Deterministic: a few rules over what the vault already says (open task
 * titles, SEO audits, a linked Vercel project, the workspace type). No model
 * call. A marketplace of everything that exists is not a recommendation; "you
 * have SEO tasks but no search data" is.
 */

export interface ProjectSignals {
  slug: string;
  name: string;
  workspaceType?: WorkspaceType;
  /** Open task titles only. */
  openTasks: string[];
  seoAuditCount: number;
  hasVercelProject: boolean;
}

export interface ConnectorState {
  id: string;
  name: string;
  icon: string;
  status: ConnectorStatus;
}

const SEO = /\b(seo|search console|organic|rank(?:ing|ings)?|keywords?|sitemap|meta (?:titles?|descriptions?)|backlinks?|serp)\b/i;
const PAYMENTS = /\b(stripe|pricing|billing|checkout|payments?|subscriptions?|invoic(?:e|es|ing)|revenue)\b/i;
const DATABASE = /\b(supabase|postgres(?:ql)?|database|migrations?|schema|rls)\b/i;
const ERRORS = /\b(bugs?|errors?|crash(?:es)?|exceptions?|sentry|500s?)\b/i;
const ANALYTICS = /\b(analytics|traffic|conversions?|funnels?|retention|activation|onboarding|posthog|ga4)\b/i;
const DESIGN = /\b(figma|mockups?|wireframes?|design system)\b/i;

/** At most this many per page: a list longer than this stops being advice. */
export const RECOMMENDATION_LIMIT = 6;

function count(tasks: string[], pattern: RegExp): number {
  return tasks.filter((task) => pattern.test(task)).length;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function verb(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

const PRODUCTISH = new Set<WorkspaceType | undefined>(["product", "software", "business", "client"]);

export function recommendConnectors(
  projects: readonly ProjectSignals[],
  connectors: readonly ConnectorState[],
): ConnectorRecommendation[] {
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  const out: { recommendation: ConnectorRecommendation; weight: number }[] = [];
  const seen = new Set<string>();

  const add = (connectorId: string, project: ProjectSignals, why: string, weight: number) => {
    const connector = byId.get(connectorId);
    // Already connected means already answered; only suggest what's missing.
    if (!connector || connector.status === "connected") return;
    const key = `${connectorId}:${project.slug}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      recommendation: {
        connectorId,
        connectorName: connector.name,
        icon: connector.icon,
        status: connector.status,
        projectSlug: project.slug,
        projectName: project.name,
        why,
      },
      weight,
    });
  };

  for (const project of projects) {
    const tasks = project.openTasks;
    const seoTasks = count(tasks, SEO);
    const deployed = project.hasVercelProject;

    if (seoTasks > 0 || project.seoAuditCount > 0) {
      const evidence =
        seoTasks > 0
          ? `You have ${plural(seoTasks, "open SEO task")}`
          : `You have run ${plural(project.seoAuditCount, "SEO audit")}`;
      add("search-console", project, `${evidence} but no search-performance data connected. AgentOS can't see impressions, clicks or rankings.`, 10 + seoTasks);
      if (deployed) {
        add("ga4", project, `${evidence} and a live site, but no traffic data: AgentOS can't tell which landing pages bring people in.`, 6 + seoTasks);
      }
    }

    if (deployed && project.workspaceType === "product") {
      add("posthog", project, `AgentOS currently has no product usage data for ${project.name}.`, 8);
    }

    const errorTasks = count(tasks, ERRORS);
    if (deployed && (errorTasks > 0 || project.workspaceType === "product")) {
      add(
        "sentry",
        project,
        errorTasks > 0
          ? `${plural(errorTasks, "open task")} ${verb(errorTasks, "mentions", "mention")} bugs or errors, and AgentOS has no error data for the live site.`
          : `${project.name} is deployed, but AgentOS can't see its errors or connect them to a release.`,
        errorTasks > 0 ? 9 : 5,
      );
    }

    const analyticsTasks = count(tasks, ANALYTICS);
    if (analyticsTasks > 0 && PRODUCTISH.has(project.workspaceType)) {
      add("posthog", project, `${plural(analyticsTasks, "open task")} ${verb(analyticsTasks, "is", "are")} about usage or conversion, with no product analytics connected.`, 7 + analyticsTasks);
    }

    const paymentTasks = count(tasks, PAYMENTS);
    if (paymentTasks > 0) {
      add("stripe", project, `${plural(paymentTasks, "open task")} ${verb(paymentTasks, "involves", "involve")} pricing or payments, and AgentOS can't see revenue.`, 6 + paymentTasks);
    }

    const databaseTasks = count(tasks, DATABASE);
    if (databaseTasks > 0) {
      add("supabase", project, `${plural(databaseTasks, "open task")} ${verb(databaseTasks, "touches", "touch")} the database, which AgentOS can't read.`, 4 + databaseTasks);
    }

    const designTasks = count(tasks, DESIGN);
    if (designTasks > 0) {
      add("figma", project, `${plural(designTasks, "open task")} ${verb(designTasks, "references", "reference")} design files AgentOS can't open.`, 2 + designTasks);
    }

    if (deployed) {
      add("vercel", project, `${project.name} is linked to a Vercel project, but Vercel isn't connected, so deployments can't be read.`, 12);
    }
  }

  return out
    .sort((a, b) => b.weight - a.weight || a.recommendation.connectorName.localeCompare(b.recommendation.connectorName))
    .slice(0, RECOMMENDATION_LIMIT)
    .map((entry) => entry.recommendation);
}

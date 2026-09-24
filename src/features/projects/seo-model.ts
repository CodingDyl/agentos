import type { SeoCategory, SeoFinding, SeoSeverity } from "@shared/seo-types";

/**
 * Vocabulary for SEO findings: how a severity and a category read, and how
 * a run's findings are grouped for display. The audit itself never assigns
 * a "score" — severity and category are the only two axes it commits to.
 */

export const SEVERITY_LABELS: Record<SeoSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/** The small status dot next to each severity — same idiom as roadmap task status. */
export const SEVERITY_DOT: Record<SeoSeverity, string> = {
  critical: "bg-os-danger",
  warning: "bg-os-warning",
  info: "bg-os-subtle",
};

export const SEVERITY_TEXT: Record<SeoSeverity, string> = {
  critical: "text-os-danger",
  warning: "text-os-warning",
  info: "text-os-subtle",
};

/** Display order: worst first. */
export const SEVERITY_ORDER: readonly SeoSeverity[] = ["critical", "warning", "info"];

export const CATEGORY_LABELS: Record<SeoCategory, string> = {
  technical: "Technical",
  "on-page": "On-page",
  schema: "Structured data",
  links: "Links",
};

/** Findings grouped by severity, worst first, each group already in a stable order. */
export function groupBySeverity(findings: readonly SeoFinding[]): { severity: SeoSeverity; findings: SeoFinding[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0);
}

import type { ProjectSite, SiteEmbed } from "../../shared/vercel-types";
import { getVercelDeployments, getVercelProjectDomains, primaryDomain } from "./client";

/**
 * A workspace's live site: the production URL, the deployment behind it, and
 * whether the site will draw inside an AgentOS frame.
 *
 * The Vercel half is the same read-only `GET`s as `client.ts`. The embed check
 * is one `GET` to the site itself — the only way to know before framing it
 * whether the site forbids it, since a refused frame just renders blank.
 */

const EMBED_CHECK_TIMEOUT_MS = 8_000;

/** Vercel's word for a deployment that is serving traffic. */
const READY = "READY";

export async function readProjectSite(projectId: string, projectName: string): Promise<ProjectSite> {
  const [domains, production] = await Promise.all([
    getVercelProjectDomains(projectId),
    getVercelDeployments(projectId, 10, "production"),
  ]);

  const domain = primaryDomain(domains);
  const latest = production[0];
  const serving = production.find((deployment) => deployment.state === READY);

  const url = domain ? `https://${domain}` : serving ? `https://${serving.url}` : undefined;

  return {
    status: "linked",
    projectId,
    projectName,
    url,
    urlSource: domain ? "domain" : serving ? "deployment" : undefined,
    domains,
    production: latest,
    serving,
    embed: url ? await checkEmbed(url) : undefined,
    checkedAt: new Date().toISOString(),
  };
}

/** Undefined when the site could not be reached: the frame is still tried, and will show why itself. */
async function checkEmbed(url: string): Promise<SiteEmbed | undefined> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(EMBED_CHECK_TIMEOUT_MS),
    });
    // Only the headers matter; don't hold the body open.
    void response.body?.cancel();
    return embedVerdict(response.status, response.url, response.headers);
  } catch {
    return undefined;
  }
}

/**
 * Whether a response may be framed by AgentOS, which runs on localhost.
 *
 * `frame-ancestors` wins over `X-Frame-Options` when both are sent, as it
 * does in browsers. A source list that names hosts is treated as refusing,
 * since it will not name localhost.
 */
export function embedVerdict(status: number, finalUrl: string, headers: Headers): SiteEmbed {
  if (status === 401 || /(^|\.)vercel\.com\/sso|\/sso-api/.test(finalUrl)) {
    return {
      allowed: false,
      reason: "Vercel Deployment Protection asks for a login before showing this site.",
    };
  }

  const ancestors = frameAncestors(headers.get("content-security-policy"));
  if (ancestors) {
    if (ancestors.includes("*")) return { allowed: true };
    if (ancestors.includes("'none'")) {
      return { allowed: false, reason: "The site's Content-Security-Policy sets frame-ancestors 'none'." };
    }
    const named = ancestors.filter((source) => source !== "'self'");
    return {
      allowed: false,
      reason: named.length
        ? `The site only allows framing by ${named.join(", ")}.`
        : "The site's Content-Security-Policy only allows framing by itself.",
    };
  }

  const xfo = headers.get("x-frame-options")?.trim().toUpperCase();
  if (xfo === "DENY" || xfo === "SAMEORIGIN") {
    return { allowed: false, reason: `The site sends X-Frame-Options: ${xfo}.` };
  }

  return { allowed: true };
}

function frameAncestors(csp: string | null): string[] | undefined {
  if (!csp) return undefined;
  const directive = csp
    .split(/[;,]/)
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return undefined;
  return directive.split(/\s+/).slice(1).map((source) => source.toLowerCase());
}


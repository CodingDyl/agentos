import type { LinkedProjectSite } from "@shared/vercel-types";
import type { IndicatorTone } from "@/components/paper";

/**
 * The Site tab's words for Vercel's deployment states. Vercel says READY,
 * ERROR, BUILDING; the operator reads Ready, Failed, Building — and never a
 * colour alone, since the indicator always carries the word.
 */
export interface DeploymentHealth {
  label: string;
  tone: IndicatorTone;
  /** Still moving: the tab re-reads until it settles. */
  pending: boolean;
}

export function deploymentHealth(state: string | undefined): DeploymentHealth {
  switch (state) {
    case "READY":
      return { label: "Ready", tone: "green", pending: false };
    case "ERROR":
      return { label: "Failed", tone: "flame", pending: false };
    case "BUILDING":
    case "INITIALIZING":
      return { label: "Building", tone: "amber", pending: true };
    case "QUEUED":
      return { label: "Queued", tone: "amber", pending: true };
    case "CANCELED":
      return { label: "Canceled", tone: "muted", pending: false };
    case undefined:
      return { label: "Not deployed", tone: "muted", pending: false };
    default:
      return { label: state.charAt(0) + state.slice(1).toLowerCase(), tone: "muted", pending: false };
  }
}

/** `https://chef.app/` → `chef.app`. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * When the newest production deploy isn't the one serving — it failed, or is
 * still building — the URL shows an older one. Says so, rather than letting
 * "Failed" read as "the site is down".
 */
export function servingNote(site: LinkedProjectSite, relative: (iso: string) => string | undefined): string | undefined {
  const { production, serving } = site;
  if (!production || production.id === serving?.id) return undefined;
  if (!serving) return "Nothing is serving yet: no production deploy has finished.";
  const when = relative(serving.createdAt);
  return `The site still serves the previous deploy${when ? ` from ${when}` : ""}.`;
}

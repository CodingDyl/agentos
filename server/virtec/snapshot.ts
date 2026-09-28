import type { VirtecSnapshot, VirtecSource, VirtecSourceStatus } from "../../shared/virtec-types";
import { getVirtec, isVirtecConfigured, VIRTEC_PATHS, virtecBaseUrl, virtecConfigurationProblem, VirtecError } from "./client";
import {
  normaliseClients,
  normaliseFollowUps,
  normaliseLeads,
  normaliseProjects,
  normaliseQuotes,
  normaliseRevenue,
} from "./normalise";

/**
 * Everything Traction reads from Virtec, fetched together and cached.
 *
 * Five minutes, because Traction is polled from every screen (the sidebar
 * badge) and Virtec is a production system that owes AgentOS nothing. The
 * numbers it holds — quotes, invoices, follow-ups — move on a scale of hours.
 * The Refresh button asks for a fresh read when it matters.
 *
 * Each endpoint is settled on its own. A failing `quotes` read degrades the
 * quotes section and says so; it does not cost the follow-ups.
 */

const CACHE_MS = 5 * 60_000;

let cached: { at: number; snapshot: VirtecSnapshot } | undefined;
let inflight: Promise<VirtecSnapshot> | undefined;

function failure(error: unknown): VirtecSourceStatus {
  return { ok: false, error: error instanceof VirtecError ? error.message : "Virtec's answer could not be read.", skipped: 0 };
}

/**
 * One line per problem, in the server terminal.
 *
 * Each names the endpoint, the HTTP status when there was one, and the
 * reason — never the key, never a response body. A line is printed when it
 * changes, not on every read: a failed read is not cached, so a broken Virtec
 * is retried on every poll and would otherwise print the same six lines a
 * minute.
 */
const lastLogged = new Map<string, string>();

function logOnce(topic: string, line: string, write: (line: string) => void = console.log): void {
  if (lastLogged.get(topic) === line) return;
  lastLogged.set(topic, line);
  write(line);
}

/** Said once when Virtec is half-configured — both unset means it is simply not in use. */
function logConfiguration(): void {
  const partlySet = Boolean(process.env.VIRTEC_BASE_URL?.trim() || process.env.VIRTEC_API_KEY?.trim());
  if (partlySet) logOnce("configuration", `[agentos] virtec: not configured — ${virtecConfigurationProblem() ?? "unknown reason"}`);
}

async function read(fetcher: typeof fetch): Promise<VirtecSnapshot> {
  if (!isVirtecConfigured()) {
    logConfiguration();
    return { configured: false, leads: [], clients: [], quotes: [], projects: [], followUps: [] };
  }

  const started = Date.now();

  const settle = async <T>(source: VirtecSource, load: () => Promise<{ items: T; skipped: number }>) => {
    try {
      const { items, skipped } = await load();
      lastLogged.delete(source); // recovered: the next failure is news again
      return { source, items, status: { ok: true, skipped } as VirtecSourceStatus };
    } catch (error) {
      if (error instanceof VirtecError) {
        logOnce(source, `[agentos] virtec ${source}: ${error.status ? `HTTP ${error.status} — ` : ""}${error.message}`, console.error);
      } else {
        // A payload Virtec changed the shape of. The error is ours (a parse),
        // so it carries no credential.
        console.error(`[agentos] virtec ${source} could not be read:`, error);
      }
      return { source, items: undefined, status: failure(error) };
    }
  };

  const [leads, clients, quotes, projects, followUps, revenue] = await Promise.all([
    settle("leads", async () => normaliseLeads(await getVirtec(VIRTEC_PATHS.leads, fetcher))),
    settle("clients", async () => normaliseClients(await getVirtec(VIRTEC_PATHS.clients, fetcher))),
    settle("quotes", async () => normaliseQuotes(await getVirtec(VIRTEC_PATHS.quotes, fetcher))),
    settle("projects", async () => normaliseProjects(await getVirtec(VIRTEC_PATHS.projects, fetcher))),
    settle("followUps", async () => normaliseFollowUps(await getVirtec(VIRTEC_PATHS.followUps, fetcher))),
    settle("revenue", async () => ({ items: normaliseRevenue(await getVirtec(VIRTEC_PATHS.revenue, fetcher)), skipped: 0 })),
  ]);

  const results = [leads, clients, quotes, projects, followUps, revenue];
  const ok = results.filter((result) => result.status.ok).length;
  const skipped = results.reduce((sum, result) => sum + result.status.skipped, 0);
  // Where it went and how it went — host only, never a path with a key or a query.
  const summary = `[agentos] virtec: ${ok}/6 sources read from ${virtecBaseUrl()?.host ?? "?"}` + (skipped > 0 ? ` (${skipped} unreadable records skipped)` : "");
  // Timing is left out of the comparison, so an unchanged outcome is not reprinted.
  if (lastLogged.get("summary") !== summary) {
    lastLogged.set("summary", summary);
    console.log(`${summary} in ${Date.now() - started}ms`);
  }

  return {
    configured: true,
    fetchedAt: new Date().toISOString(),
    sources: {
      leads: leads.status,
      clients: clients.status,
      quotes: quotes.status,
      projects: projects.status,
      followUps: followUps.status,
      revenue: revenue.status,
    },
    leads: leads.items ?? [],
    clients: clients.items ?? [],
    quotes: quotes.items ?? [],
    projects: projects.items ?? [],
    followUps: followUps.items ?? [],
    revenue: revenue.items,
  };
}

/**
 * The snapshot, from cache when it is fresh.
 *
 * Concurrent callers share one read. A snapshot where every source failed is
 * not cached, so a Virtec that was briefly down is retried on the next read
 * rather than reported as down for five minutes.
 */
export async function getVirtecSnapshot(options: { fresh?: boolean; fetcher?: typeof fetch } = {}): Promise<VirtecSnapshot> {
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.snapshot;
  if (inflight) return inflight;

  inflight = read(options.fetcher ?? fetch)
    .then((snapshot) => {
      const anyOk = Object.values(snapshot.sources ?? {}).some((status) => status.ok);
      if (snapshot.configured && anyOk) cached = { at: Date.now(), snapshot };
      else cached = undefined;
      return snapshot;
    })
    .finally(() => {
      inflight = undefined;
    });

  return inflight;
}

/** For tests, and for when the configuration changes. */
export function clearVirtecCache(): void {
  cached = undefined;
}

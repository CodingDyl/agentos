import type { VirtecSnapshot, VirtecSource, VirtecSourceStatus } from "../../shared/virtec-types";
import { getVirtec, isVirtecConfigured, VIRTEC_PATHS, VirtecError } from "./client";
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

async function read(fetcher: typeof fetch): Promise<VirtecSnapshot> {
  if (!isVirtecConfigured()) {
    return { configured: false, leads: [], clients: [], quotes: [], projects: [], followUps: [] };
  }

  const settle = async <T>(source: VirtecSource, load: () => Promise<{ items: T; skipped: number }>) => {
    try {
      const { items, skipped } = await load();
      return { source, items, status: { ok: true, skipped } as VirtecSourceStatus };
    } catch (error) {
      if (!(error instanceof VirtecError)) console.error(`[agentos] virtec ${source} could not be read:`, error);
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

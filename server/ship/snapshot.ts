import { GITHUB_SETUP_HINT, VERCEL_SETUP_HINT, type ShipLiveState, type ShipSnapshot } from "../../shared/ship-types";
import { devServerState } from "../dev-server/routes";
import { isVercelConfigured } from "../vercel/client";
import { readProjectSite } from "../vercel/site";
import { listShipChanges } from "./changes";
import { readShipDeploy } from "./deploy";
import { readShipGit, resolveGithubToken } from "./git";
import { linkedVercel } from "./production-gate";
import { requireKnownProject, resolveShipRoot } from "./root";

async function readLive(slug: string): Promise<ShipLiveState> {
  const linked = await linkedVercel(slug);
  if (!linked) return { health: "Not linked" };
  if (!isVercelConfigured()) return { health: "Vercel token missing" };
  try {
    const site = await readProjectSite(linked.id, linked.name);
    if (site.status !== "linked") return { health: site.status };
    return { url: site.url, health: site.production?.state, embedAllowed: site.embed?.allowed, embedReason: site.embed?.reason };
  } catch {
    return { health: "The live site could not be read." };
  }
}

/** Everything the panel shows, in one read. The dev server is the Dev tab's, for Ship's folder. */
export async function readShipSnapshot(slug: string): Promise<ShipSnapshot> {
  await requireKnownProject(slug);
  const folder = await resolveShipRoot(slug).catch(() => undefined);
  const [git, dev, deploy, live, changes, github] = await Promise.all([
    readShipGit(slug),
    devServerState(slug, folder, folder ? undefined : "This workspace has no project folder yet."),
    readShipDeploy(slug),
    readLive(slug),
    listShipChanges(slug),
    resolveGithubToken(),
  ]);
  return {
    slug,
    git,
    dev,
    deploy,
    live,
    changes,
    auth: { github: Boolean(github), vercel: isVercelConfigured(), githubHint: GITHUB_SETUP_HINT, vercelHint: VERCEL_SETUP_HINT },
  };
}

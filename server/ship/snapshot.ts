import { GITHUB_SETUP_HINT, VERCEL_SETUP_HINT, type ShipLiveState, type ShipSnapshot } from "../../shared/ship-types";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { readOptionalFile } from "../agentos/filesystem";
import { isVercelConfigured } from "../vercel/client";
import { readProjectSite } from "../vercel/site";
import { listShipChanges } from "./changes";
import { readShipDeploy } from "./deploy";
import { readShipDev } from "./dev-server";
import { readShipGit, resolveGithubToken } from "./git";
import { requireKnownProject } from "./root";

async function readLive(slug: string): Promise<ShipLiveState> {
  const markdown = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  const config = parseConfiguration(markdown);
  if (!config.vercelProjectId || !isVercelConfigured()) {
    return { url: undefined, health: config.vercelProjectId ? "Vercel token missing" : "Not linked" };
  }
  try {
    const site = await readProjectSite(config.vercelProjectId, config.vercelProjectName || config.vercelProjectId);
    if (site.status !== "linked") return { health: site.status };
    return {
      url: site.url,
      health: site.production?.state,
      embedAllowed: site.embed?.allowed,
      embedReason: site.embed?.reason,
    };
  } catch (error) {
    return { health: error instanceof Error ? error.message : "The live site could not be read." };
  }
}

export async function readShipSnapshot(slug: string): Promise<ShipSnapshot> {
  await requireKnownProject(slug);
  const [git, dev, deploy, live, changes, github] = await Promise.all([
    readShipGit(slug),
    readShipDev(slug),
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
    auth: {
      github: Boolean(github),
      vercel: isVercelConfigured(),
      githubHint: GITHUB_SETUP_HINT,
      vercelHint: VERCEL_SETUP_HINT,
    },
  };
}

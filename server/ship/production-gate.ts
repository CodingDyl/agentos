import { readOptionalFile } from "../agentos/filesystem";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { isVercelConfigured } from "../vercel/client";
import { PRODUCTION_BRANCH } from "../website-rebuild/deploy-policy";
import { defaultPublishDeps, readVercelProject, type PublishDeps } from "../website-rebuild/publish";
import { ShipError } from "./error";

/**
 * Production is only ever reached by a person who typed the Vercel project's
 * name to confirm it.
 *
 * That covers two doors: the Production deploy button, and a push of the
 * branch a Git-linked Vercel project builds as production (pushing `main` is a
 * production deploy in all but name). Nothing else in AgentOS — Motion Design,
 * a worker job finishing, a refresh — calls into either.
 */

const BRANCH_CACHE_MS = 5 * 60_000;
const branchCache = new Map<string, { branch: string; until: number }>();

export interface LinkedVercel {
  id: string;
  name: string;
}

export async function linkedVercel(slug: string): Promise<LinkedVercel | undefined> {
  const config = parseConfiguration(await readOptionalFile(`projects/${slug}/PROJECT.md`));
  if (!config.vercelProjectId) return undefined;
  return { id: config.vercelProjectId, name: config.vercelProjectName || config.vercelProjectId };
}

/**
 * The branch Vercel builds as production for this project. When it cannot be
 * read (no token, Vercel down) it is assumed to be `main`: the gate fails
 * towards asking.
 */
export async function productionBranchOf(linked: LinkedVercel, deps: PublishDeps = defaultPublishDeps): Promise<string> {
  if (!isVercelConfigured()) return PRODUCTION_BRANCH;
  const cached = branchCache.get(linked.id);
  if (cached && cached.until > Date.now()) return cached.branch;
  const project = await readVercelProject(linked.id, deps).catch(() => undefined);
  const branch = project?.productionBranch || PRODUCTION_BRANCH;
  // Only a real answer is kept; a failed read asks again next time.
  if (project) branchCache.set(linked.id, { branch, until: Date.now() + BRANCH_CACHE_MS });
  return branch;
}

/** Whether pushing `branch` would make Vercel build production. */
export async function pushDeploysProduction(slug: string, branch: string | undefined, deps: PublishDeps = defaultPublishDeps): Promise<boolean> {
  const linked = await linkedVercel(slug);
  if (!linked || !branch) return false;
  return branch === (await productionBranchOf(linked, deps));
}

export function productionConfirmed(linked: LinkedVercel, confirm: string | undefined): boolean {
  const typed = confirm?.trim();
  return Boolean(typed) && (typed === linked.name || typed === linked.id);
}

/** Throws unless `confirm` is the linked project's name (or id). */
export function assertProductionConfirmed(linked: LinkedVercel, confirm: string | undefined, action: string): void {
  if (!productionConfirmed(linked, confirm)) {
    throw new ShipError(`${action} goes to production on ${linked.name}. Type the Vercel project name to confirm.`, 428);
  }
}

/** For a push: throws when the branch is Vercel's production branch and the person has not confirmed it. */
export async function assertPushAllowed(slug: string, branch: string | undefined, confirm: string | undefined, deps: PublishDeps = defaultPublishDeps): Promise<void> {
  const linked = await linkedVercel(slug);
  if (!linked || !branch) return;
  if (branch !== (await productionBranchOf(linked, deps))) return;
  assertProductionConfirmed(linked, confirm, `Pushing ${branch}`);
}

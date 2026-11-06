import { githubRateLimitMessage, isRateLimitText } from "./github-rate-limit";

/**
 * How AgentOS asks Vercel for a website-rebuild preview.
 *
 * Git-push to the `preview` branch is the one trigger: Vercel's Git
 * integration builds it. An explicit create-deployment call on top of that
 * clones the same commit a second time and is how GitHub's secondary rate
 * limit gets hit, so it happens only when the push gave no preview: a new
 * project's first deployment, which Vercel always makes production.
 */

export const PREVIEW_BRANCH = "preview";
export const PRODUCTION_BRANCH = "main";
/** How often to look for the git-push deploy. Faster than this hammers GitHub through Vercel. */
export const DEPLOY_POLL_MS = 60_000;

export interface CommitDeployment {
  id?: string;
  sha?: string;
  target?: string | null;
  state: string;
  errorMessage?: string;
  /** Vercel's reason for a BLOCKED deployment, e.g. COMMIT_AUTHOR_REQUIRED. */
  blockCode?: string;
}

export type PreviewDeployStep = "wait" | "use-existing" | "request-preview" | "blocked";

/** Vercel may store a shortened SHA; AgentOS has the full approved commit. */
export function commitShaMatches(deploymentSha: string | undefined, commit: string): boolean {
  if (!deploymentSha || !commit) return false;
  const left = deploymentSha.toLowerCase();
  const right = commit.toLowerCase();
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function deployRank(state: string): number {
  if (state === "READY") return 0;
  if (state === "ERROR" || state === "CANCELED" || state === "BLOCKED") return 2;
  return 1;
}

const isProduction = (deployment: CommitDeployment) => deployment.target === "production";

/**
 * The deployment of this commit to treat as the preview: a READY one first,
 * then one still building, then a failed one. Listing order is kept for equal
 * rank, so the newest wins when Vercel returns newest-first. A production
 * deployment never counts: the site reads VERCEL_ENV, so it hides the demo
 * features the checks look for.
 */
export function pickCommitDeployment<T extends CommitDeployment>(deployments: readonly T[], commit: string): T | undefined {
  const ofCommit = deployments.filter((deployment) => commitShaMatches(deployment.sha, commit) && deployment.state !== "CANCELED" && !isProduction(deployment));
  return [...ofCommit].sort((left, right) => deployRank(left.state) - deployRank(right.state))[0];
}

/**
 * What to do next. Vercel makes a new project's first deployment production,
 * whichever branch it came from, so a push to `preview` on a new project gives
 * no preview at all. Only then does AgentOS ask for one itself.
 */
export function nextPreviewDeployStep<T extends CommitDeployment>(input: {
  gitPushTriggered: boolean;
  deployments: readonly T[];
  commit: string;
}): { step: PreviewDeployStep; deployment?: T; message?: string } {
  const chosen = pickCommitDeployment(input.deployments, input.commit);
  if (chosen) return { step: "use-existing", deployment: chosen };

  const production = input.deployments.find((deployment) => commitShaMatches(deployment.sha, input.commit) && deployment.state !== "CANCELED" && isProduction(deployment));
  if (production) {
    return isRateLimitText(production.errorMessage ?? "")
      ? { step: "blocked", deployment: production, message: githubRateLimitMessage() }
      : { step: "request-preview", deployment: production };
  }

  return { step: input.gitPushTriggered ? "wait" : "request-preview" };
}

export function previewDeploymentBody(
  project: { name: string; id: string },
  repo: { owner: string; name: string },
  branch: string,
  commit: string,
): {
  name: string;
  project: string;
  gitSource: { type: "github"; org: string; repo: string; ref: string; sha: string };
  target?: string;
} {
  if (branch === PRODUCTION_BRANCH) {
    throw new Error(`AgentOS does not create production deployments. Push ${PREVIEW_BRANCH}, not ${PRODUCTION_BRANCH}.`);
  }
  return {
    name: project.name,
    project: project.id,
    gitSource: { type: "github", org: repo.owner, repo: repo.name, ref: branch, sha: commit },
  };
}

/** Vercel would not start the build at all, so there is no build log to read. */
export function vercelBlockedMessage(blockCode?: string): string {
  if (blockCode === "COMMIT_AUTHOR_REQUIRED") {
    return "Vercel blocked this deploy: the commit's Git author is not a member of your Vercel team. AgentOS now commits as your git identity (AGENTOS_GIT_AUTHOR_EMAIL, or git config user.email), so new commits deploy. For this one, use Deploy now (force): it deploys as you.";
  }
  return `Vercel blocked this deploy${blockCode ? ` (${blockCode})` : ""} before it built. Open it in Vercel to see why, then use Deploy now (force) or retry.`;
}

export function vercelBuildFailureMessage(deployment: { state: string; errorMessage?: string; blockCode?: string }): string {
  if (deployment.state === "BLOCKED") return vercelBlockedMessage(deployment.blockCode);
  const detail = (deployment.errorMessage ?? "").trim();
  if (isRateLimitText(detail)) return githubRateLimitMessage();
  const failed = deployment.state === "ERROR" ? "failed" : "was cancelled";
  return `Vercel's build ${failed}${detail ? `: ${detail}` : ""}. Open the deployment in Vercel for the log.`;
}

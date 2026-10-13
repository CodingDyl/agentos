import { githubRateLimitMessage, isRateLimitText } from "./github-rate-limit";

/**
 * How AgentOS asks Vercel for a website-rebuild preview.
 *
 * Git-push to the `preview` branch is the one trigger: Vercel's Git
 * integration builds it. An explicit create-deployment call on top of that
 * clones the same commit a second time and is how GitHub's secondary rate
 * limit gets hit. Production is never the target of the preview branch.
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
  if (state === "ERROR" || state === "CANCELED") return 2;
  return 1;
}

/**
 * The deployment of this commit to treat as the preview: a READY one of any
 * target first (a later API deploy, or production, still counts), then one
 * still building, then an ERROR. Listing order is kept for equal rank, so
 * the newest READY wins when Vercel returns newest-first.
 */
export function pickCommitDeployment<T extends CommitDeployment>(deployments: readonly T[], commit: string): T | undefined {
  const ofCommit = deployments.filter((deployment) => commitShaMatches(deployment.sha, commit) && deployment.state !== "CANCELED");
  return [...ofCommit].sort((left, right) => deployRank(left.state) - deployRank(right.state))[0];
}

export function nextPreviewDeployStep<T extends CommitDeployment>(input: {
  gitPushTriggered: boolean;
  deployments: readonly T[];
  commit: string;
}): { step: PreviewDeployStep; deployment?: T; message?: string } {
  const chosen = pickCommitDeployment(input.deployments, input.commit);
  if (chosen && chosen.state !== "ERROR") return { step: "use-existing", deployment: chosen };

  if (chosen?.state === "ERROR" && chosen.target === "production") {
    const preview = input.deployments.find(
      (deployment) => commitShaMatches(deployment.sha, input.commit) && deployment.target !== "production" && deployment.state !== "CANCELED",
    );
    if (!preview) {
      return {
        step: "blocked",
        deployment: chosen,
        message: isRateLimitText(chosen.errorMessage ?? "")
          ? githubRateLimitMessage()
          : `Vercel deployed the ${PREVIEW_BRANCH} branch as production instead of a preview. AgentOS did not start a second deploy: that would hit GitHub's rate limit again. Set the project's production branch to ${PRODUCTION_BRANCH} in Vercel, then retry.`,
      };
    }
  }

  if (chosen?.state === "ERROR") return { step: "use-existing", deployment: chosen };

  if (input.gitPushTriggered) return { step: "wait" };
  return { step: "request-preview" };
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

export function vercelBuildFailureMessage(deployment: { state: string; errorMessage?: string }): string {
  const detail = (deployment.errorMessage ?? "").trim();
  if (isRateLimitText(detail)) return githubRateLimitMessage();
  const failed = deployment.state === "ERROR" ? "failed" : "was cancelled";
  return `Vercel's build ${failed}${detail ? `: ${detail}` : ""}. Open the deployment in Vercel for the log.`;
}

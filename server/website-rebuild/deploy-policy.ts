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
  sha?: string;
  target?: string | null;
  state: string;
  errorMessage?: string;
}

export type PreviewDeployStep = "wait" | "use-existing" | "request-preview" | "blocked";

export function nextPreviewDeployStep<T extends CommitDeployment>(input: {
  gitPushTriggered: boolean;
  deployments: readonly T[];
  commit: string;
}): { step: PreviewDeployStep; deployment?: T; message?: string } {
  const ofCommit = input.deployments.filter((deployment) => deployment.sha === input.commit && deployment.state !== "CANCELED");
  const preview = ofCommit.find((deployment) => deployment.target !== "production");
  if (preview) return { step: "use-existing", deployment: preview };

  const production = ofCommit.find((deployment) => deployment.target === "production");
  if (production) {
    return {
      step: "blocked",
      deployment: production,
      message: isRateLimitText(production.errorMessage ?? "")
        ? githubRateLimitMessage()
        : `Vercel deployed the ${PREVIEW_BRANCH} branch as production instead of a preview. AgentOS did not start a second deploy: that would hit GitHub's rate limit again. Set the project's production branch to ${PRODUCTION_BRANCH} in Vercel, then retry.`,
    };
  }

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

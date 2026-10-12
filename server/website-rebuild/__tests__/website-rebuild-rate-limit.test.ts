import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backoffDelayMs,
  decideGithubCall,
  formatRetryAfter,
  githubRateLimitMessage,
  isGithubRateLimited,
  isRateLimitText,
  retryAfterMs,
} from "../github-rate-limit";
import {
  DEPLOY_POLL_MS,
  PRODUCTION_BRANCH,
  PREVIEW_BRANCH,
  nextPreviewDeployStep,
  previewDeploymentBody,
  vercelBuildFailureMessage,
} from "../deploy-policy";

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

describe("GitHub rate-limit detection", () => {
  it("recognises a 403 secondary rate limit as rate-limited, not a bad token", () => {
    const body = { message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." };
    assert.equal(isGithubRateLimited(403, body), true);
    assert.equal(isRateLimitText(body.message), true);

    const decision = decideGithubCall({ status: 403, body, headers: headers({}), attempt: 0 });
    assert.equal(decision.action, "rate-limited");
    if (decision.action === "rate-limited") {
      assert.match(decision.message, /GitHub rate-limited, retry after/);
    }
  });

  it("treats 429 as rate-limited and does not retry automatically", () => {
    const decision = decideGithubCall({
      status: 429,
      body: { message: "API rate limit exceeded" },
      headers: headers({ "retry-after": "30" }),
      attempt: 0,
      now: 0,
    });
    assert.equal(decision.action, "rate-limited");
    if (decision.action === "rate-limited") {
      assert.equal(decision.retryAfterMs, 30_000);
    }
  });

  it("treats a 403 without a rate-limit message as a refused token, not a retry", () => {
    const decision = decideGithubCall({
      status: 403,
      body: { message: "Resource not accessible by personal access token" },
      headers: headers({}),
      attempt: 0,
    });
    assert.equal(decision.action, "auth");
  });

  it("honours Retry-After seconds and HTTP-date, then x-ratelimit-reset", () => {
    assert.equal(retryAfterMs(headers({ "retry-after": "12" })), 12_000);
    assert.equal(retryAfterMs(headers({ "Retry-After": "Fri, 01 Jan 2030 00:00:30 GMT" }), Date.parse("2030-01-01T00:00:00Z")), 30_000);
    assert.equal(retryAfterMs(headers({ "x-ratelimit-reset": "100" }), 90_000), 10_000);
    assert.equal(retryAfterMs(headers({ "retry-after": "5", "x-ratelimit-reset": "999" })), 5_000, "Retry-After wins");
  });

  it("uses exponential backoff with jitter when no retry-after header is present", () => {
    assert.equal(backoffDelayMs(0, { random: () => 0, baseMs: 1_000, maxMs: 60_000 }), 0);
    assert.equal(backoffDelayMs(0, { random: () => 1, baseMs: 1_000, maxMs: 60_000 }), 1_000);
    assert.equal(backoffDelayMs(3, { random: () => 1, baseMs: 1_000, maxMs: 60_000 }), 8_000);
    assert.equal(backoffDelayMs(10, { random: () => 1, baseMs: 1_000, maxMs: 60_000 }), 60_000, "capped");
    assert.equal(backoffDelayMs(0, { retryAfterMs: 45_000, random: () => 1 }), 45_000, "retry-after wins over backoff");
  });

  it("retries 5xx with backoff, then gives up; never retries a secondary limit", () => {
    const retry = decideGithubCall({ status: 502, body: {}, headers: headers({}), attempt: 0, random: () => 1 });
    assert.equal(retry.action, "retry");
    if (retry.action === "retry") assert.equal(retry.waitMs, 1_000);

    const exhausted = decideGithubCall({ status: 502, body: {}, headers: headers({}), attempt: 4, maxAttempts: 4 });
    assert.equal(exhausted.action, "error");

    const limited = decideGithubCall({
      status: 403,
      body: { message: "You have exceeded a secondary rate limit" },
      headers: headers({ "retry-after": "60" }),
      attempt: 0,
      now: 0,
    });
    assert.equal(limited.action, "rate-limited");
  });

  it("names the wait in the operator's words", () => {
    assert.equal(formatRetryAfter(1_000), "1 second");
    assert.equal(formatRetryAfter(12_000), "12 seconds");
    assert.equal(formatRetryAfter(90_000), "2 minutes");
    assert.equal(githubRateLimitMessage(60_000), "GitHub rate-limited, retry after 1 minute.");
    assert.equal(githubRateLimitMessage(), "GitHub rate-limited, retry after a few minutes.");
  });
});

describe("single preview deploy trigger", () => {
  const commit = "bccd970abc";
  const preview = { sha: commit, target: null as string | null, state: "QUEUED" };
  const production = { sha: commit, target: "production" as const, state: "ERROR", errorMessage: "You have exceeded a secondary rate limit" };

  it("waits for the git-push auto-deploy instead of requesting a second API deploy", () => {
    const next = nextPreviewDeployStep({ gitPushTriggered: true, deployments: [], commit });
    assert.equal(next.step, "wait");
  });

  it("reuses a preview of this commit and never asks for another", () => {
    const next = nextPreviewDeployStep({ gitPushTriggered: true, deployments: [preview], commit });
    assert.equal(next.step, "use-existing");
    assert.equal(next.deployment, preview);
  });

  it("does not fire a preview API deploy when Vercel already started production for the same SHA", () => {
    const next = nextPreviewDeployStep({ gitPushTriggered: true, deployments: [production], commit });
    assert.equal(next.step, "blocked");
    assert.match(next.message ?? "", /GitHub rate-limited, retry after/);
    assert.doesNotMatch(next.message ?? "", /change request/);
  });

  it("only requests an API preview when git did not trigger a deploy", () => {
    const next = nextPreviewDeployStep({ gitPushTriggered: false, deployments: [], commit });
    assert.equal(next.step, "request-preview");
  });

  it("never puts production in the create-deployment body for the preview branch", () => {
    const body = previewDeploymentBody({ name: "total-electric", id: "prj_1" }, { owner: "CodingDyl", name: "total-electric" }, PREVIEW_BRANCH, commit);
    assert.equal(body.target, undefined);
    assert.equal(JSON.stringify(body).includes("production"), false);
    assert.equal(body.gitSource.ref, PREVIEW_BRANCH);
    assert.notEqual(body.gitSource.ref, PRODUCTION_BRANCH);
  });

  it("says the build hit GitHub's rate limit instead of asking for a change request on the features", () => {
    const message = vercelBuildFailureMessage({
      state: "ERROR",
      errorMessage: "Git clone failed: You have exceeded a secondary rate limit (HTTP 403)",
    });
    assert.match(message, /GitHub rate-limited, retry after/);
    assert.doesNotMatch(message, /change request/);
    assert.doesNotMatch(message, /features/);
  });

  it("still reports a genuine Vercel build failure without blaming a rate limit", () => {
    const message = vercelBuildFailureMessage({ state: "ERROR", errorMessage: "Type error in app/page.tsx" });
    assert.match(message, /Type error in app\/page\.tsx/);
    assert.doesNotMatch(message, /change request on the features/);
    assert.doesNotMatch(message, /rate-limited/);
  });

  it("polls for the git-push deploy no faster than once a minute", () => {
    assert.ok(DEPLOY_POLL_MS >= 60_000);
  });
});

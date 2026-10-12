import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GITHUB_STATUS_POLL_MS, githubStatusPollInterval, sitePollInterval } from "../../../lib/agentos/poll-policy";

describe("GitHub and site poll policy", () => {
  it("polls GitHub-related status no faster than once a minute", () => {
    assert.ok(GITHUB_STATUS_POLL_MS >= 60_000);
    assert.equal(githubStatusPollInterval(false), GITHUB_STATUS_POLL_MS);
  });

  it("pauses GitHub status polls when the tab is hidden", () => {
    assert.equal(githubStatusPollInterval(true), false);
  });

  it("does not poll the Site tab faster than once a minute, even while a deploy is building", () => {
    assert.equal(sitePollInterval(), 60_000);
  });
});

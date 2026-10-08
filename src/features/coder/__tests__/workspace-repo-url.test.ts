import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGitCloneUrl,
  resolveWorkspaceRepoUrl,
  toGitCloneUrl,
} from "../workspace-repo-url";

describe("isGitCloneUrl", () => {
  it("accepts https and ssh git URLs", () => {
    assert.equal(isGitCloneUrl("https://github.com/codingdyl/agentos.git"), true);
    assert.equal(isGitCloneUrl("https://github.com/codingdyl/agentos"), true);
    assert.equal(isGitCloneUrl("git@github.com:codingdyl/agentos.git"), true);
    assert.equal(isGitCloneUrl("ssh://git@github.com/codingdyl/agentos.git"), true);
  });

  it("rejects filesystem paths, owner/name shorthand, and shell metacharacters", () => {
    assert.equal(isGitCloneUrl("~/Developer/agentos"), false);
    assert.equal(isGitCloneUrl("/Users/dylan/dev/agentos"), false);
    assert.equal(isGitCloneUrl("codingdyl/agentos"), false);
    assert.equal(isGitCloneUrl("https://github.com/foo/bar.git; rm -rf /"), false);
    assert.equal(isGitCloneUrl("http://github.com/foo/bar.git"), false);
    assert.equal(isGitCloneUrl(""), false);
  });
});

describe("toGitCloneUrl", () => {
  it("passes through https/ssh URLs and turns owner/name into a GitHub clone URL", () => {
    assert.equal(
      toGitCloneUrl("https://github.com/codingdyl/agentos.git"),
      "https://github.com/codingdyl/agentos.git",
    );
    assert.equal(toGitCloneUrl("codingdyl/agentos"), "https://github.com/codingdyl/agentos.git");
    assert.equal(toGitCloneUrl("codingdyl/agentos.git"), "https://github.com/codingdyl/agentos.git");
  });

  it("does not invent a clone URL from a local path", () => {
    assert.equal(toGitCloneUrl("~/Developer/agentos"), undefined);
    assert.equal(toGitCloneUrl("/Volumes/DylanSSD/dev/Aureya"), undefined);
  });
});

describe("resolveWorkspaceRepoUrl", () => {
  it("does not read configuration.repositoryUrl as the real field — it is absent on AgentOS workspaces", () => {
    assert.equal(resolveWorkspaceRepoUrl({ configuration: { localPath: "~/AgentOS/coder/x" } }), undefined);
  });

  it("still uses configuration.repositoryUrl when a payload actually has one", () => {
    assert.equal(
      resolveWorkspaceRepoUrl({
        configuration: { repositoryUrl: "https://github.com/acme/site.git" },
      }),
      "https://github.com/acme/site.git",
    );
  });

  it("prefers a GitHub owner/name from website-rebuild / client-site githubRepo", () => {
    assert.equal(
      resolveWorkspaceRepoUrl({ githubRepo: "dylan/total-electric" }),
      "https://github.com/dylan/total-electric.git",
    );
    assert.equal(
      resolveWorkspaceRepoUrl({ configuration: { githubRepo: "acme/web" } }),
      "https://github.com/acme/web.git",
    );
  });

  it("ignores git.repositoryPath when it is a local checkout", () => {
    assert.equal(
      resolveWorkspaceRepoUrl({
        git: { repositoryPath: "/Users/dylan/dev/agentos" },
        configuration: { localPath: undefined },
      }),
      undefined,
    );
    assert.equal(
      resolveWorkspaceRepoUrl({ git: { repositoryPath: "dylan/total-electric" } }),
      undefined,
    );
  });

  it("uses git.repositoryPath only when that field is itself a git URL", () => {
    assert.equal(
      resolveWorkspaceRepoUrl({
        git: { repositoryPath: "git@github.com:acme/app.git" },
      }),
      "git@github.com:acme/app.git",
    );
  });

  it("returns undefined when nothing cloneable is on the workspace", () => {
    assert.equal(resolveWorkspaceRepoUrl({}), undefined);
    assert.equal(resolveWorkspaceRepoUrl({ configuration: {}, git: {} }), undefined);
  });
});

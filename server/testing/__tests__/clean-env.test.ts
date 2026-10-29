import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanTestEnv } from "../clean-env";

describe("the environment tests run in", () => {
  const owner: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/home/owner",
    LC_ALL: "en_US.UTF-8",
    NODE_OPTIONS: "--no-warnings",
    AGENTOS_ROOT: "/vault",
    AGENTOS_UI_DIR: "/real/state",
    VIRTEC_BASE_URL: "https://example.test",
    ANTHROPIC_API_KEY: "sk-secret",
    HERMES_API_KEY: "secret",
    GITHUB_TOKEN: "ghp_secret",
  };

  it("keeps what a bare machine has", () => {
    const env = cleanTestEnv(owner);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HOME, "/home/owner");
    assert.equal(env.LC_ALL, "en_US.UTF-8");
    assert.equal(env.NODE_OPTIONS, "--no-warnings");
  });

  it("drops the owner's keys, service URLs, vault and state folder", () => {
    const env = cleanTestEnv(owner);
    for (const name of ["AGENTOS_ROOT", "AGENTOS_UI_DIR", "VIRTEC_BASE_URL", "ANTHROPIC_API_KEY", "HERMES_API_KEY", "GITHUB_TOKEN"]) {
      assert.equal(env[name], undefined, name);
    }
  });

  it("adds what the runner sets, over anything inherited", () => {
    assert.equal(cleanTestEnv(owner, { AGENTOS_UI_DIR: "/tmp/fresh" }).AGENTOS_UI_DIR, "/tmp/fresh");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { parseEnv } from "node:util";

// Its own state directory and its own .env: this file writes both.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-credentials-"));
const envFile = path.join(directory, ".env");
process.env.AGENTOS_UI_DIR = directory;
process.env.AGENTOS_ENV_FILE = envFile;

const { applyEnvValues, formatEnvLine, valueProblem, writeEnvValues } = await import("../env-file");
const { saveCredentials, getConnector } = await import("../registry");
const { resetConnectorStateCache } = await import("../store");
const { setConnectorEnabled, isConnectorEnabled } = await import("../policy");

// "Test the connection" is a real request; here it answers as GitHub would, so no test leaves the machine.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ login: "dylan" }), { status: 200 })) as typeof fetch;

const TOUCHED = ["POSTHOG_API_KEY", "POSTHOG_HOST", "VIRTEC_BASE_URL", "VIRTEC_API_KEY", "GITHUB_TOKEN"];

beforeEach(() => {
  fs.rmSync(envFile, { force: true });
  fs.rmSync(path.join(directory, "connectors.json"), { force: true });
  resetConnectorStateCache();
  for (const name of TOUCHED) delete process.env[name];
});

after(() => {
  globalThis.fetch = realFetch;
  for (const name of TOUCHED) delete process.env[name];
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("the .env writer", () => {
  it("replaces an existing key, keeps everything else, and drops a duplicate", () => {
    const before = "# Hermes\nHERMES_API_KEY=old\nOTHER=1\n\nHERMES_API_KEY=older\n";
    assert.equal(applyEnvValues(before, { HERMES_API_KEY: "new" }), "# Hermes\nHERMES_API_KEY=new\nOTHER=1\n");
  });

  it("fills a commented template line in place", () => {
    const before = "# Defaults to Jarvis.\n# FISH_VOICE_ID=05b3\nFISH_API_KEY=\n";
    assert.equal(applyEnvValues(before, { FISH_VOICE_ID: "abc" }), "# Defaults to Jarvis.\nFISH_VOICE_ID=abc\nFISH_API_KEY=\n");
  });

  it("appends a key it hasn't seen, under a note", () => {
    assert.equal(applyEnvValues("A=1\n", { B: "2" }), "A=1\n\n# Added from AgentOS → Connectors\nB=2\n");
    assert.equal(applyEnvValues("", { B: "2" }), "# Added from AgentOS → Connectors\nB=2\n");
  });

  it("quotes anything a .env parser could misread, and reads back exactly", () => {
    assert.equal(formatEnvLine("K", "sk-abc_123"), "K=sk-abc_123");
    assert.equal(formatEnvLine("K", "a b#c"), "K='a b#c'");
    assert.equal(formatEnvLine("K", "it's"), `K="it's"`);

    for (const value of ["a b#c", "it's", "p@ss=word$1", "sk-abc_123"]) {
      // Node's own parser: the one the adapter loads `.env` with.
      assert.equal(parseEnv(formatEnvLine("K", value)).K, value);
    }
  });

  it("refuses a line break, a forbidden name, and a URL that isn't one", () => {
    assert.match(valueProblem("GITHUB_TOKEN", "abc\nPATH=/tmp") ?? "", /line break/);
    assert.match(valueProblem("NODE_OPTIONS", "--require x") ?? "", /can't be set/);
    assert.match(valueProblem("VIRTEC_BASE_URL", "not a url") ?? "", /full address/);
    assert.match(valueProblem("VIRTEC_BASE_URL", "file:///etc/passwd") ?? "", /http/);
    assert.equal(valueProblem("GITHUB_TOKEN", "ghp_abc"), undefined);
  });

  it("writes the file readable by its owner only", () => {
    writeEnvValues({ GITHUB_TOKEN: "ghp_abc" });
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(envFile, "utf8"), /^GITHUB_TOKEN=ghp_abc$/m);
  });
});

describe("Save & connect", () => {
  it("writes, applies and switches on, and never returns a value", async () => {
    setConnectorEnabled("github", false);
    const result = await saveCredentials("github", { GITHUB_TOKEN: "ghp_secret_value" });

    assert.match(fs.readFileSync(envFile, "utf8"), /GITHUB_TOKEN=ghp_secret_value/);
    assert.equal(process.env.GITHUB_TOKEN, "ghp_secret_value");
    assert.equal(isConnectorEnabled("github"), true);
    assert.ok(result.steps.some((step) => step.label === "Save to .env" && step.ok));
    assert.ok(result.steps.some((step) => step.label === "Test the connection" && step.ok));
    assert.equal(result.ok, true);
    assert.equal(result.connector.account, "dylan");
    assert.doesNotMatch(JSON.stringify(result), /ghp_secret_value/);
    assert.doesNotMatch(JSON.stringify(await getConnector("github")), /ghp_secret_value/);
  });

  it("ignores blank fields, so an unchanged key isn't wiped", async () => {
    writeEnvValues({ VIRTEC_API_KEY: "keep-me" });
    process.env.VIRTEC_API_KEY = "keep-me";
    await saveCredentials("virtec", { VIRTEC_BASE_URL: "https://crm.example.com", VIRTEC_API_KEY: "  " });

    const contents = fs.readFileSync(envFile, "utf8");
    assert.match(contents, /VIRTEC_API_KEY=keep-me/);
    assert.match(contents, /VIRTEC_BASE_URL=https:\/\/crm.example.com/);
  });

  it("refuses a name that isn't on the connector's own setup list", async () => {
    await assert.rejects(() => saveCredentials("github", { VERCEL_API_TOKEN: "x" }), /isn't a setting of GitHub/);
    await assert.rejects(() => saveCredentials("github", { PATH: "/tmp" }), /isn't a setting/);
    assert.equal(fs.existsSync(envFile), false);
  });

  it("stops before writing when a value is unusable", async () => {
    const result = await saveCredentials("virtec", { VIRTEC_BASE_URL: "nope" });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0].label, "Check the values");
    assert.equal(fs.existsSync(envFile), false);
  });

  it("saves keys for a connector with no adapter yet, and says so", async () => {
    const result = await saveCredentials("posthog", { POSTHOG_API_KEY: "phx_1", POSTHOG_HOST: "https://eu.posthog.com" });
    assert.equal(result.ok, true);
    assert.match(result.steps.at(-1)?.detail ?? "", /no adapter/);
    const setup = (await getConnector("posthog")).setup;
    assert.equal(setup.find((item) => item.envName === "POSTHOG_HOST")?.value, "https://eu.posthog.com");
    assert.equal(setup.find((item) => item.envName === "POSTHOG_API_KEY")?.value, undefined);
  });

  it("records which names changed, never the values", async () => {
    await saveCredentials("github", { GITHUB_TOKEN: "ghp_secret_value" });
    const uses = (await getConnector("github")).recentUses;
    assert.equal(uses[0].detail, "GITHUB_TOKEN");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rebuild-delete-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");

const publish = await import("../publish");
const { setConnectorEnabled } = await import("../../connectors/policy");
const { setStoredPolicies, resetConnectorStateCache } = await import("../../connectors/store");
type PublishDeps = import("../publish").PublishDeps;

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${n}-`));
  resetConnectorStateCache();
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

interface Call {
  method: string;
  url: string;
}

function deps(answer: (call: Call) => { status: number; body?: unknown }): { deps: PublishDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      fetch: (async (input: string | URL, init?: RequestInit) => {
        const call = { method: init?.method ?? "GET", url: String(input) };
        calls.push(call);
        const { status, body } = answer(call);
        return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
      env: () => ({ GITHUB_TOKEN: "ghp_test", VERCEL_API_TOKEN: "vc_test" }),
      git: async () => "",
      sleep: async () => undefined,
      random: () => 0,
    },
  };
}

describe("looking at a GitHub repo before deleting it", () => {
  it("returns what GitHub says: private, and when it was created", async () => {
    const { deps: d, calls } = deps(() => ({ status: 200, body: { full_name: "owner/site", private: true, created_at: "2026-10-01T10:00:00Z" } }));
    assert.deepEqual(await publish.inspectGithubRepo("owner/site", d), { fullName: "owner/site", private: true, createdAt: "2026-10-01T10:00:00Z" });
    assert.equal(calls[0].method, "GET");
    assert.match(calls[0].url, /\/repos\/owner\/site$/);
  });

  it("says undefined when it is already gone, and refuses a name that is not owner/name", async () => {
    const { deps: d } = deps(() => ({ status: 404, body: { message: "Not Found" } }));
    assert.equal(await publish.inspectGithubRepo("owner/site", d), undefined);
    for (const bad of ["site", "owner/site/extra", "../../user", "owner/ site", "a b/c", ""]) {
      await assert.rejects(publish.inspectGithubRepo(bad, d), /is not a repository name/, bad);
    }
  });
});

describe("deleting a GitHub repo", () => {
  it("is refused while the connector's delete capability is off, and sends nothing", async () => {
    setConnectorEnabled("github", true);
    const { deps: d, calls } = deps(() => ({ status: 204 }));
    await assert.rejects(publish.deleteGithubRepo("owner/site", d), /turned off|switched off|Delete repositories/);
    assert.equal(calls.length, 0, "GitHub was never asked");
  });

  it("deletes once you have switched the capability on, naming exactly that repo", async () => {
    setConnectorEnabled("github", true);
    setStoredPolicies({ "github.delete_repository": "allowed" });
    const { deps: d, calls } = deps(() => ({ status: 204 }));
    await publish.deleteGithubRepo("owner/site", d);
    assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), ["DELETE /repos/owner/site"]);
  });

  it("counts already gone as done, and reports a refusal in words", async () => {
    setConnectorEnabled("github", true);
    setStoredPolicies({ "github.delete_repository": "allowed" });
    await publish.deleteGithubRepo("owner/site", deps(() => ({ status: 404, body: { message: "Not Found" } })).deps);
    await assert.rejects(publish.deleteGithubRepo("owner/site", deps(() => ({ status: 422, body: { message: "Repository cannot be deleted" } })).deps), /Repository cannot be deleted/);
  });

  it("never builds a request from a name that could change the path", async () => {
    setConnectorEnabled("github", true);
    setStoredPolicies({ "github.delete_repository": "allowed" });
    const { deps: d, calls } = deps(() => ({ status: 204 }));
    await assert.rejects(publish.deleteGithubRepo("owner/../orgs/victim", d), /is not a repository name/);
    await assert.rejects(publish.deleteGithubRepo("owner/site/branches", d), /is not a repository name/);
    assert.equal(calls.length, 0);
  });
});

describe("Vercel projects", () => {
  it("returns when a project was created and which repo it is linked to", async () => {
    const { deps: d } = deps(() => ({ status: 200, body: { id: "prj_1", name: "site", createdAt: 1_790_000_000_000, link: { type: "github", org: "owner", repo: "site" } } }));
    assert.deepEqual(await publish.inspectVercelProject("prj_1", d), { id: "prj_1", name: "site", createdAt: 1_790_000_000_000, linkedRepo: "owner/site" });
  });

  it("says undefined when it is gone", async () => {
    assert.equal(await publish.inspectVercelProject("prj_1", deps(() => ({ status: 404, body: { error: { message: "not found" } } })).deps), undefined);
  });

  it("is refused to delete while the capability is off, and deletes the one project when on", async () => {
    setConnectorEnabled("vercel", true);
    const off = deps(() => ({ status: 200 }));
    await assert.rejects(publish.deleteVercelProject("prj_1", off.deps), /turned off|Delete projects/);
    assert.equal(off.calls.length, 0);

    setStoredPolicies({ "vercel.delete_project": "allowed" });
    const on = deps(() => ({ status: 200, body: {} }));
    await publish.deleteVercelProject("prj_1", on.deps);
    assert.deepEqual(on.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), ["DELETE /v9/projects/prj_1"]);
  });
});

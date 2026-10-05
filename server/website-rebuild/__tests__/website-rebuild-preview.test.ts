import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rebuild-preview-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");

const store = await import("../store");
const { advance } = await import("../runner");
const stages = await import("../stages");
const publish = await import("../publish");
const { checkPreview, assetPaths } = await import("../qa");
const { setConnectorEnabled } = await import("../../connectors/policy");
type StageHandler = import("../runner").StageHandler;
type RunnerDeps = import("../runner").RunnerDeps;
type PublishDeps = import("../publish").PublishDeps;
type RebuildStageId = import("../../../shared/website-rebuild-types").RebuildStageId;

let caseNumber = 0;
let sites = "";
const vault = new Map<string, string>();

beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
  sites = fs.mkdtempSync(path.join(root, `clients-${caseNumber}-`));
  process.env.AGENTOS_CLIENT_SITES_DIR = sites;
  // The writes are behind connector switches; these tests are the person who turned them on.
  setConnectorEnabled("github", true);
  setConnectorEnabled("vercel", true);
  vault.clear();
});
after(() => {
  store.closeRebuildDatabase();
  stages.stageDeps.current = stages.defaultStageDeps;
  fs.rmSync(root, { recursive: true, force: true });
});

const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

// ---------------------------------------------------------- fake GitHub/Vercel

interface FakeApi {
  calls: { method: string; url: string; body?: unknown; auth?: string }[];
  repoExists: false | "private" | "public";
  projectLinkedTo?: string;
  deployments: { uid: string; url: string; readyState: string; target: string | null; meta: { githubCommitSha: string } }[];
}

function fakeFetch(api: FakeApi): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    api.calls.push({ method, url, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const repo = { name: "total-electric", full_name: "dylan/total-electric", private: api.repoExists !== "public", default_branch: "main", html_url: "https://github.com/dylan/total-electric", owner: { login: "dylan" } };
    if (url.endsWith("/user")) return json(200, { login: "dylan" });
    if (url.includes("/repos/dylan/total-electric")) return api.repoExists ? json(200, repo) : json(404, { message: "Not Found" });
    if (url.endsWith("/user/repos") && method === "POST") {
      api.repoExists = "private";
      return json(201, repo);
    }
    if (url.includes("/v9/projects/") && method === "GET") {
      return api.projectLinkedTo ? json(200, { id: "prj_1", name: "total-electric", link: { type: "github", org: api.projectLinkedTo.split("/")[0], repo: api.projectLinkedTo.split("/")[1] }, ssoProtection: { deploymentType: "preview" } }) : json(404, { error: { message: "Project not found" } });
    }
    if (url.includes("/v11/projects") && method === "POST") {
      api.projectLinkedTo = body.gitRepository.repo;
      return json(200, { id: "prj_1", name: "total-electric", link: { type: "github", org: "dylan", repo: "total-electric" }, ssoProtection: { deploymentType: "preview" } });
    }
    if (url.includes("/v9/projects/prj_1") && method === "PATCH") return json(200, { id: "prj_1", name: "total-electric" });
    if (url.includes("/v6/deployments")) return json(200, { deployments: api.deployments });
    if (url.includes("/v13/deployments") && method === "POST") {
      const deployment = { uid: "dpl_req", url: "total-electric-git-preview-dylan.vercel.app", readyState: "QUEUED", target: null, meta: { githubCommitSha: body.gitSource.sha } };
      api.deployments.push(deployment);
      return json(200, deployment);
    }
    if (url.includes("/v13/deployments/")) {
      const id = url.split("/v13/deployments/")[1].split("?")[0];
      const deployment = api.deployments.find((entry) => entry.uid === id);
      if (deployment) deployment.readyState = "READY";
      return deployment ? json(200, deployment) : json(404, {});
    }
    return json(500, { message: `unexpected ${method} ${url}` });
  }) as typeof fetch;
}

function publishDeps(api: FakeApi, pushes: { args: readonly string[]; env: Record<string, string> }[]): PublishDeps {
  return {
    fetch: fakeFetch(api),
    env: () => ({ GITHUB_TOKEN: "ghp_secret123", VERCEL_API_TOKEN: "vercel_secret456" }),
    git: async (_repo, args, env) => {
      pushes.push({ args, env });
      return "";
    },
  };
}

describe("publishing to GitHub and Vercel", () => {
  it("creates the repo private, and refuses to use an existing public one", async () => {
    const api: FakeApi = { calls: [], repoExists: false, deployments: [] };
    const { repo, created } = await publish.ensurePrivateRepo("total-electric", "x", publishDeps(api, []));
    assert.equal(created, true);
    assert.equal(api.calls.find((call) => call.url.endsWith("/user/repos"))?.body && (api.calls.find((call) => call.url.endsWith("/user/repos"))?.body as { private: boolean }).private, true);
    assert.equal(repo.fullName, "dylan/total-electric");

    const again = await publish.ensurePrivateRepo("total-electric", "x", publishDeps(api, []));
    assert.equal(again.created, false, "a retry reuses the repo");

    await assert.rejects(publish.ensurePrivateRepo("total-electric", "x", publishDeps({ ...api, repoExists: "public" }, [])), /is public/);
  });

  it("pushes with the token in the environment, never in the command line, and hides it in errors", async () => {
    const pushes: { args: readonly string[]; env: Record<string, string> }[] = [];
    const repo = { owner: "dylan", name: "total-electric", fullName: "dylan/total-electric", private: true, defaultBranch: "main", htmlUrl: "" };
    await publish.pushRef("/tmp", repo, "abc1234", "preview", true, publishDeps({ calls: [], repoExists: "private", deployments: [] }, pushes));
    assert.deepEqual(pushes[0].args, ["push", "--force", "https://github.com/dylan/total-electric.git", "abc1234:refs/heads/preview"]);
    assert.ok(!pushes[0].args.join(" ").includes("ghp_secret123"));
    assert.match(pushes[0].env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);

    const failing: PublishDeps = { ...publishDeps({ calls: [], repoExists: "private", deployments: [] }, []), git: async () => { throw Object.assign(new Error("fatal"), { stderr: "remote: denied for ghp_secret123" }); } };
    await assert.rejects(publish.pushRef("/tmp", repo, "abc1234", "preview", true, failing), (error: Error) => !error.message.includes("ghp_secret123") && /\*\*\*/.test(error.message));
    await assert.rejects(publish.pushRef("/tmp", repo, "not-a-commit; rm -rf", "preview", true, failing), /Not a commit/);
  });

  it("refuses a Vercel project linked to another repo, and opens previews only when they are protected", async () => {
    const repo = { owner: "dylan", name: "total-electric", fullName: "dylan/total-electric", private: true, defaultBranch: "main", htmlUrl: "" };
    await assert.rejects(publish.ensureVercelProject("total-electric", repo, publishDeps({ calls: [], repoExists: "private", projectLinkedTo: "someone/else", deployments: [] }, [])), /linked to someone\/else/);

    const api: FakeApi = { calls: [], repoExists: "private", deployments: [] };
    const { project } = await publish.ensureVercelProject("total-electric", repo, publishDeps(api, []));
    assert.equal(project.protected, true);
    await publish.openPreviewsToLinkHolders(project, publishDeps(api, []));
    assert.deepEqual(api.calls.at(-1)?.body, { ssoProtection: null, passwordProtection: null });
    assert.equal(api.calls.at(-1)?.auth, "Bearer vercel_secret456");
  });

  it("never treats a production deployment as the preview", async () => {
    const api: FakeApi = { calls: [], repoExists: "private", deployments: [{ uid: "dpl_prod", url: "x.vercel.app", readyState: "READY", target: "production", meta: { githubCommitSha: "abc" } }] };
    const found = await publish.findPreviewDeployment({ id: "prj_1", name: "x", protected: false }, "abc", publishDeps(api, []));
    assert.equal(found, undefined);
  });

  it("refuses to write when the connector is switched off", async () => {
    setConnectorEnabled("github", false);
    await assert.rejects(publish.ensurePrivateRepo("total-electric", "x", publishDeps({ calls: [], repoExists: false, deployments: [] }, [])), /switched off/);
  });
});

// ----------------------------------------------------------------- QA checks

function siteFetch(pages: Record<string, { status: number; html?: string; location?: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const page = pages[new URL(String(input)).pathname] ?? { status: 404 };
    return new Response(page.html ?? "", { status: page.status, headers: { "content-type": "text/html", ...(page.location ? { location: page.location } : {}) } });
  }) as typeof fetch;
}

const HOME = '<html><link href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js"></script><a href="https://cal.com/total">Book a call-out</a></html>';

describe("preview checks", () => {
  it("passes a preview a stranger can open, with assets, pages and a contact form", async () => {
    const result = await checkPreview("https://p.vercel.app/", ["/", "/contact"], ["contact_form", "booking"], siteFetch({
      "/": { status: 200, html: HOME },
      "/contact": { status: 200, html: '<form><input type="email" name="email"><textarea name="message"></textarea></form>' },
      "/_next/static/css/app.css": { status: 200 },
      "/_next/static/chunks/main.js": { status: 200 },
    }));
    assert.equal(result.passed, true, JSON.stringify(result.checks));
    assert.match(result.checks.find((check) => check.check === "Contact form present")?.detail ?? "", /Not submitted/);
  });

  it("fails straight away when Vercel asks the visitor to log in", async () => {
    const result = await checkPreview("https://p.vercel.app", ["/"], [], siteFetch({ "/": { status: 302, location: "https://vercel.com/sso-api?url=x" } }));
    assert.equal(result.passed, false);
    assert.match(result.checks[0].detail, /Deployment protection is still on/);
    assert.equal(result.checks.length, 1);
  });

  it("fails a missing page and a missing feature; a shop is reported as blocked, not failed", async () => {
    const result = await checkPreview("https://p.vercel.app", ["/", "/services"], ["contact_form", "ecommerce"], siteFetch({ "/": { status: 200, html: HOME }, "/_next/static/css/app.css": { status: 200 }, "/_next/static/chunks/main.js": { status: 200 } }));
    assert.equal(result.passed, false);
    assert.equal(result.checks.find((check) => check.check === "Page /services")?.status, "fail");
    assert.equal(result.checks.find((check) => check.check === "Contact form present")?.status, "fail");
    assert.equal(result.checks.find((check) => check.check === "Online shop")?.status, "blocked");
  });

  it("finds the Next.js assets a page loads", () => {
    assert.deepEqual(assetPaths(HOME), ["/_next/static/css/app.css", "/_next/static/chunks/main.js"]);
  });
});

// ------------------------------------------------------------------ stage 7

const vaultDeps: RunnerDeps = {
  ensureWorkspace: async () => ({ slug: "total-electric", reused: false }),
  capture: async () => {
    throw new Error("unused");
  },
  writeDocument: async (relativePath, markdown) => {
    vault.set(relativePath, markdown);
  },
  writeBinary: async () => undefined,
};

/** Stages 1 to 6 stand-ins: the code stages commit to the real client repo, so stage 7 has a real approved commit to push. */
function upToFunctions(): Record<RebuildStageId, StageHandler> {
  const plain: StageHandler = async (context) => ({ summary: `${context.stage} done`, artifactIds: [] });
  const workspace: StageHandler = async (context) => {
    store.setRunField(context.run.id, "workspace_slug", "total-electric");
    return { summary: "ok", artifactIds: [] };
  };
  const code: StageHandler = async (context) => {
    const repo = await stages.defaultStageDeps.ensureRepo("total-electric", "Total Electric");
    store.setRunField(context.run.id, "repo_path", repo);
    fs.writeFileSync(path.join(repo, "sitemap.json"), '["/", "/contact"]');
    fs.writeFileSync(path.join(repo, `${context.stage}.txt`), String(context.revision));
    git(repo, "add", "-A");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", context.stage);
    return { summary: `${context.stage} done`, artifactIds: [], ref: git(repo, "rev-parse", "HEAD") };
  };
  return { workspace, capture: plain, research: plain, hero: plain, build: code, functions: code, preview: stages.previewStage };
}

async function runToPreview(api: FakeApi, pushes: { args: readonly string[]; env: Record<string, string> }[], qaPasses = true) {
  const deps = publishDeps(api, pushes);
  stages.stageDeps.current = {
    ...stages.defaultStageDeps,
    publish: {
      ensurePrivateRepo: (name, description) => publish.ensurePrivateRepo(name, description, deps),
      pushRef: (local, repo, commit, branch, force) => publish.pushRef(local, repo, commit, branch, force, deps),
      ensureVercelProject: (name, repo) => publish.ensureVercelProject(name, repo, deps),
      openPreviewsToLinkHolders: (project) => publish.openPreviewsToLinkHolders(project, deps),
      findPreviewDeployment: (project, commit) => publish.findPreviewDeployment(project, commit, deps),
      requestPreviewDeployment: (project, repo, branch, commit) => publish.requestPreviewDeployment(project, repo, branch, commit, deps),
      readDeployment: (id) => publish.readDeployment(id, deps),
    },
    checkPreview: async () =>
      qaPasses
        ? { passed: true, checks: [{ check: "Opens without logging in", status: "pass" as const, detail: "200" }] }
        : { passed: false, checks: [{ check: "Opens without logging in", status: "pass" as const, detail: "200" }, { check: "Page /contact", status: "fail" as const, detail: "Answered 500." }] },
    screenshot: async () => [],
    savePreviewLink: async (prospectId, url) => {
      vault.set(`case:${prospectId}`, url);
    },
    sleep: async () => undefined,
  };
  const { run } = store.createOrReuseRun({ prospectId: `p-${caseNumber}`, company: "Total Electric", websiteUrl: "https://te.example", targetMarket: "Homeowners", location: "Cape Town", conversionGoal: "Book", requiredFunctions: ["contact_form"], designTemplate: "DESIGN.md", skillVersion: "1.2.0" });
  const handlers = upToFunctions();
  await advance(run.id, handlers, vaultDeps);
  store.decide(run.id, "hero", 1, "approved", undefined, "concept-a");
  await advance(run.id, handlers, vaultDeps);
  store.decide(run.id, "build", 1, "approved");
  await advance(run.id, handlers, vaultDeps);
  store.decide(run.id, "functions", 1, "approved");
  await advance(run.id, handlers, vaultDeps);
  return { run: store.readRun(run.id), handlers };
}

describe("stage 7: Vercel preview", () => {
  it("publishes the approved commit to a preview a stranger can open, and hands it off", async () => {
    const api: FakeApi = { calls: [], repoExists: false, deployments: [] };
    const pushes: { args: readonly string[]; env: Record<string, string> }[] = [];
    const { run } = await runToPreview(api, pushes);

    const preview = run.stages.find((stage) => stage.id === "preview");
    assert.equal(preview?.status, "complete", preview?.blocker ?? "");
    const approved = run.revisions.find((revision) => revision.stage === "functions")?.ref ?? "";
    // main gets only the first commit; the approved commit goes to the preview branch.
    const root = git(run.repoPath ?? "", "rev-list", "--max-parents=0", "HEAD");
    assert.deepEqual(pushes.map((push) => push.args.slice(-1)[0]), [`${root}:refs/heads/main`, `${approved}:refs/heads/preview`]);
    assert.equal(run.githubRepo, "dylan/total-electric");
    assert.equal(run.previewUrl, "https://total-electric-git-preview-dylan.vercel.app");
    assert.equal(vault.get(`case:${run.prospectId}`), run.previewUrl, "the lead's preview link is filled in");
    assert.ok(api.calls.some((call) => call.method === "PATCH" && call.url.includes("prj_1")), "previews opened to link holders");
    assert.ok(!api.calls.some((call) => JSON.stringify(call.body ?? {}).includes("production")), "nothing asked for production");

    const handoff = vault.get("projects/total-electric/docs/website-rebuild/total_electric_preview_handoff.md") ?? "";
    assert.match(handoff, /Not sent\./);
    assert.match(handoff, new RegExp(approved));
    assert.doesNotMatch(handoff, /[—–]/, "no em or en dashes in the client message");
    assert.ok(!handoff.includes("ghp_secret123") && !handoff.includes("vercel_secret456"));
  });

  it("a retry reuses the repo, project and deployment instead of making new ones", async () => {
    const api: FakeApi = { calls: [], repoExists: false, deployments: [] };
    const { run, handlers } = await runToPreview(api, [], false);
    assert.equal(run.stages.find((stage) => stage.id === "preview")?.status, "blocked");
    assert.match(run.stages.find((stage) => stage.id === "preview")?.blocker ?? "", /did not pass its checks.*Page \/contact/);
    assert.equal(run.previewUrl, undefined, "a preview that failed its checks is not handed off");

    const created = api.calls.filter((call) => call.method === "POST").length;
    store.resetForRetry(run.id, "preview");
    await advance(run.id, handlers, vaultDeps);
    assert.equal(api.calls.filter((call) => call.method === "POST").length, created, "no second repo, project or deployment");
  });

  it("blocks with the missing token named, before touching anything", async () => {
    const pushes: { args: readonly string[]; env: Record<string, string> }[] = [];
    const api: FakeApi = { calls: [], repoExists: false, deployments: [] };
    const { run } = await runToPreview(api, pushes);
    assert.equal(run.stages.find((stage) => stage.id === "preview")?.status, "complete");
    const noToken: PublishDeps = { ...publishDeps(api, pushes), env: () => ({}) };
    await assert.rejects(publish.ensurePrivateRepo("x", "y", noToken), /GITHUB_TOKEN is not set/);
    await assert.rejects(publish.ensureVercelProject("x", { owner: "a", name: "b", fullName: "a/b", private: true, defaultBranch: "main", htmlUrl: "" }, noToken), /VERCEL_API_TOKEN is not set/);
  });

  it("pauses before the next stage when the skill is disabled, keeping everything", async () => {
    const { run } = store.createOrReuseRun({ prospectId: "paused", company: "Paused Co", websiteUrl: "https://p.example", targetMarket: "x", location: "y", conversionGoal: "z", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1.2.0" });
    const plain: StageHandler = async (context) => ({ summary: `${context.stage} done`, artifactIds: [] });
    const handlers = Object.fromEntries(["workspace", "capture", "research", "hero", "build", "functions", "preview"].map((id) => [id, plain])) as Record<RebuildStageId, StageHandler>;
    let enabled = true;
    const deps: RunnerDeps = { ...vaultDeps, skillEnabled: async () => {
      const answer = enabled;
      // Disabled while the workspace stage is in hand: it finishes, the next one does not start.
      enabled = false;
      return answer;
    } };
    await advance(run.id, handlers, deps);
    const after = store.readRun(run.id);
    assert.equal(after.stages.find((stage) => stage.id === "workspace")?.status, "complete");
    assert.equal(after.stages.find((stage) => stage.id === "capture")?.status, "blocked");
    assert.match(after.stages.find((stage) => stage.id === "capture")?.blocker ?? "", /skill is disabled in Connectors → Skills/);

    enabled = true;
    store.resetForRetry(run.id, "capture");
    await advance(run.id, handlers, { ...vaultDeps, skillEnabled: async () => true });
    assert.equal(store.readRun(run.id).stages.find((stage) => stage.id === "capture")?.status, "complete");
  });
});

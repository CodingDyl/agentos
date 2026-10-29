import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { assembleChangeObjective, parseGithubRepo } from "../../../shared/ship-types";

/**
 * Ship, against a throwaway vault and real git. The claims that matter are
 * about the filesystem and the network boundary: which folder git runs in,
 * what ends up in a remote URL or a commit, and whether production can be
 * reached without the typed confirmation.
 */

const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agentos-ship-")));
const previous = {
  AGENTOS_ROOT: process.env.AGENTOS_ROOT,
  AGENTOS_UI_DIR: process.env.AGENTOS_UI_DIR,
  AGENTOS_CLIENT_PROJECTS_ROOT: process.env.AGENTOS_CLIENT_PROJECTS_ROOT,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
};

const vault = path.join(directory, "vault");
const clients = path.join(directory, "clients");
const site = path.join(clients, "demo");
const outside = path.join(directory, "outside");

process.env.AGENTOS_ROOT = vault;
process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
process.env.AGENTOS_CLIENT_PROJECTS_ROOT = clients;
delete process.env.GITHUB_TOKEN;
delete process.env.VERCEL_API_TOKEN;
delete process.env.VERCEL_TEAM_ID;

const { shipRouter } = await import("../routes");
const { guardProjectFolder, resolveInside, resolveShipRoot } = await import("../root");
const { addShipChange, listShipChanges, sendShipChanges } = await import("../changes");
const { githubTokenSource } = await import("../git");
const { deployShip, productionDeploymentBody, requestProductionDeployment } = await import("../deploy");
const { assertPushAllowed, productionConfirmed } = await import("../production-gate");
const { git } = await import("../../agentos/git");
const { defaultPublishDeps } = await import("../../website-rebuild/publish");

// The machine's own `gh` login must never be used by a test.
githubTokenSource.resolve = async () => undefined;

const app = express();
app.use("/api/projects/:slug/ship", express.json({ limit: "8mb" }));
app.use("/api/projects/:slug/ship", shipRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;

function projectMarkdown(name: string, repository: string, configuration = ""): string {
  return `# ${name}\n\n## Purpose\n\nA generated site.\n\n## Connected Systems\n\nLocal repository: ${repository}\n${configuration ? `\n## Configuration\n\n${configuration}\n` : ""}`;
}

async function writeVault() {
  await fs.mkdir(path.join(vault, "projects/demo"), { recursive: true });
  await fs.mkdir(path.join(vault, "projects/linked"), { recursive: true });
  await fs.mkdir(path.join(vault, "projects/escape"), { recursive: true });
  await fs.mkdir(site, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(
    path.join(vault, "projects/PORTFOLIO.md"),
    [
      "# Portfolio",
      "",
      "## Projects",
      "",
      "### Demo",
      "Type: Product",
      "State: Active",
      "Priority: High",
      "",
      "### Linked",
      "Type: Product",
      "State: Active",
      "Priority: High",
      "",
      "### Escape",
      "Type: Product",
      "State: Active",
      "Priority: High",
      "",
    ].join("\n"),
  );
  await fs.writeFile(path.join(vault, "projects/demo/PROJECT.md"), projectMarkdown("Demo", site));
  await fs.writeFile(path.join(site, "package.json"), JSON.stringify({ name: "demo-site", scripts: { dev: "next dev" } }));
  await fs.writeFile(path.join(site, "README.md"), "Demo site\n");
  await fs.writeFile(path.join(site, ".env.local"), "SECRET=hunter2\n");
  await fs.writeFile(path.join(site, ".env.example"), "SECRET=\n");
  await fs.writeFile(path.join(outside, "secret.txt"), "not yours\n");

  // A Local repository that is a symlink: judged by where it really points.
  await fs.mkdir(path.join(clients, "linked-real"), { recursive: true });
  await fs.symlink(path.join(clients, "linked-real"), path.join(clients, "linked"));
  await fs.writeFile(
    path.join(vault, "projects/linked/PROJECT.md"),
    projectMarkdown("Linked", path.join(clients, "linked"), "Vercel project: prj_linked\nVercel project name: linked-site"),
  );

  // A Local repository that points at the whole home directory.
  await fs.writeFile(path.join(vault, "projects/escape/PROJECT.md"), projectMarkdown("Escape", os.homedir()));
}

before(async () => {
  await writeVault();
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await fs.rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const json = (url: string, method = "GET", body?: unknown) =>
  fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A fetch that fails the test if anything reaches the network. */
const noNetwork = {
  ...defaultPublishDeps,
  fetch: (async () => {
    throw new Error("The network was reached.");
  }) as typeof fetch,
};

describe("ship helpers", () => {
  it("parses GitHub remotes and refuses shell-shaped or traversing input", () => {
    assert.equal(parseGithubRepo("CodingDyl/agentos")?.fullName, "CodingDyl/agentos");
    assert.equal(parseGithubRepo("https://github.com/CodingDyl/agentos.git")?.cloneUrl, "https://github.com/CodingDyl/agentos.git");
    assert.equal(parseGithubRepo("git@github.com:CodingDyl/agentos.git")?.htmlUrl, "https://github.com/CodingDyl/agentos");
    assert.equal(parseGithubRepo("https://github.com/foo/bar.git; rm -rf /"), undefined);
    assert.equal(parseGithubRepo("foo/$(whoami)"), undefined);
    assert.equal(parseGithubRepo("foo/.."), undefined);
    assert.equal(parseGithubRepo("--upload-pack=touch/x"), undefined);
    assert.equal(parseGithubRepo("https://evil.example/foo/bar"), undefined);
  });

  it("builds one Execute objective from selected change items", () => {
    const objective = assembleChangeObjective([
      { text: "Make the hero tighter", page: "/", priority: "high" },
      { text: "Swap the CTA copy", url: "http://127.0.0.1:3000/pricing", priority: "medium" },
    ]);
    assert.match(objective, /1\. \(high\) Make the hero tighter — \//);
    assert.match(objective, /2\. \(medium\) Swap the CTA copy/);
    assert.match(objective, /Do not invent extra scope/);
  });
});

describe("ship project folder", () => {
  it("uses the workspace's Local repository", async () => {
    assert.equal(await resolveShipRoot("demo"), site);
  });

  it("resolves a symlinked Local repository to the folder it points at", async () => {
    assert.equal(await resolveShipRoot("linked"), path.join(clients, "linked-real"));
  });

  it("refuses a folder as broad as the home directory", async () => {
    await assert.rejects(resolveShipRoot("escape"), /too broad/);
    await assert.rejects(guardProjectFolder(os.homedir()), /too broad/);
    await assert.rejects(guardProjectFolder(vault), /too broad/);
    await assert.rejects(guardProjectFolder(path.parse(directory).root), /too broad/);
  });

  it("ignores relative and missing folders rather than resolving them against the server's cwd", async () => {
    assert.equal(await guardProjectFolder("projects/demo"), undefined);
    assert.equal(await guardProjectFolder(path.join(directory, "missing")), undefined);
  });

  it("refuses paths that climb out of the project, directly or through a symlink", async () => {
    await assert.rejects(resolveInside(site, "../outside/secret.txt"), /outside the project/);
    await assert.rejects(resolveInside(site, "/etc/passwd"), /outside the project/);
    await fs.symlink(outside, path.join(site, "escape-link"));
    try {
      await assert.rejects(resolveInside(site, "escape-link/secret.txt"), /outside the project/);
      await assert.rejects(resolveInside(site, "escape-link/new-file"), /outside the project/);
    } finally {
      await fs.rm(path.join(site, "escape-link"));
    }
    assert.equal(await resolveInside(site, "app/page.tsx"), path.join(site, "app/page.tsx"));
  });

  it("returns 404 for a slug or change id that is not one Ship minted", async () => {
    for (const url of [
      `${base}/missing/ship`,
      `${base}/..%2F..%2Fetc/ship`,
      `${base}/demo/ship/changes/..%2F..%2F..%2Fsecret/screenshot`,
      `${base}/demo/ship/changes/chg_nothex/screenshot`,
    ]) {
      const response = await json(url);
      assert.equal(response.status, 404, url);
    }
    const patched = await json(`${base}/demo/ship/changes/..%2Fx`, "PATCH", { selected: true });
    assert.equal(patched.status, 404);
  });
});

describe("ship HTTP", () => {
  it("returns a snapshot with the shared dev server and the setup hints", async () => {
    const response = await json(`${base}/demo/ship`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      slug: string;
      git: { folder?: string; isRepo: boolean };
      dev: { status: string; folder?: string; plan?: { ok: boolean; command?: string } };
      auth: { github: boolean; vercel: boolean; githubHint: string; vercelHint: string };
    };
    assert.equal(body.slug, "demo");
    assert.equal(body.git.folder, site);
    assert.equal(body.dev.status, "stopped");
    assert.equal(body.dev.folder, site);
    assert.equal(body.dev.plan?.command, "npm run dev");
    assert.equal(body.auth.vercel, false);
    assert.equal(body.auth.github, false);
    assert.match(body.auth.githubHint, /GITHUB_TOKEN|gh auth/);
    assert.match(body.auth.vercelHint, /VERCEL_API_TOKEN/);
  });

  it("validates every body: unknown fields on a no-body action, wrong types, and non-JSON", async () => {
    assert.equal((await json(`${base}/demo/ship/git/init`, "POST", { cwd: "/" })).status, 400);
    assert.equal((await json(`${base}/demo/ship/git/link`, "POST", { repo: 42 })).status, 400);
    assert.equal((await json(`${base}/demo/ship/deploy`, "POST", { target: "staging" })).status, 400);
    const form = await fetch(`${base}/demo/ship/git/init`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" });
    assert.equal(form.status, 415);
  });

  it("inits the folder without committing .env files, then reports dirty state", async () => {
    const init = await json(`${base}/demo/ship/git/init`, "POST", {});
    assert.equal(init.status, 200);
    const state = ((await init.json()) as { git: { isRepo: boolean; branch?: string; dirty: boolean; subject?: string } }).git;
    assert.equal(state.isRepo, true);
    assert.ok(state.branch);
    assert.equal(state.dirty, false);
    assert.match(state.subject ?? "", /Start the project/);

    const tracked = (await git(site, ["ls-files"])).stdout.split("\n");
    assert.ok(tracked.includes("package.json"));
    assert.ok(tracked.includes(".env.example"));
    assert.ok(!tracked.includes(".env.local"), "a .env file was committed");

    await fs.writeFile(path.join(site, "note.txt"), "dirty\n");
    const after = ((await (await json(`${base}/demo/ship/git`)).json()) as { git: { dirty: boolean; changedFiles: string[] } }).git;
    assert.equal(after.dirty, true);
    assert.ok(after.changedFiles.includes("note.txt"));
  });

  it("refuses GitHub create and a Vercel deploy when tokens are missing", async () => {
    const created = await json(`${base}/demo/ship/git/create`, "POST", { name: "demo-site" });
    assert.equal(created.status, 409);
    assert.match(((await created.json()) as { error: string }).error, /GITHUB_TOKEN|gh auth/);

    // Linked to a project but without a token: refused before anything else happens.
    const deploy = await json(`${base}/linked/ship/deploy`, "POST", { target: "preview" });
    assert.equal(deploy.status, 409);
    assert.match(((await deploy.json()) as { error: string }).error, /VERCEL_API_TOKEN/);
  });

  it("never writes a token into the git remote when linking", async () => {
    process.env.GITHUB_TOKEN = "ghp_testtokenthatmustnotleak";
    try {
      const linked = await json(`${base}/demo/ship/git/link`, "POST", { repo: "https://github.com/acme/demo-site.git" });
      assert.equal(linked.status, 200);
      const text = await linked.text();
      assert.doesNotMatch(text, /ghp_testtokenthatmustnotleak/);
      const remote = await git(site, ["config", "--local", "--get", "remote.origin.url"]);
      assert.equal(remote.stdout.trim(), "https://github.com/acme/demo-site.git");
      const config = await fs.readFile(path.join(site, ".git/config"), "utf8");
      assert.doesNotMatch(config, /ghp_|x-access-token|extraheader/i);
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("refuses to link a repository given as shell syntax", async () => {
    const response = await json(`${base}/demo/ship/git/link`, "POST", { repo: "acme/site; touch /tmp/pwned" });
    assert.equal(response.status, 400);
  });

  it("keeps a change list and sends selected items as one Execute job", async () => {
    const added = await json(`${base}/demo/ship/changes`, "POST", { text: "Tighten the hero", page: "/", priority: "high" });
    assert.equal(added.status, 201);
    const change = ((await added.json()) as { change: { id: string; selected: boolean } }).change;
    assert.equal(change.selected, true);
    assert.match(change.id, /^chg_[0-9a-f]{16}$/);

    const patched = await json(`${base}/demo/ship/changes/${change.id}`, "PATCH", { selected: true });
    assert.equal(patched.status, 200);
    // Fields Ship owns (the job link, the id) cannot be patched in.
    assert.equal((await json(`${base}/demo/ship/changes/${change.id}`, "PATCH", { jobId: "job_x" })).status, 400);

    let captured: { modelRouteType?: string; objective: string; project: string; repoPath?: string } | undefined;
    const result = await sendShipChanges("demo", [change.id], async (request) => {
      captured = request;
      return { job: { id: "job_ship_test", status: "queued", project: request.project, objective: request.objective } as never };
    });
    assert.equal(result.jobId, "job_ship_test");
    assert.equal(captured?.modelRouteType, "execute");
    assert.equal(captured?.project, "demo");
    assert.equal(captured?.repoPath, site);
    assert.match(captured?.objective ?? "", /Tighten the hero/);
    const items = await listShipChanges("demo");
    assert.equal(items.find((item) => item.id === change.id)?.status, "in_progress");
    assert.equal(items.find((item) => item.id === change.id)?.jobId, "job_ship_test");
  });

  it("rejects a change with empty text", async () => {
    const response = await json(`${base}/demo/ship/changes`, "POST", { text: "  " });
    assert.equal(response.status, 400);
  });

  it("stores a screenshot in AgentOS' state, not the project, and refuses bytes that are not an image", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const added = await addShipChange("demo", { text: "Fix the footer", screenshot: png, priority: "low" });
    assert.ok(added.screenshotId);
    const shot = path.join(process.env.AGENTOS_UI_DIR!, "ship", "demo", "shots", `${added.screenshotId}.png`);
    assert.ok(await fs.readFile(shot));
    const served = await json(`${base}/demo/ship/changes/${added.id}/screenshot`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.ok(!(await fs.readdir(site)).includes("shots"));

    const html = `data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;
    await assert.rejects(addShipChange("demo", { text: "Sneaky", screenshot: html }), /PNG, JPEG or WebP/);
  });
});

describe("production deploys", () => {
  const linked = { id: "prj_linked", name: "linked-site" };

  it("asks Vercel for production, not a preview", () => {
    const body = productionDeploymentBody({ id: "prj_1", name: "demo" }, { owner: "acme", name: "site" }, "main", "abc1234");
    assert.equal(body.target, "production");
    assert.equal(body.gitSource.ref, "main");
    assert.equal(body.gitSource.sha, "abc1234");
  });

  it("accepts only the project's name or id as confirmation", () => {
    assert.equal(productionConfirmed(linked, "linked-site"), true);
    assert.equal(productionConfirmed(linked, " prj_linked "), true);
    assert.equal(productionConfirmed(linked, "yes"), false);
    assert.equal(productionConfirmed(linked, ""), false);
    assert.equal(productionConfirmed(linked, undefined), false);
  });

  it("refuses a production deploy request without a confirmation at all", async () => {
    const response = await json(`${base}/linked/ship/deploy`, "POST", { target: "production" });
    assert.equal(response.status, 400);
  });

  it("refuses a wrong confirmation before anything touches the network, even with a token", async () => {
    process.env.VERCEL_API_TOKEN = "vercel_test_token";
    try {
      await assert.rejects(deployShip("linked", { target: "production", confirm: "yes" }, noNetwork), (error: Error & { status?: number }) => {
        assert.equal(error.status, 428);
        assert.match(error.message, /Type the Vercel project name/);
        return true;
      });
      const response = await json(`${base}/linked/ship/deploy`, "POST", { target: "production", confirm: "linked" });
      assert.equal(response.status, 428);
      assert.doesNotMatch(await response.text(), /vercel_test_token/);
    } finally {
      delete process.env.VERCEL_API_TOKEN;
    }
  });

  it("sends one production request with the token only as a header", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const deps = {
      ...defaultPublishDeps,
      env: () => ({ VERCEL_API_TOKEN: "vercel_test_token" }) as NodeJS.ProcessEnv,
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "dpl_1", url: "linked-site.vercel.app", readyState: "QUEUED", target: "production" }), { status: 200 });
      }) as typeof fetch,
    };
    const deployment = await requestProductionDeployment(linked, { owner: "acme", name: "site", fullName: "acme/site" }, "main", "abc1234def", deps);
    assert.equal(deployment.id, "dpl_1");
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].url, /vercel_test_token/);
    assert.doesNotMatch(String(calls[0].init?.body), /vercel_test_token/);
    assert.equal(JSON.parse(String(calls[0].init?.body)).target, "production");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer vercel_test_token");
  });

  it("gates a push of the production branch behind the same confirmation", async () => {
    // Vercel is not configured, so the production branch is taken to be main: the gate fails towards asking.
    await assert.rejects(assertPushAllowed("linked", "main", undefined), /Type the Vercel project name/);
    await assert.rejects(assertPushAllowed("linked", "main", "nope"), /Type the Vercel project name/);
    await assertPushAllowed("linked", "main", "linked-site");
    await assertPushAllowed("linked", "feature/hero", undefined);
    // No Vercel project linked: a push is just a push.
    await assertPushAllowed("demo", "main", undefined);

    const response = await json(`${base}/linked/ship/git/push`, "POST", {});
    assert.notEqual(response.status, 200);
  });

  it("is reachable only from the deploy route: nothing in Ship's job or Motion paths calls it", async () => {
    const shipFiles = await fs.readdir(path.join(import.meta.dirname, ".."));
    for (const file of shipFiles.filter((name) => name.endsWith(".ts"))) {
      const source = await fs.readFile(path.join(import.meta.dirname, "..", file), "utf8");
      if (file === "deploy.ts" || file === "routes.ts") continue;
      assert.doesNotMatch(source, /deployShip|requestProductionDeployment/, file);
    }
    for (const file of ["../../motion-design/launch.ts", "../../workers/job-manager.ts"]) {
      const source = await fs.readFile(path.join(import.meta.dirname, file), "utf8");
      assert.doesNotMatch(source, /ship\/deploy|deployShip|deploy_production/, file);
    }
  });
});

describe("no shell", () => {
  it("runs every process in server/ship with an argument array and never a shell", async () => {
    for (const file of (await fs.readdir(path.join(import.meta.dirname, ".."))).filter((name) => name.endsWith(".ts"))) {
      const source = await fs.readFile(path.join(import.meta.dirname, "..", file), "utf8");
      assert.doesNotMatch(source, /shell:\s*true/, file);
      // child_process.exec and the *Sync forms all go through a shell; RegExp's `.exec(` is not one of them.
      assert.doesNotMatch(source, /(?<![.\w])exec\(|execSync\(|spawnSync\(|from "node:child_process".*\bexec\b/, file);
    }
    for (const file of ["../../dev-server/manager.ts", "../../agentos/git.ts", "../../coder/git-operations.ts"]) {
      const source = await fs.readFile(path.join(import.meta.dirname, file), "utf8");
      assert.doesNotMatch(source, /shell:\s*true/, file);
    }
  });

  it("cannot be made to run git in an arbitrary folder: the folder is never read from a request", async () => {
    const before = await fs.readdir(outside);
    const response = await json(`${base}/demo/ship/git/init`, "POST", { folder: outside });
    assert.equal(response.status, 400);
    assert.deepEqual(await fs.readdir(outside), before);
    await assert.rejects(fs.access(path.join(outside, ".git")));
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  assembleChangeObjective,
  detectPreviewPort,
  parseGithubRepo,
} from "../../../shared/ship-types";
import { productionDeploymentBody } from "../deploy";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-ship-"));
const previous = {
  AGENTOS_ROOT: process.env.AGENTOS_ROOT,
  AGENTOS_UI_DIR: process.env.AGENTOS_UI_DIR,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
};

process.env.AGENTOS_ROOT = path.join(directory, "vault");
process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
delete process.env.GITHUB_TOKEN;
delete process.env.VERCEL_API_TOKEN;

const { shipRouter } = await import("../routes");
const { resolveShipRoot } = await import("../root");
const { sendShipChanges, addShipChange, listShipChanges } = await import("../changes");
const { initShipRepo } = await import("../git");
const { git } = await import("../../agentos/git");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/projects/:slug/ship", shipRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}/api/projects`;

async function writeVault() {
  const vault = process.env.AGENTOS_ROOT!;
  await fs.mkdir(path.join(vault, "projects/demo/site"), { recursive: true });
  await fs.writeFile(
    path.join(vault, "projects/PORTFOLIO.md"),
    "# Portfolio\n\n## Projects\n\n### Demo\nType: Product\nState: Active\nPriority: High\n",
  );
  await fs.writeFile(
    path.join(vault, "projects/demo/PROJECT.md"),
    "# Demo\n\n## Purpose\n\nA generated site.\n\n## Connected Systems\n\nLocal repository: projects/demo/site\n",
  );
  await fs.writeFile(
    path.join(vault, "projects/demo/site/package.json"),
    JSON.stringify({ name: "demo-site", scripts: { dev: "next dev" } }),
  );
  await fs.writeFile(path.join(vault, "projects/demo/site/README.md"), "Demo site\n");
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

describe("ship helpers", () => {
  it("reads a preview port from Next and Vite log lines", () => {
    assert.equal(detectPreviewPort("Local: http://localhost:3000"), 3000);
    assert.equal(detectPreviewPort("  ➜  Local:   http://127.0.0.1:5173/"), 5173);
    assert.equal(detectPreviewPort("ready started server on 0.0.0.0:4000"), 4000);
    assert.equal(detectPreviewPort("nothing listening"), undefined);
  });

  it("parses GitHub remotes and rejects shell-shaped input", () => {
    assert.deepEqual(parseGithubRepo("CodingDyl/agentos")?.fullName, "CodingDyl/agentos");
    assert.equal(parseGithubRepo("https://github.com/CodingDyl/agentos.git")?.cloneUrl, "https://github.com/CodingDyl/agentos.git");
    assert.equal(parseGithubRepo("git@github.com:CodingDyl/agentos.git")?.htmlUrl, "https://github.com/CodingDyl/agentos");
    assert.equal(parseGithubRepo("https://github.com/foo/bar.git; rm -rf /"), undefined);
  });

  it("builds one execute objective from selected change items", () => {
    const objective = assembleChangeObjective([
      { text: "Make the hero tighter", page: "/", priority: "high" },
      { text: "Swap the CTA copy", url: "http://127.0.0.1:3000/pricing", priority: "medium" },
    ]);
    assert.match(objective, /1\. \(high\) Make the hero tighter — \//);
    assert.match(objective, /2\. \(medium\) Swap the CTA copy/);
    assert.match(objective, /Do not invent extra scope/);
  });

  it("asks Vercel for production, not a preview", () => {
    const body = productionDeploymentBody({ id: "prj_1", name: "demo" }, { owner: "acme", name: "site" }, "main", "abc1234");
    assert.equal(body.target, "production");
    assert.equal(body.gitSource.ref, "main");
    assert.equal(body.gitSource.sha, "abc1234");
  });
});

describe("ship project root", () => {
  it("prefers the generated site folder when it has a package.json", async () => {
    const root = await resolveShipRoot("demo");
    assert.equal(root, path.join(process.env.AGENTOS_ROOT!, "projects/demo/site"));
  });

  it("returns undefined for an unknown workspace", async () => {
    assert.equal(await resolveShipRoot("missing"), undefined);
  });
});

describe("ship HTTP", () => {
  it("404s an unknown workspace", async () => {
    const response = await json(`${base}/missing/ship`);
    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as { error: string }).error, "That workspace was not found.");
  });

  it("returns a snapshot for a generated project folder", async () => {
    const response = await json(`${base}/demo/ship`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      slug: string;
      git: { folder?: string; isRepo: boolean };
      auth: { github: boolean; vercel: boolean; githubHint: string; vercelHint: string };
    };
    assert.equal(body.slug, "demo");
    assert.ok(body.git.folder?.endsWith(`${path.sep}site`));
    assert.equal(body.auth.vercel, false);
    assert.match(body.auth.githubHint, /GITHUB_TOKEN|gh auth/);
    assert.match(body.auth.vercelHint, /VERCEL_API_TOKEN/);
  });

  it("inits the folder, then reports branch and dirty state", async () => {
    const init = await json(`${base}/demo/ship/git/init`, "POST", {});
    assert.equal(init.status, 200);
    const gitBody = (await init.json()) as { git: { isRepo: boolean; branch?: string; dirty: boolean; subject?: string } };
    assert.equal(gitBody.git.isRepo, true);
    assert.ok(gitBody.git.branch);
    assert.equal(gitBody.git.dirty, false);
    assert.match(gitBody.git.subject ?? "", /Start the project/);

    await fs.writeFile(path.join(process.env.AGENTOS_ROOT!, "projects/demo/site/note.txt"), "dirty\n");
    const status = await json(`${base}/demo/ship/git`);
    const after = (await status.json()) as { git: { dirty: boolean; changedFiles: string[] } };
    assert.equal(after.git.dirty, true);
    assert.ok(after.git.changedFiles.includes("note.txt"));
  });

  it("refuses a GitHub create and a Vercel deploy when tokens are missing", async () => {
    const created = await json(`${base}/demo/ship/git/create`, "POST", { name: "demo-site" });
    assert.equal(created.status, 409);
    assert.match(((await created.json()) as { error: string }).error, /GITHUB_TOKEN|gh auth|GitHub|token|permissions/i);

    const deploy = await json(`${base}/demo/ship/deploy`, "POST", { target: "production" });
    assert.equal(deploy.status, 409);
    assert.match(((await deploy.json()) as { error: string }).error, /VERCEL_API_TOKEN/);
  });

  it("does not write a token into the git remote when linking", async () => {
    const folder = path.join(process.env.AGENTOS_ROOT!, "projects/demo/site");
    if (!(await fs.stat(path.join(folder, ".git")).catch(() => undefined))) {
      await initShipRepo("demo");
    }
    const linked = await json(`${base}/demo/ship/git/link`, "POST", { repo: "https://github.com/acme/demo-site.git" });
    assert.equal(linked.status, 200);
    const remote = await git(folder, ["config", "--local", "--get", "remote.origin.url"]);
    assert.equal(remote.stdout.trim(), "https://github.com/acme/demo-site.git");
    assert.doesNotMatch(remote.stdout, /x-access-token|ghp_|github_pat_|GITHUB_TOKEN/);
  });

  it("keeps a change checklist and sends selected items as one Execute job", async () => {
    const added = await json(`${base}/demo/ship/changes`, "POST", {
      text: "Tighten the hero",
      page: "/",
      priority: "high",
    });
    assert.equal(added.status, 201);
    const change = ((await added.json()) as { change: { id: string; selected: boolean } }).change;
    assert.equal(change.selected, true);

    const patched = await json(`${base}/demo/ship/changes/${change.id}`, "PATCH", { selected: true });
    assert.equal(patched.status, 200);

    let captured: { modelRouteType?: string; objective: string; project: string } | undefined;
    const result = await sendShipChanges("demo", [change.id], async (request) => {
      captured = request;
      return { job: { id: "job_ship_test", status: "queued", project: request.project, objective: request.objective } as never };
    });
    assert.equal(result.jobId, "job_ship_test");
    assert.equal(captured?.modelRouteType, "execute");
    assert.equal(captured?.project, "demo");
    assert.match(captured?.objective ?? "", /Tighten the hero/);
    const items = await listShipChanges("demo");
    assert.equal(items.find((item) => item.id === change.id)?.status, "in_progress");
    assert.equal(items.find((item) => item.id === change.id)?.jobId, "job_ship_test");
  });

  it("rejects a change with empty text", async () => {
    const response = await json(`${base}/demo/ship/changes`, "POST", { text: "" });
    assert.equal(response.status, 400);
  });

  it("stores an optional screenshot next to the change, not in the project repo", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const added = await addShipChange("demo", { text: "Fix the footer", screenshot: png, priority: "low" });
    assert.ok(added.screenshotId);
    const shot = path.join(process.env.AGENTOS_UI_DIR!, "ship", "demo", "shots", `${added.screenshotId}.png`);
    assert.ok(await fs.readFile(shot));
    const repoFiles = await fs.readdir(path.join(process.env.AGENTOS_ROOT!, "projects/demo/site"));
    assert.ok(!repoFiles.includes("shots"));
  });
});

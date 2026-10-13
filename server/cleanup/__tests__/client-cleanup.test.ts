import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { GithubRepoFacts, VercelProjectFacts } from "../../website-rebuild/publish";

const directory = mkdtempSync(path.join(os.tmpdir(), "agentos-cleanup-"));
const vault = path.join(directory, "vault");
const clients = path.join(directory, "clients");
process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
process.env.AGENTOS_ROOT = vault;
process.env.AGENTOS_CLIENT_SITES_DIR = clients;

const { CleanupError, cleanupEligibility, listCleanupCandidates, previewCleanup, runCleanup } = await import("../client-cleanup");
const store = await import("../../traction/store");
const rebuild = await import("../../website-rebuild/store");
const { git } = await import("../../website-rebuild/client-repo");
const { ProspectInputSchema } = await import("../../../shared/traction-types");
type Deps = import("../client-cleanup").CleanupDeps;

before(() => {
  mkdirSync(path.join(vault, "projects"), { recursive: true });
  mkdirSync(clients, { recursive: true });
});
after(() => {
  rebuild.closeRebuildDatabase();
  rmSync(directory, { recursive: true, force: true });
});

// ─── A fake GitHub and Vercel that remember what they were asked ───────────

interface Remote {
  repo: GithubRepoFacts | undefined | "throws";
  project: VercelProjectFacts | undefined | "throws";
  calls: string[];
  failRepoDelete?: boolean;
}

function remote(over: Partial<Remote> = {}): Remote {
  return { repo: undefined, project: undefined, calls: [], ...over };
}

function depsFor(fake: Remote, overrides: Partial<Deps> = {}): Deps {
  return {
    now: () => new Date(),
    vaultRoot: () => vault,
    clientSitesRoot: () => clients,
    git,
    publish: {
      inspectGithubRepo: async (name) => {
        fake.calls.push(`inspect repo ${name}`);
        if (fake.repo === "throws") throw new Error("GitHub could not be reached.");
        return fake.repo;
      },
      deleteGithubRepo: async (name) => {
        fake.calls.push(`DELETE repo ${name}`);
        if (fake.failRepoDelete) throw new Error("GitHub said: Must have admin rights to Repository.");
      },
      inspectVercelProject: async (id) => {
        fake.calls.push(`inspect project ${id}`);
        if (fake.project === "throws") throw new Error("Vercel could not be reached.");
        return fake.project;
      },
      deleteVercelProject: async (id) => {
        fake.calls.push(`DELETE project ${id}`);
      },
    },
    capabilityAllowed: () => undefined,
    ...overrides,
  };
}

// ─── A client with work built for them ──────────────────────────────────────

let counter = 0;

function makeRepo(dir: string, options: { author?: string; date?: Date } = {}): void {
  const author = options.author ?? "AgentOS";
  const date = (options.date ?? new Date()).toISOString();
  const env = { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@localhost`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@localhost`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  writeFileSync(path.join(dir, "index.html"), "<h1>site</h1>".repeat(400));
  execFileSync("git", ["add", "."], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "first"], { cwd: dir, env });
}

interface Scenario {
  id: string;
  company: string;
  slug: string;
  siteDir: string;
  workspaceDir: string;
  run: import("../../../shared/website-rebuild-types").RebuildRun;
}

async function scenario(options: { stage?: "lost" | "contacted" | "target"; workspace?: "created" | "reused" | "none"; repo?: "agentos" | "foreign" | "old" | "none"; github?: "created" | "existing" | "none"; vercel?: boolean; repoPath?: string } = {}): Promise<Scenario> {
  counter += 1;
  const company = `Client ${counter}`;
  const slug = `client-${counter}`;
  const prospect = await store.createProspect(ProspectInputSchema.parse({ company, email: `owner@client${counter}.example`, stage: "target" }));
  if ((options.stage ?? "lost") !== "target") await store.updateProspect(prospect.id, { stage: options.stage ?? "lost" });

  const { run } = rebuild.createOrReuseRun({ prospectId: prospect.id, company, websiteUrl: "https://x.example", targetMarket: "m", location: "l", conversionGoal: "g", requiredFunctions: [], designTemplate: "d", skillVersion: "1.0.0" });

  const workspaceDir = path.join(vault, "projects", slug);
  if (options.workspace !== "none") {
    mkdirSync(path.join(workspaceDir, "docs/website-rebuild/screens"), { recursive: true });
    writeFileSync(path.join(workspaceDir, "PROJECT.md"), "# project\n");
    writeFileSync(path.join(workspaceDir, "docs/website-rebuild/research.md"), "report ".repeat(100));
    writeFileSync(path.join(workspaceDir, "docs/website-rebuild/screens/home.png"), Buffer.alloc(4096));
    rebuild.setRunField(run.id, "workspace_slug", slug);
    rebuild.logEvent(run.id, "workspace", "info", options.workspace === "reused" ? `Reusing the existing workspace ${slug}.` : `Created the workspace ${slug}.`);
  }

  const siteDir = options.repoPath ?? path.join(clients, slug);
  if (options.repo !== "none") {
    if (!options.repoPath) {
      if (options.repo === "foreign") makeRepo(siteDir, { author: "Dylan" });
      else if (options.repo === "old") makeRepo(siteDir, { date: new Date(Date.now() - 30 * 86_400_000) });
      else makeRepo(siteDir);
    }
    rebuild.setRunField(run.id, "repo_path", siteDir);
  }

  if (options.github !== "none") {
    rebuild.setRunField(run.id, "github_repo", `owner/${slug}`);
    rebuild.logEvent(run.id, "preview", "info", options.github === "existing" ? `Using the existing private repo owner/${slug}.` : `Created the private repo owner/${slug}.`);
  }
  if (options.vercel !== false) rebuild.setRunField(run.id, "vercel_project", "prj_abc123");

  return { id: prospect.id, company, slug, siteDir, workspaceDir, run: rebuild.readRun(run.id) };
}

const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const freshRemote = (s: Scenario): Remote =>
  remote({
    repo: { fullName: `owner/${s.slug}`, private: true, createdAt: later(1000) },
    project: { id: "prj_abc123", name: s.slug, createdAt: Date.parse(later(1000)), linkedRepo: `owner/${s.slug}` },
  });
const stateOf = (preview: { items: { id: string; state: string; reason?: string }[] }, id: string) => preview.items.find((entry) => entry.id === id);

// ═══════════════════════════════════════════════════════════════════════════

describe("who qualifies", () => {
  const NOW = new Date("2026-11-30T12:00:00Z");
  const day = (ago: number) => new Date(NOW.getTime() - ago * 86_400_000).toISOString();
  const prospect = (over: Record<string, unknown> = {}) => ({ id: "p1", company: "Co", email: "a@co.example", stage: "contacted", reasons: [], stageChangedAt: day(40), ...over }) as never;
  const sends = (...ago: number[]) => ago.map((daysAgo, index) => ({ id: `s${index}`, prospectId: "p1", kind: "manual", to: "a@co.example", subject: "s", at: day(daysAgo) }));
  const stateOf2 = (p: unknown, over: Record<string, unknown> = {}) => ({ prospects: [p], outreachLog: [], outreachReplies: [], suppressions: [], ...over }) as never;
  const verdict = (p: unknown, over: Record<string, unknown> = {}, events: unknown[] = [], rebuildActive = false) => cleanupEligibility({ prospect: p as never, state: stateOf2(p, over), events: events as never, now: NOW, rebuildActive });

  it("accepts three unanswered emails with the last at least 14 days ago", () => {
    const v = verdict(prospect(), { outreachLog: sends(30, 25, 20) });
    assert.equal(v.eligible, true);
    assert.match(String(v.qualifiedBecause), /20 days ago/);
  });

  it("makes you wait 14 days after the last email", () => {
    const v = verdict(prospect(), { outreachLog: sends(30, 25, 9) });
    assert.equal(v.eligible, false);
    assert.match(v.reasons.join(" "), /Wait until 2026-12-0\d/);
  });

  it("refuses someone still in the follow-up sequence", () => {
    const v = verdict(prospect(), { outreachLog: sends(30) });
    assert.match(v.reasons.join(" "), /still in the follow-up sequence/);
  });

  it("refuses anyone who wrote back, in any stage", () => {
    const replied = { outreachLog: sends(30, 25, 20), outreachReplies: [{ id: "r", threadId: "t", prospectId: "p1", fromEmail: "A@co.example", subject: "Re", text: "hi", at: day(22) }] };
    assert.match(verdict(prospect(), replied).reasons.join(" "), /written back/);
    assert.match(verdict(prospect({ stage: "lost" }), replied).reasons.join(" "), /written back/);
  });

  it("refuses anyone who was ever in conversation, even if now closed", () => {
    const event = { id: "e", at: day(30), prospectId: "p1", kind: "stage_changed", from: "contacted", to: "conversation" };
    assert.match(verdict(prospect({ stage: "lost" }), {}, [event]).reasons.join(" "), /interest/);
    const other = { ...event, prospectId: "someone-else" };
    assert.equal(verdict(prospect({ stage: "lost" }), {}, [other]).eligible, true, "another business's history does not count");
  });

  it("refuses a business that is not contacted or lost, a Virtec client, and one whose rebuild is running", () => {
    for (const stage of ["target", "conversation", "proposal", "won"]) assert.equal(verdict(prospect({ stage })).eligible, false, stage);
    assert.match(verdict(prospect({ stage: "lost", crmId: "virtec:client:abc" })).reasons.join(" "), /client in Virtec/);
    assert.match(verdict(prospect({ stage: "lost" }), {}, [], true).reasons.join(" "), /still running/);
  });

  it("accepts a business closed without ever showing interest, with no waiting", () => {
    const v = verdict(prospect({ stage: "lost" }));
    assert.equal(v.eligible, true);
    assert.match(String(v.qualifiedBecause), /never showed interest/);
  });
});

describe("the preview", () => {
  it("lists everything, with sizes, and ticks only what stays on your machine", async () => {
    const s = await scenario();
    const preview = await previewCleanup(s.id, depsFor(freshRemote(s)));

    assert.equal(preview.eligible, true);
    assert.deepEqual(preview.items.map((entry) => [entry.id, entry.state]), [["github_repo", "ready"], ["vercel_project", "ready"], ["local_site", "ready"], ["workspace", "ready"], ["records", "ready"]]);
    assert.deepEqual(preview.items.map((entry) => [entry.id, entry.defaultChecked]), [["github_repo", false], ["vercel_project", false], ["local_site", true], ["workspace", true], ["records", true]]);
    assert.ok((stateOf(preview, "local_site") as { bytes?: number }).bytes! > 1000);
    assert.ok((stateOf(preview, "workspace") as { bytes?: number }).bytes! >= 4096);
    assert.match(preview.keeps.join(" "), /Every email you sent/);
  });

  it("deletes nothing", async () => {
    const s = await scenario();
    const fake = freshRemote(s);
    await previewCleanup(s.id, depsFor(fake));
    assert.ok(existsSync(s.siteDir) && existsSync(s.workspaceDir));
    assert.ok(fake.calls.every((call) => call.startsWith("inspect")), fake.calls.join());
    assert.ok(rebuild.runForProspect(s.id));
  });

  it("says why not, and lists nothing, for a business that does not qualify", async () => {
    const s = await scenario({ stage: "target" });
    const preview = await previewCleanup(s.id, depsFor(remote()));
    assert.equal(preview.eligible, false);
    assert.deepEqual(preview.items, []);
    assert.match(preview.ineligibleReasons.join(" "), /never showed interest/);
  });

  it("warns about uncommitted changes and about files in the workspace that are not reports", async () => {
    const s = await scenario();
    writeFileSync(path.join(s.siteDir, "unsaved.txt"), "new");
    writeFileSync(path.join(s.workspaceDir, "my-notes.md"), "notes");
    const preview = await previewCleanup(s.id, depsFor(remote()));
    assert.match(stateOf(preview, "local_site") ? preview.items.find((entry) => entry.id === "local_site")!.warnings.join(" ") : "", /1 file has changes that are not saved/);
    assert.match(preview.items.find((entry) => entry.id === "workspace")!.warnings.join(" "), /1 file that are not rebuild reports.*my-notes\.md/);
  });
});

describe("refusing to delete what AgentOS did not make", () => {
  it("never deletes a site folder that existed before: another author's first commit", async () => {
    const s = await scenario({ repo: "foreign" });
    const preview = await previewCleanup(s.id, depsFor(remote()));
    assert.equal(stateOf(preview, "local_site")?.state, "blocked");
    assert.match(String(stateOf(preview, "local_site")?.reason), /existed before/);
    await assert.rejects(runCleanup(s.id, { items: ["local_site"], confirm: true }, depsFor(remote())), (error: unknown) => error instanceof CleanupError && error.status === 409);
    assert.ok(existsSync(path.join(s.siteDir, "index.html")), "the folder is untouched");
  });

  it("never deletes a folder AgentOS began before this rebuild started", async () => {
    const s = await scenario({ repo: "old" });
    assert.equal(stateOf(await previewCleanup(s.id, depsFor(remote())), "local_site")?.state, "blocked");
  });

  it("only removes the rebuild's own reports from a workspace that was already there", async () => {
    const s = await scenario({ workspace: "reused" });
    writeFileSync(path.join(s.workspaceDir, "tasks.md"), "real work");
    const preview = await previewCleanup(s.id, depsFor(remote()));
    assert.match(String(stateOf(preview, "workspace")?.state), /ready/);
    assert.match(preview.items.find((entry) => entry.id === "workspace")!.label, /Rebuild reports and screenshots in/);

    const result = await runCleanup(s.id, { items: ["workspace"], confirm: true }, depsFor(remote()));
    assert.equal(result.results[0].status, "deleted");
    assert.ok(!existsSync(path.join(s.workspaceDir, "docs/website-rebuild")), "the reports are gone");
    assert.ok(existsSync(path.join(s.workspaceDir, "PROJECT.md")) && existsSync(path.join(s.workspaceDir, "tasks.md")), "the workspace itself stays");
    assert.equal((await store.readState()).prospects.find((entry) => entry.id === s.id)?.workspace, undefined);
  });

  it("never deletes a GitHub repo the run only reused, or one older than the run, or a public one", async () => {
    const reused = await scenario({ github: "existing" });
    const fake = freshRemote(reused);
    assert.match(String(stateOf(await previewCleanup(reused.id, depsFor(fake)), "github_repo")?.reason), /cannot show it created/);
    assert.ok(!fake.calls.some((call) => call.includes("repo")), "GitHub was not even asked");

    const old = await scenario();
    const oldFake = freshRemote(old);
    oldFake.repo = { fullName: `owner/${old.slug}`, private: true, createdAt: "2020-01-01T00:00:00Z" };
    assert.match(String(stateOf(await previewCleanup(old.id, depsFor(oldFake)), "github_repo")?.reason), /before this rebuild/);

    const open = await scenario();
    const openFake = freshRemote(open);
    openFake.repo = { fullName: `owner/${open.slug}`, private: false, createdAt: later(1000) };
    assert.match(String(stateOf(await previewCleanup(open.id, depsFor(openFake)), "github_repo")?.reason), /public/);
  });

  it("never deletes a Vercel project older than the run, with no creation date, or linked to another repo", async () => {
    const old = await scenario();
    const oldFake = freshRemote(old);
    oldFake.project = { id: "prj_abc123", name: "x", createdAt: 1000, linkedRepo: `owner/${old.slug}` };
    assert.equal(stateOf(await previewCleanup(old.id, depsFor(oldFake)), "vercel_project")?.state, "blocked");

    const undated = await scenario();
    const undatedFake = freshRemote(undated);
    undatedFake.project = { id: "prj_abc123", name: "x", linkedRepo: `owner/${undated.slug}` };
    assert.equal(stateOf(await previewCleanup(undated.id, depsFor(undatedFake)), "vercel_project")?.state, "blocked");

    const elsewhere = await scenario();
    const elsewhereFake = freshRemote(elsewhere);
    elsewhereFake.project = { id: "prj_abc123", name: "x", createdAt: Date.parse(later(1000)), linkedRepo: "owner/someone-elses-repo" };
    assert.match(String(stateOf(await previewCleanup(elsewhere.id, depsFor(elsewhereFake)), "vercel_project")?.reason), /linked to owner\/someone-elses-repo/);
  });

  it("says a remote item cannot be checked, rather than guessing, when the connector is off or the service is down", async () => {
    const s = await scenario();
    const off = await previewCleanup(s.id, depsFor(freshRemote(s), { capabilityAllowed: () => "“Delete repositories” on GitHub is turned off in Connectors." }));
    assert.equal(stateOf(off, "github_repo")?.state, "unavailable");
    assert.match(String(stateOf(off, "github_repo")?.reason), /turned off in Connectors/);

    const down = await previewCleanup(s.id, depsFor(remote({ repo: "throws", project: "throws" })));
    assert.equal(stateOf(down, "github_repo")?.state, "unavailable");
    assert.equal(stateOf(down, "vercel_project")?.state, "unavailable");
  });

  it("refuses a recorded path that is outside the sites folder, the folder itself, or a link", async () => {
    const outside = path.join(directory, "somewhere-else");
    makeRepo(outside);
    const s1 = await scenario({ repoPath: outside });
    assert.equal(stateOf(await previewCleanup(s1.id, depsFor(remote())), "local_site")?.state, "blocked");

    const s2 = await scenario({ repoPath: clients });
    assert.equal(stateOf(await previewCleanup(s2.id, depsFor(remote())), "local_site")?.state, "blocked");

    const target = path.join(directory, "real-client-repo");
    makeRepo(target);
    const link = path.join(clients, "linked-site");
    symlinkSync(target, link);
    const s3 = await scenario({ repoPath: link });
    const preview = await previewCleanup(s3.id, depsFor(remote()));
    assert.equal(stateOf(preview, "local_site")?.state, "blocked");
    await assert.rejects(runCleanup(s3.id, { items: ["local_site"], confirm: true }, depsFor(remote())));
    assert.ok(existsSync(path.join(target, "index.html")), "what the link pointed to is untouched");
  });

  it("refuses a workspace name that could climb out of the vault", async () => {
    const s = await scenario({ workspace: "none" });
    rebuild.setRunField(s.run.id, "workspace_slug", "../../outside");
    const preview = await previewCleanup(s.id, depsFor(remote()));
    assert.equal(stateOf(preview, "workspace")?.state, "blocked");
  });

  it("says the drive is not connected instead of guessing", async () => {
    const s = await scenario();
    const preview = await previewCleanup(s.id, depsFor(remote(), { clientSitesRoot: () => path.join(directory, "unplugged-drive", "clients") }));
    assert.equal(stateOf(preview, "local_site")?.state, "unavailable");
    assert.match(String(stateOf(preview, "local_site")?.reason), /plug it in/);
  });
});

describe("cleaning up", () => {
  it("deletes what stays on your machine and keeps the business and its emails", async () => {
    const s = await scenario();
    await store.recordManualSend({ prospectId: s.id, subject: "Hello", body: "Body" }).catch(() => undefined);
    const fake = freshRemote(s);
    const result = await runCleanup(s.id, { items: ["local_site", "workspace", "records"], confirm: true }, depsFor(fake));

    assert.deepEqual(result.results.map((entry) => [entry.id, entry.status]), [["local_site", "deleted"], ["workspace", "deleted"], ["records", "deleted"]]);
    assert.ok(result.bytesFreed > 5000);
    assert.ok(!existsSync(s.siteDir) && !existsSync(s.workspaceDir));
    assert.equal(rebuild.runForProspect(s.id), undefined);
    assert.ok(!fake.calls.some((call) => call.startsWith("DELETE")), "nothing remote was touched");

    const after = (await store.readState()).prospects.find((entry) => entry.id === s.id);
    assert.ok(after, "the business is kept");
    assert.equal(after?.workspace, undefined);
    assert.match(String(after?.notes), /Cleaned up \d{4}-\d{2}-\d{2}: site folder, workspace, rebuild history/);
  });

  it("needs the company's name before touching GitHub or Vercel", async () => {
    const s = await scenario();
    const fake = freshRemote(s);
    for (const confirmCompany of [undefined, "", "Client", `Client ${counter + 1}`]) {
      await assert.rejects(runCleanup(s.id, { items: ["github_repo"], confirm: true, confirmCompany }, depsFor(fake)), (error: unknown) => error instanceof CleanupError && error.status === 422);
    }
    assert.ok(!fake.calls.some((call) => call.startsWith("DELETE")));

    const result = await runCleanup(s.id, { items: ["github_repo", "vercel_project"], confirm: true, confirmCompany: `  ${s.company.toUpperCase()} ` }, depsFor(fake));
    assert.deepEqual(result.results.map((entry) => entry.status), ["deleted", "deleted"]);
    assert.deepEqual(fake.calls.filter((call) => call.startsWith("DELETE")), [`DELETE repo owner/${s.slug}`, "DELETE project prj_abc123"]);
  });

  it("checks everything again at the moment of deleting, and deletes nothing if any chosen item is not allowed", async () => {
    const s = await scenario({ repo: "foreign" });
    await assert.rejects(runCleanup(s.id, { items: ["workspace", "local_site", "records"], confirm: true }, depsFor(remote())), (error: unknown) => error instanceof CleanupError && /Site folder.*cannot be deleted/.test(error.message));
    assert.ok(existsSync(s.workspaceDir) && existsSync(s.siteDir), "not even the allowed items were deleted");
    assert.ok(rebuild.runForProspect(s.id));
  });

  it("keeps the rebuild history, and says so, when something else fails, so it can be retried", async () => {
    const s = await scenario();
    const fake = freshRemote(s);
    fake.failRepoDelete = true;
    const result = await runCleanup(s.id, { items: ["github_repo", "local_site", "records"], confirm: true, confirmCompany: s.company }, depsFor(fake));

    const by = Object.fromEntries(result.results.map((entry) => [entry.id, entry]));
    assert.equal(by.github_repo.status, "failed");
    assert.match(by.github_repo.detail, /admin rights/);
    assert.equal(by.local_site.status, "deleted", "the other items carry on");
    assert.equal(by.records.status, "skipped");
    assert.ok(rebuild.runForProspect(s.id), "the history that makes a retry possible is still there");
  });

  it("refuses a business that does not qualify, and deletes nothing", async () => {
    const s = await scenario({ stage: "target" });
    await assert.rejects(runCleanup(s.id, { items: ["local_site", "workspace"], confirm: true }, depsFor(remote())), (error: unknown) => error instanceof CleanupError && error.status === 422);
    assert.ok(existsSync(s.siteDir) && existsSync(s.workspaceDir));
  });

  it("refuses while a rebuild for them is running", async () => {
    const s = await scenario();
    rebuild.rebuildDatabase().prepare("UPDATE stages SET status = 'in_progress' WHERE run_id = ? AND stage = (SELECT stage FROM stages WHERE run_id = ? LIMIT 1)").run(s.run.id, s.run.id);
    await assert.rejects(runCleanup(s.id, { items: ["local_site"], confirm: true }, depsFor(remote())), /still running/);
    assert.ok(existsSync(s.siteDir));
  });

  it("is safe to run twice: the second time there is nothing left to delete", async () => {
    const s = await scenario();
    await runCleanup(s.id, { items: ["local_site", "workspace", "records"], confirm: true }, depsFor(remote()));
    const again = await previewCleanup(s.id, depsFor(remote()));
    assert.ok(again.items.every((entry) => entry.state === "not_found"), JSON.stringify(again.items.map((entry) => [entry.id, entry.state])));
  });

  it("removes every table's rows for the run and no one else's", async () => {
    const a = await scenario();
    const b = await scenario();
    await runCleanup(a.id, { items: ["records"], confirm: true }, depsFor(remote()));
    const db = rebuild.rebuildDatabase();
    for (const table of ["stages", "events", "artifacts", "revisions", "decisions", "concept_notes", "page_notes"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE run_id = ?`).get(a.run.id) as { n: number }).n, 0, table);
    }
    assert.ok(rebuild.runForProspect(b.id), "another client's rebuild is untouched");
    assert.ok((db.prepare("SELECT COUNT(*) AS n FROM stages WHERE run_id = ?").get(b.run.id) as { n: number }).n > 0);
  });
});

describe("the list of who could be cleaned up", () => {
  it("includes only qualifying businesses that have something built, without measuring anything", async () => {
    const has = await scenario();
    const noWork = await store.createProspect(ProspectInputSchema.parse({ company: "Nothing Built", stage: "target" }));
    await store.updateProspect(noWork.id, { stage: "lost" });
    const interested = await scenario({ stage: "target" });
    const candidates = await listCleanupCandidates({ ...depsFor(remote()) });
    const ids = candidates.map((entry) => entry.prospectId);
    assert.ok(ids.includes(has.id));
    assert.ok(!ids.includes(noWork.id), "nothing to clean up");
    assert.ok(!ids.includes(interested.id), "does not qualify");
    assert.equal(candidates.find((entry) => entry.prospectId === has.id)?.workspaceSlug, has.slug);
  });
});

describe("what was left behind", () => {
  it("never touched files outside the folders it deleted", async () => {
    const s = await scenario();
    const bystander = path.join(clients, "another-real-client");
    makeRepo(bystander, { author: "Dylan" });
    const notes = path.join(vault, "projects", "another-project");
    mkdirSync(notes, { recursive: true });
    writeFileSync(path.join(notes, "PROJECT.md"), "keep me");
    await runCleanup(s.id, { items: ["local_site", "workspace", "records"], confirm: true }, depsFor(remote()));
    assert.ok(existsSync(path.join(bystander, "index.html")));
    assert.equal(readFileSync(path.join(notes, "PROJECT.md"), "utf8"), "keep me");
  });
});

describe("the routes", () => {
  let server: import("node:http").Server;
  let base: string;

  const call = async (pathname: string, init?: RequestInit) => {
    const response = await fetch(`${base}${pathname}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const post = (id: string, body: unknown) => call(`/${id}`, { method: "POST", body: JSON.stringify(body) });

  before(async () => {
    const { default: express } = await import("express");
    const { cleanupRouter } = await import("../routes");
    const app = express();
    app.use(express.json());
    app.use("/api/cleanup", cleanupRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/cleanup`;
  });
  after(() => server?.close());

  it("lists candidates, previews one, and 404s an unknown business", async () => {
    const s = await scenario({ github: "none", vercel: false });
    const list = await call("/candidates");
    assert.equal(list.status, 200);
    assert.ok((list.body.candidates as { prospectId: string }[]).some((entry) => entry.prospectId === s.id));

    const preview = await call(`/${s.id}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.eligible, true);
    assert.equal((await call("/pr_missing")).status, 404);
  });

  it("refuses a request that is not exactly items and a confirmation", async () => {
    const s = await scenario({ github: "none", vercel: false });
    assert.equal((await post(s.id, { items: ["local_site"] })).status, 400, "no confirm");
    assert.equal((await post(s.id, { items: ["local_site"], confirm: false })).status, 400);
    assert.equal((await post(s.id, { items: [], confirm: true })).status, 400, "nothing chosen");
    assert.equal((await post(s.id, { items: ["everything"], confirm: true })).status, 400, "unknown item");
    assert.equal((await post(s.id, { items: ["local_site"], confirm: true, path: "/etc" })).status, 400, "no path in a request");
    assert.equal((await post(s.id, { items: ["local_site"], confirm: true, repo: "owner/real-client" })).status, 400, "no repository in a request");
    assert.ok(existsSync(s.siteDir) && existsSync(s.workspaceDir), "nothing was deleted by any of them");
  });

  it("answers 422 for a business that does not qualify and 409 for an item that may not be deleted", async () => {
    const early = await scenario({ stage: "target", github: "none", vercel: false });
    assert.equal((await post(early.id, { items: ["local_site"], confirm: true })).status, 422);

    const foreign = await scenario({ repo: "foreign", github: "none", vercel: false });
    const refused = await post(foreign.id, { items: ["local_site"], confirm: true });
    assert.equal(refused.status, 409);
    assert.match(String(refused.body.error), /existed before/);
    assert.ok(existsSync(path.join(foreign.siteDir, "index.html")));
  });

  it("cleans up, end to end, and then there is nothing to list", async () => {
    const s = await scenario({ github: "none", vercel: false });
    const done = await post(s.id, { items: ["local_site", "workspace", "records"], confirm: true });
    assert.equal(done.status, 200);
    assert.deepEqual((done.body.results as { status: string }[]).map((entry) => entry.status), ["deleted", "deleted", "deleted"]);
    assert.ok(!existsSync(s.siteDir) && !existsSync(s.workspaceDir));
    assert.ok(!((await call("/candidates")).body.candidates as { prospectId: string }[]).some((entry) => entry.prospectId === s.id));
  });
});


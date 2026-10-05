import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rebuild-stages-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");

const store = await import("../store");
const { advance, STAGE_HANDLERS } = await import("../runner");
const stages = await import("../stages");
const { integrateJob, pickWorker, WorkerStageBlocked } = await import("../workers");
const { ensureClientRepo, mountPointOf, ClientRepoUnavailable } = await import("../client-repo");
const { createWorktree } = await import("../../workers/worktree");
const { createJobId } = await import("../../workers/job-store");
const { routesFrom, routeName } = await import("../screens");
const { HermesError } = await import("../../hermes/client");
const { PublishError } = await import("../publish");
type RunnerDeps = import("../runner").RunnerDeps;
type StageDeps = import("../stages").StageDeps;
type WorkerJob = import("../../../shared/worker-types").WorkerJob;
type RebuildStageId = import("../../../shared/website-rebuild-types").RebuildStageId;

let caseNumber = 0;
let sites = "";
const vault = new Map<string, string>();
const binaries = new Map<string, string>();

beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `ui-${caseNumber}-`));
  sites = fs.mkdtempSync(path.join(root, `clients-${caseNumber}-`));
  process.env.AGENTOS_CLIENT_SITES_DIR = sites;
  vault.clear();
  binaries.clear();
});
after(() => {
  store.closeRebuildDatabase();
  stages.stageDeps.current = stages.defaultStageDeps;
  fs.rmSync(root, { recursive: true, force: true });
});

const runnerDeps: RunnerDeps = {
  ensureWorkspace: async () => ({ slug: "total-electric", reused: false }),
  capture: async (url) => ({
    pages: [{ url, title: "Total Electric", headings: [{ level: 1, text: "Electricians" }], navigation: [], ctas: [], forms: [], images: 0, imagesWithoutAlt: 0, text: "We fix wiring in Cape Town.", internalLinks: [] }],
    manifest: { startUrl: url, capturedAt: "2026-10-05T09:00:00.000Z", robots: "obeyed", captured: [url], skipped: [], failed: [] },
  }),
  writeDocument: async (relativePath, markdown) => {
    vault.set(relativePath, markdown);
  },
  writeBinary: async (relativePath, source) => {
    binaries.set(relativePath, source);
  },
};

/**
 * A worker that really works in a git worktree: it is handed a checkout,
 * writes the files its brief asks for, and stops at `awaiting_review`, as
 * the job manager would leave it. Integration then runs for real.
 */
interface FakeWorker {
  jobs: { worker: string; objective: string; repoPath?: string }[];
  available: Set<string>;
  files: (objective: string) => Record<string, string>;
  summary?: string;
}

function fakeStageDeps(worker: FakeWorker, overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    ...stages.defaultStageDeps,
    readVaultFile: async (relativePath) => vault.get(relativePath),
    pickWorker: (candidates) =>
      pickWorker(candidates, {
        health: async (id) => ({ available: worker.available.has(id), name: id, reason: "switched off" }),
        start: async () => ({ error: "unused" }),
        read: async () => undefined,
        sleep: async () => undefined,
      }),
    runJob: async (buildRequest, candidates, _existing, watch) => {
      const picked = await pickWorker(candidates, {
        health: async (id) => ({ available: worker.available.has(id), name: id, reason: "switched off" }),
        start: async () => ({ error: "unused" }),
        read: async () => undefined,
        sleep: async () => undefined,
      });
      const request = buildRequest(picked);
      const id = createJobId();
      worker.jobs.push({ worker: picked.id, objective: request.objective, repoPath: request.repoPath });
      watch.onStarted(id);
      const job: WorkerJob = { ...request, worker: picked.id, id, status: "awaiting_review", resolvedWorker: picked.id, createdAt: new Date().toISOString() };
      if (!request.repoPath) return { job: { ...job, result: { summary: worker.summary ?? "" } }, worker: picked };
      const worktree = await createWorktree(request.repoPath, id);
      for (const [file, contents] of Object.entries(worker.files(request.objective))) {
        fs.mkdirSync(path.dirname(path.join(worktree.path, file)), { recursive: true });
        fs.writeFileSync(path.join(worktree.path, file), contents);
      }
      return {
        job: { ...job, worktreePath: worktree.path, workerBranch: worktree.branch, sourceRepoPath: request.repoPath, result: { summary: "done", tests: (request.validationCommands ?? []).map((command) => ({ command, success: true, output: "", exitCode: 0, durationMs: 1 })) } },
        worker: picked,
      };
    },
    hermes: async (_prompt, onReply) => {
      onReply({ id: "chatcmpl-abc123", model: "hermes-4" });
      return "## First impression\nClear enough.";
    },
    screenshot: async (targets, outputDir) => {
      fs.mkdirSync(outputDir, { recursive: true });
      return targets.flatMap(({ name }) =>
        (["desktop", "mobile"] as const).map((viewport) => {
          const file = path.join(outputDir, `${name}-${viewport}.png`);
          fs.writeFileSync(file, "png");
          return { name, viewport, file };
        }),
      );
    },
    serveNext: async () => ({ url: "http://127.0.0.1:9", stop: () => undefined }),
    readDesignTemplate: async () => "# Template\n## Tokens\n## Typography\n",
    // Never the real GitHub or Vercel: publishing is stage 7's test, with its own fakes.
    publish: {
      ...stages.defaultStageDeps.publish,
      ensurePrivateRepo: async () => {
        throw new PublishError("Publishing is not part of this test.");
      },
    },
    today: () => "2026-10-05",
    ...overrides,
  };
}

function filesFor(objective: string): Record<string, string> {
  if (objective.startsWith("Research")) return { "research/total_electric_five_key_areas_improvement.md": "---\nauthor: worker\n---\n# Research\nFive competitors." };
  if (objective.startsWith("Design three")) {
    return Object.fromEntries(["a", "b", "c"].flatMap((letter) => [[`design/concept-${letter}/DESIGN.md`, `# Concept ${letter.toUpperCase()}`], [`design/concept-${letter}/hero.html`, objective.includes("<<<FEEDBACK") ? "<main><h1>Hi, revised</h1></main>" : "<main><h1>Hi</h1></main>"]]));
  }
  if (objective.startsWith("Build")) return { "package.json": "{}", "app/page.tsx": "export default function Page() { return null; }", "sitemap.json": "[\"/\", \"/contact\"]" };
  if (objective.startsWith("Add the working")) return { "docs/total_electric_functionality_test_report.md": "| Feature | Status |\n|---|---|\n| Contact form | Pass |" };
  if (objective.startsWith("Review")) {
    const match = /reviews\/[a-z]+-r\d+\.md/.exec(objective);
    return { [match?.[0] ?? "reviews/x.md"]: "Verdict: ready." };
  }
  return {};
}

function newRun() {
  return store.createOrReuseRun({
    prospectId: `p-${caseNumber}`,
    company: "Total Electric",
    websiteUrl: "https://total-electric.example",
    targetMarket: "Homeowners",
    location: "Cape Town",
    conversionGoal: "Book a call-out",
    requiredFunctions: ["contact_form"],
    designTemplate: "DESIGN.md",
    skillVersion: "1.1.0",
  }).run;
}

const status = (runId: string, stage: RebuildStageId) => store.readRun(runId).stages.find((entry) => entry.id === stage);
const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

describe("stages 3 to 6", () => {
  it("runs research, three concepts, the build and the features, each committed and tagged, stopping at every checkpoint", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();

    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "research")?.status, "complete");
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
    // Grok Bot was off, so research fell through to the next worker on the list.
    assert.equal(worker.jobs[0].worker, "hermes-worker");

    const repo = store.readRun(run.id).repoPath ?? "";
    assert.equal(repo, path.join(sites, "total-electric"));
    assert.match(git(repo, "tag", "--list"), /rebuild\/hero-r1/);
    assert.ok(fs.existsSync(path.join(repo, "docs/current-site/website_transcript.md")));
    assert.ok(fs.existsSync(path.join(repo, "design/concept-b/hero.html")));

    const hermes = vault.get("projects/total-electric/docs/website-rebuild/total_electric_hermes_analysis.md") ?? "";
    assert.match(hermes, /Hermes reference: chatcmpl-abc123/);
    assert.match(hermes, /Model: hermes-4/);
    const research = vault.get("projects/total-electric/docs/website-rebuild/total_electric_five_key_areas_improvement.md") ?? "";
    assert.doesNotMatch(research, /author: worker/, "the worker's own front matter is replaced by AgentOS provenance");
    assert.match(research, /worker: "hermes-worker"/);

    const heroImages = store.readRun(run.id).artifacts.filter((artifact) => artifact.stage === "hero" && artifact.media === "image");
    assert.equal(heroImages.length, 6);
    assert.match(heroImages[0].href, /^\/api\/rebuilds\/.+\/artifacts\//);

    // Approving the concepts requires a choice, and the build is told which one.
    assert.throws(() => store.decide(run.id, "hero", 1, "approved"), /Choose which concept/);
    store.decide(run.id, "hero", 1, "approved", undefined, "concept-b");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "build")?.status, "awaiting_approval");
    const buildJob = worker.jobs.find((job) => job.objective.startsWith("Build"));
    assert.match(buildJob?.objective ?? "", /design\/concept-b\/DESIGN\.md/);
    assert.ok(worker.jobs.some((job) => job.worker === "codex" && job.objective.startsWith("Review the build")), "Codex gave a second opinion");
    assert.ok(store.readRun(run.id).artifacts.some((artifact) => artifact.title.includes("review of build r1")));
    const buildRevision = store.readRun(run.id).revisions.find((revision) => revision.stage === "build");
    assert.equal(buildRevision?.ref, git(repo, "rev-list", "-n", "1", "rebuild/build-r1"));

    store.decide(run.id, "build", 1, "approved");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "functions")?.status, "awaiting_approval");
    const report = vault.get("projects/total-electric/docs/website-rebuild/total_electric_functionality_test_report.md") ?? "";
    assert.match(report, /Contact form \| Pass/);
    assert.match(report, /## Checks AgentOS ran itself/);
    assert.match(report, /`npm test` \| Pass/);

    store.decide(run.id, "functions", 1, "approved");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.match(status(run.id, "preview")?.blocker ?? "", /Publishing is not part of this test/);
    // The working copy is clean and on main: everything went in through commits.
    assert.equal(git(repo, "status", "--porcelain"), "");
  });

  it("sends a change request to the worker and makes a new tagged revision", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    store.decide(run.id, "hero", 1, "changes_requested", "Bigger phone number, warmer colours");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);

    assert.equal(status(run.id, "hero")?.revision, 2, status(run.id, "hero")?.blocker ?? "");
    const second = worker.jobs.filter((job) => job.objective.startsWith("Design three"))[1];
    assert.match(second.objective, /<<<FEEDBACK\nBigger phone number, warmer colours\nFEEDBACK>>>/);
    const repo = store.readRun(run.id).repoPath ?? "";
    assert.match(git(repo, "tag", "--list"), /rebuild\/hero-r1[\s\S]*rebuild\/hero-r2/);
    // Revision 2's screenshots are new files; revision 1's are kept as they were reviewed.
    const images = store.readRun(run.id).artifacts.filter((artifact) => artifact.media === "image");
    assert.equal(images.filter((image) => image.revision === 1).length, 6);
    assert.equal(images.filter((image) => image.revision === 2).length, 6);
  });

  it("uses Grok Bot through its file bridge, with the site in the brief and its answer as the report", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["grok-bot", "claude-code"]), files: filesFor, summary: "# Research by Grok\nFive competitors." };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const research = worker.jobs[0];
    assert.equal(research.worker, "grok-bot");
    assert.equal(research.repoPath, undefined);
    assert.match(research.objective, /<<<SITE[\s\S]*We fix wiring in Cape Town/);
    const repo = store.readRun(run.id).repoPath ?? "";
    assert.match(fs.readFileSync(path.join(repo, "research/total_electric_five_key_areas_improvement.md"), "utf8"), /Research by Grok/);
  });

  it("blocks on Hermes without losing the research, and a retry only runs Hermes", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["hermes-worker", "claude-code"]), files: filesFor };
    let hermesUp = false;
    stages.stageDeps.current = fakeStageDeps(worker, {
      hermes: async (_prompt, onReply) => {
        if (!hermesUp) throw new HermesError("Hermes is not responding.", "offline");
        onReply({ id: "chatcmpl-later" });
        return "Analysis.";
      },
    });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "research")?.status, "blocked");
    assert.match(status(run.id, "research")?.blocker ?? "", /Hermes could not analyse the site: Hermes is not responding\. The competitor research is saved/);
    assert.equal(worker.jobs.length, 1);

    hermesUp = true;
    store.resetForRetry(run.id, "research");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "research")?.status, "complete");
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Research")).length, 1, "the research job was not run twice");
  });

  it("names the workers to switch on when none is available", async () => {
    stages.stageDeps.current = fakeStageDeps({ jobs: [], available: new Set(), files: filesFor });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.match(status(run.id, "research")?.blocker ?? "", /Switch one on in Operations → AI Stack\. grok-bot: switched off; hermes-worker: switched off/);
  });

  it("blocks with 'Connect DylanSSD' when the client drive is not plugged in", async () => {
    process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/DylanSSD-not-here/dev/projects/clients";
    stages.stageDeps.current = fakeStageDeps({ jobs: [], available: new Set(["claude-code"]), files: filesFor });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.match(status(run.id, "research")?.blocker ?? "", /^Connect DylanSSD-not-here/);
  });
});

describe("client repo and helpers", () => {
  it("creates the client repo once, with a first commit, and reuses it", async () => {
    const first = await ensureClientRepo("total-electric", "Total Electric");
    const second = await ensureClientRepo("total-electric", "Total Electric");
    assert.equal(first, second);
    assert.equal(git(first, "rev-list", "--count", "HEAD"), "1");
    assert.match(fs.readFileSync(path.join(first, ".gitignore"), "utf8"), /node_modules/);
    await assert.rejects(ensureClientRepo("../../etc", "x").then((repo) => assert.ok(repo.startsWith(sites))).then(() => {
      throw new ClientRepoUnavailable("contained");
    }), /contained/);
  });

  it("knows the mount a clients folder depends on", () => {
    assert.equal(mountPointOf("/Volumes/DylanSSD/dev/projects/clients"), "/Volumes/DylanSSD");
    assert.equal(mountPointOf("/Users/dylan/clients"), undefined);
  });

  it("refuses to integrate a job that changed nothing", async () => {
    const repo = await ensureClientRepo("empty-job", "Empty");
    const emptyId = createJobId();
    const worktree = await createWorktree(repo, emptyId);
    const job: WorkerJob = { worker: "codex", project: "x", objective: "x", id: emptyId, status: "awaiting_review", createdAt: "", worktreePath: worktree.path, workerBranch: worktree.branch };
    await assert.rejects(integrateJob(job, repo, "nothing", "rebuild/x"), WorkerStageBlocked);
  });

  it("reads the routes to photograph from sitemap.json, safely", () => {
    assert.deepEqual(routesFrom('["/services", "/contact", "../../etc", "https://evil.example"]'), ["/", "/services", "/contact"]);
    assert.deepEqual(routesFrom('{"routes":[{"path":"/about"}]}'), ["/", "/about"]);
    assert.deepEqual(routesFrom("not json"), ["/"]);
    assert.equal(routeName("/services/electrical"), "services-electrical");
    assert.equal(routeName("/"), "home");
  });
});

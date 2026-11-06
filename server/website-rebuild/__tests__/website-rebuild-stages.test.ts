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
const { routesFrom, routeName, routeList } = await import("../screens");
const { HermesError } = await import("../../hermes/client");
const { PublishError } = await import("../publish");
const { startFreshConcepts } = await import("../design-fingerprints");
type RunnerDeps = import("../runner").RunnerDeps;
type StageDeps = import("../stages").StageDeps;
type WorkerJob = import("../../../shared/worker-types").WorkerJob;
type RebuildStageId = import("../../../shared/website-rebuild-types").RebuildStageId;
type ConceptAudit = import("../hero-audit").ConceptAudit;

let caseNumber = 0;
let sites = "";
const vault = new Map<string, string>();
const binaries = new Map<string, string>();

beforeEach(() => {
  store.closeRebuildDatabase();
  critiqueScores = () => [32, 32, 32];
  auditFailures = () => [];
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
  /** Workers whose jobs fail, as a signed-out CLI would. */
  failing?: Set<string>;
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
      if (worker.failing?.has(picked.id)) throw new WorkerStageBlocked(`${picked.id}'s job failed: exited with code 1: Not logged in.`);
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
    fontKit: async (families) => ({ files: {}, css: families.map((family) => `/* ${family} */`).join("\n"), missing: [] }),
    motionKit: async () => ({ "design/kit/motion/gsap.min.js": Buffer.from("// gsap") }),
    captureReferences: async () => [],
    auditConcepts: async () => auditFailures(),
    renderArt: async (plan) => ({ files: Object.fromEntries(plan.images.map((image) => [`design/${image.concept}/art/${image.name}.png`, Buffer.from("png")])), spent: plan.images.length * 0.25, ledger: "date,concept,file,model,credits\n", notes: [] }),
    auditInteractions: async () => [],
    readDesignTemplate: async () => "# Template\n## Tokens\n## Typography\n",
    linkWorkspaceRepo: async () => false,
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

/** What the design critic scores the concepts, per pass. Every concept passes unless a test says otherwise. */
let critiqueScores: (pass: 1 | 2) => [number, number, number] = () => [32, 32, 32];
/** What the rendered audit finds. Nothing, unless a test says otherwise. */
let auditFailures: () => ConceptAudit[] = () => [];
/** So a second round of concepts changes the files, as a real worker's would. */
let madeCount = 0;

function filesFor(objective: string): Record<string, string> {
  if (objective.startsWith("Critique")) {
    const file = /reviews\/hero-critique-r\d+(-2)?\.md/.exec(objective)?.[0] ?? "reviews/x.md";
    const scores = critiqueScores(file.endsWith("-2.md") ? 2 : 1);
    return { [file]: scores.map((score, index) => `## concept-${"abc"[index]}\nScore: ${score}/40\nSlop: ${score < 28 ? "centred hero over a stock photo" : "None"}\nFix: commit harder`).join("\n\n") };
  }
  if (objective.startsWith("Revise")) {
    const concepts = [...objective.matchAll(/design\/(concept-[abc])\/hero\.html/g)].map((match) => match[1]);
    return Object.fromEntries(concepts.map((concept) => [`design/${concept}/hero.html`, "<main><h1>Hi, revised by the gate</h1></main>"]));
  }
  if (objective.startsWith("Research")) return { "research/total_electric_five_key_areas_improvement.md": "---\nauthor: worker\n---\n# Research\nFive competitors." };
  if (objective.startsWith("Write the creative strategy")) return { "design/STRATEGY.md": objective.includes("<<<FEEDBACK") ? "# Strategy, again\n" : "# Strategy\n", ...(objective.includes("design/ART.json") ? { "design/ART.json": JSON.stringify({ images: [{ concept: "concept-a", name: "bronze", prompt: "A slab of aged bronze under one low light", aspect: "16:9" }] }) } : {}) };
  const designing = /^Design (concept-[abc]) /.exec(objective)?.[1];
  if (designing) {
    madeCount += 1;
    return { [`design/${designing}/DESIGN.md`]: `# ${designing}`, [`design/${designing}/hero.html`]: `<!-- ${madeCount} --><main><h1>${objective.includes("<<<FEEDBACK") ? "Hi, revised" : "Hi"}</h1></main>` };
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

describe("brand kit", () => {
  const png = (width: number, height: number, salt: number) => {
    const data = Buffer.alloc(33 + salt);
    data.writeUInt32BE(0x89504e47, 0);
    data.writeUInt32BE(0x0d0a1a0a, 4);
    data.writeUInt32BE(width, 16);
    data.writeUInt32BE(height, 20);
    data[32 + salt] = salt;
    return data;
  };
  const stored = new Map<string, Buffer>();
  const brandedDeps: RunnerDeps = {
    ...runnerDeps,
    capture: async (url) => ({
      pages: [
        {
          url,
          title: "Total Electric",
          headings: [{ level: 1, text: "Electricians" }],
          navigation: [],
          ctas: [],
          forms: [],
          images: 2,
          imagesWithoutAlt: 0,
          text: "We fix wiring in Cape Town.",
          internalLinks: [],
          brand: {
            logos: [{ url: `${url}/logo.png`, alt: "Total Electric", width: 240, height: 80, placement: "header", data: png(240, 80, 1), contentType: "image/png" }],
            photos: [
              { url: `${url}/van.jpg`, alt: "Our van", width: 1600, height: 900, placement: "content", data: png(1600, 900, 2), contentType: "image/png" },
              { url: `${url}/van-copy.jpg`, alt: "Same van", width: 1600, height: 900, placement: "content", data: png(1600, 900, 2), contentType: "image/png" },
            ],
            colors: [
              { value: "rgb(255, 255, 255)", role: "background" },
              { value: "rgb(232, 93, 4)", role: "accent" },
              { value: "rgba(0, 0, 0, 0)", role: "header" },
            ],
            fonts: [{ family: '"Montserrat", sans-serif', role: "heading" }],
          },
        },
      ],
      manifest: { startUrl: url, capturedAt: "2026-10-05T09:00:00.000Z", robots: "obeyed", captured: [url], skipped: [], failed: [] },
    }),
    writeBinary: async (relativePath, source) => {
      stored.set(relativePath, fs.readFileSync(source));
    },
  };

  it("keeps the logo, photos, colours and fonts from capture, and seeds only the included ones into brand/", async () => {
    stored.clear();
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker, { readVaultBinary: async (relativePath) => stored.get(relativePath) });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, brandedDeps);

    const kit = store.readRun(run.id).brandKit;
    assert.ok(kit, "the run has a brand kit");
    // The same bytes at two addresses are one photo.
    assert.deepEqual(kit.assets.map((asset) => asset.id), ["logo", "photo-01"]);
    assert.deepEqual(kit.assets.map((asset) => [asset.width, asset.height]), [[240, 80], [1600, 900]]);
    assert.match(kit.assets[0].path, /^projects\/total-electric\/docs\/website-rebuild\/brand\/capture-r1-logo\.png$/);
    assert.deepEqual(kit.colors.map((color) => [color.role, color.hex]), [["accent", "#e85d04"], ["background", "#ffffff"]]);
    assert.deepEqual(kit.fonts, [{ family: "Montserrat", role: "heading" }]);
    assert.match(status(run.id, "capture")?.blocker ?? store.readRun(run.id).revisions.find((revision) => revision.stage === "capture")?.summary ?? "", /Brand kit: logo, 1 photo, 2 colours/);
    assert.match(vault.get("projects/total-electric/docs/website-rebuild/total_electric_brand_kit.md") ?? "", /licensed to them, not to us/);

    const repo = store.readRun(run.id).repoPath ?? "";
    assert.ok(fs.readFileSync(path.join(repo, "brand/logo.png")).equals(stored.get(kit.assets[0].path) as Buffer));
    assert.ok(fs.existsSync(path.join(repo, "brand/photos/photo-01.png")));
    assert.match(fs.readFileSync(path.join(repo, "brand/BRAND.md"), "utf8"), /#e85d04 \| accent/);

    // A person leaves the photo out; the next hero revision's brand/ no longer has it.
    store.setBrandKit(run.id, { ...kit, source: "edited", assets: kit.assets.map((asset) => (asset.kind === "photo" ? { ...asset, include: false } : asset)) });
    store.decide(run.id, "hero", 1, "changes_requested", "Use the logo bigger");
    await advance(run.id, STAGE_HANDLERS, brandedDeps);
    assert.equal(status(run.id, "hero")?.revision, 2, status(run.id, "hero")?.blocker ?? "");
    assert.ok(fs.existsSync(path.join(repo, "brand/logo.png")));
    assert.equal(fs.existsSync(path.join(repo, "brand/photos/photo-01.png")), false);
    assert.doesNotMatch(fs.readFileSync(path.join(repo, "brand/BRAND.md"), "utf8"), /photo-01/);
    assert.equal(git(repo, "status", "--porcelain"), "");
  });
});

describe("a client with no website", () => {
  it("researches without asking Hermes to analyse a site that does not exist, and tells every worker", async () => {
    let hermesCalls = 0;
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker, {
      hermes: async () => {
        hermesCalls += 1;
        return "should not run";
      },
    });
    const { run } = store.createOrReuseRun({ prospectId: `no-site-${caseNumber}`, company: "Total Electric", websiteUrl: "", targetMarket: "Homeowners", location: "Cape Town", conversionGoal: "Book a call-out", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1.3.0" });
    await advance(run.id, STAGE_HANDLERS, runnerDeps);

    assert.equal(status(run.id, "research")?.status, "complete", status(run.id, "research")?.blocker ?? "");
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
    assert.equal(hermesCalls, 0);
    assert.match(vault.get("projects/total-electric/docs/website-rebuild/total_electric_hermes_analysis.md") ?? "", /## Not run[\s\S]*no current website/);
    const hero = worker.jobs.find((job) => job.objective.startsWith("Design concept-"));
    assert.match(hero?.objective ?? "", /Current website: none/);
    assert.match(hero?.objective ?? "", /No current site was captured: They have no website\./);
  });
});

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
    const second = worker.jobs.filter((job) => job.objective.startsWith("Design concept-a"))[1];
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
    assert.match(status(run.id, "research")?.blocker ?? "", /Switch one on in Operations → AI Stack\. hermes-worker: switched off; gemini: switched off/);
  });

  it("blocks with 'Connect DylanSSD' when the client drive is not plugged in", async () => {
    process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/DylanSSD-not-here/dev/projects/clients";
    stages.stageDeps.current = fakeStageDeps({ jobs: [], available: new Set(["claude-code"]), files: filesFor });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.match(status(run.id, "research")?.blocker ?? "", /^Connect DylanSSD-not-here/);
  });
});

describe("the design critique gate", () => {
  it("assigns each concept a direction, scores them, and shows the scores on the run", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const concepts = store.readRun(run.id).designConcepts;
    assert.equal(concepts.length, 3);
    // A strategy first, then one job per concept, each briefed on its own assignment only.
    const heroJobs = worker.jobs.filter((job) => /^(Write the creative strategy|Design concept-)/.test(job.objective));
    assert.match(heroJobs[0].objective, /^Write the creative strategy/);
    assert.equal(heroJobs.length, 4);
    for (const [index, concept] of concepts.entries()) {
      const job = heroJobs[index + 1];
      assert.ok(job.objective.startsWith(`Design ${concept.concept} `), concept.concept);
      assert.ok(job.objective.includes(`Art direction: ${concept.directionName}`), concept.concept);
      assert.ok(concept.compositionName && concept.navName && concept.motionName, concept.concept);
      assert.ok(job.objective.includes(`Composition: ${concept.compositionName}`), concept.concept);
    }
    assert.match(heroJobs[1].objective, /yellow and black with a lightning bolt/, "Total Electric is briefed against the electricians' clichés");
    // Taking turns between the plan's first two workers.
    assert.deepEqual(heroJobs.slice(1).map((job) => job.worker), ["claude-code", "codex", "claude-code"]);
    const repo = store.readRun(run.id).repoPath ?? "";
    assert.ok(fs.existsSync(path.join(repo, "design/kit/motion/gsap.min.js")), "the motion libraries were seeded");
    for (const concept of concepts) assert.ok(fs.existsSync(path.join(repo, `design/${concept.concept}/fonts.css`)), "fonts seeded");
    assert.ok(fs.existsSync(path.join(repo, "reviews/hero-audit-r1.md")), "the audit is in the repo for the critic");
    assert.match(worker.jobs.find((job) => job.objective.startsWith("Critique"))?.objective ?? "", /concept-a at desktop:/, "the critic is given the screenshots");
    assert.equal(git(repo, "tag", "--list", "rebuild/hero-r1"), "rebuild/hero-r1");
    assert.ok(worker.jobs.some((job) => job.worker === "codex" && job.objective.startsWith("Critique")), "Codex critiqued the concepts");
    assert.ok(!worker.jobs.some((job) => job.objective.startsWith("Revise")), "nothing below the bar, so no revision");
    assert.deepEqual(concepts.map((entry) => [entry.score, entry.passed, entry.escalated]), [[32, true, false], [32, true, false], [32, true, false]]);
    assert.match(store.readRun(run.id).revisions.find((revision) => revision.stage === "hero")?.summary ?? "", /Critique: A .+ 32\/40/);

    // The build follows the approved concept's direction on every page.
    store.decide(run.id, "hero", 1, "approved", undefined, "concept-c");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const build = worker.jobs.find((job) => job.objective.startsWith("Build"));
    assert.ok(build?.objective.includes(`the approved concept is ${concepts[2].directionName}`));
    const review = worker.jobs.find((job) => job.objective.startsWith("Review the build"));
    assert.match(review?.objective ?? "", /Design score: <total>\/40/);
  });

  it("sends a concept below the bar back once, and passes it when the revision scores well", async () => {
    critiqueScores = (pass) => (pass === 1 ? [34, 20, 33] : [34, 33, 33]);
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const revisions = worker.jobs.filter((job) => job.objective.startsWith("Revise"));
    assert.equal(revisions.length, 1);
    assert.match(revisions[0].objective, /^Revise concept-b/);
    assert.match(revisions[0].objective, /centred hero over a stock photo/);
    assert.equal(fs.readFileSync(path.join(store.readRun(run.id).repoPath ?? "", "design/concept-b/hero.html"), "utf8"), "<main><h1>Hi, revised by the gate</h1></main>");
    const b = store.readRun(run.id).designConcepts.find((entry) => entry.concept === "concept-b");
    assert.deepEqual([b?.score, b?.passed, b?.autoRevised, b?.escalated], [33, true, true, false]);
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
    // The stage's revision is the revised commit, and the critiques are filed as reports.
    const revision = store.readRun(run.id).revisions.find((entry) => entry.stage === "hero");
    assert.match(revision?.summary ?? "", /passed after one automatic revision/);
    assert.ok(store.readRun(run.id).artifacts.filter((artifact) => artifact.title.startsWith("Design critique")).length === 2);
  });

  it("revises at most once, then hands the concept to the person with its score", async () => {
    critiqueScores = () => [34, 20, 33];
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Revise")).length, 1);
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Critique")).length, 2);
    const b = store.readRun(run.id).designConcepts.find((entry) => entry.concept === "concept-b");
    assert.deepEqual([b?.score, b?.passed, b?.autoRevised, b?.escalated], [20, false, true, true]);
    assert.match(store.readRun(run.id).revisions.find((entry) => entry.stage === "hero")?.summary ?? "", /20\/40, needs your call after one automatic revision/);
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
  });

  it("a measured failure sends a concept back on its own, naming what the browser saw", async () => {
    let audits = 0;
    auditFailures = () => {
      audits += 1;
      return [{ concept: "concept-a", failures: audits === 1 ? ["The headline renders in \"georgia\", which the page did not load."] : [], warnings: [] }];
    };
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const revision = worker.jobs.find((job) => job.objective.startsWith("Revise"));
    assert.match(revision?.objective ?? "", /^Revise concept-a/);
    assert.match(revision?.objective ?? "", /Measured in a browser:\n- The headline renders in "georgia"/);
    assert.equal(store.readRun(run.id).designConcepts[0].passed, true);
    assert.ok(store.readRun(run.id).artifacts.some((artifact) => artifact.title.startsWith("Rendered audit")));
  });

  it("generates imagery only within the run's budget, and only when one is set", async () => {
    const free: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    let spends = 0;
    stages.stageDeps.current = fakeStageDeps(free, { renderArt: async () => { spends += 1; return { files: {}, spent: 0, ledger: "", notes: [] }; } });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(spends, 0, "no budget, no generation");
    assert.doesNotMatch(free.jobs.find((job) => job.objective.startsWith("Write the creative strategy"))?.objective ?? "", /ART\.json/);

  });

  it("spends within the budget when one is set, and hands the images to the concept's designer", async () => {
    const funded: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(funded);
    const paid = newRun();
    store.setArtBudget(paid.id, 5);
    await advance(paid.id, STAGE_HANDLERS, runnerDeps);
    const after = store.readRun(paid.id);
    assert.equal(after.artSpent, 0.25);
    assert.ok(fs.existsSync(path.join(after.repoPath ?? "", "design/concept-a/art/bronze.png")));
    assert.ok(fs.existsSync(path.join(after.repoPath ?? "", "design/art-ledger.csv")));
    assert.match(funded.jobs.find((job) => job.objective.startsWith("Design concept-a"))?.objective ?? "", /design\/concept-a\/art\/bronze\.png/);
  });

  it("a note on one concept redoes only that concept; new concepts starts again with a new strategy and assignment", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    const firstDirections = store.readRun(run.id).designConcepts.map((entry) => entry.direction);

    store.decide(run.id, "hero", 1, "changes_requested", undefined, undefined, { "concept-b": "Bigger headline." });
    worker.jobs.length = 0;
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.deepEqual(worker.jobs.filter((job) => job.objective.startsWith("Design concept-")).map((job) => job.objective.slice(0, 16)), ["Design concept-b"]);
    assert.ok(!worker.jobs.some((job) => job.objective.startsWith("Write the creative strategy")), "the strategy stands");
    assert.deepEqual(store.readRun(run.id).designConcepts.map((entry) => entry.direction), firstDirections, "a change request keeps the directions");

    startFreshConcepts(run.id, 2);
    worker.jobs.length = 0;
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.ok(worker.jobs.some((job) => job.objective.startsWith("Write the creative strategy")));
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Design concept-")).length, 3);
    const next = store.readRun(run.id).designConcepts.map((entry) => entry.direction);
    for (const direction of next) assert.ok(!firstDirections.includes(direction), direction);
  });

  it("still reaches the person, unscored, when no critic is available", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "hermes-worker"]), files: (objective) => (objective.startsWith("Critique") ? {} : filesFor(objective)) };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
    assert.match(store.readRun(run.id).revisions.find((entry) => entry.stage === "hero")?.summary ?? "", /could not run, so the concepts are unscored/);
    assert.ok(store.readRun(run.id).designConcepts.every((entry) => entry.score === undefined));
  });
});

describe("switching worker", () => {
  it("retries a failed stage with the worker the person picks, and keeps using it", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["hermes-worker", "claude-code", "codex"]), files: filesFor, failing: new Set(["claude-code"]) };
    stages.stageDeps.current = fakeStageDeps(worker);
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "hero")?.status, "blocked");
    assert.match(status(run.id, "hero")?.blocker ?? "", /claude-code's job failed: exited with code 1: Not logged in/);

    store.resetForRetry(run.id, "hero", "codex");
    assert.equal(status(run.id, "hero")?.workerOverride, "codex");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "hero")?.status, "awaiting_approval");
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Design concept-")).at(-1)?.worker, "codex");
    assert.equal(store.readRun(run.id).revisions.find((revision) => revision.stage === "hero")?.worker, "codex");

    // A change request goes to the chosen worker, not back to the one that failed.
    store.decide(run.id, "hero", 1, "changes_requested", "Warmer");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(worker.jobs.filter((job) => job.objective.startsWith("Design concept-")).at(-1)?.worker, "codex");

    // "plan" goes back to the usual order.
    store.decide(run.id, "hero", 2, "changes_requested", "Again");
    worker.failing = new Set(["claude-code", "codex"]);
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    store.resetForRetry(run.id, "hero", "plan");
    assert.equal(status(run.id, "hero")?.workerOverride, undefined);
  });
});

describe("client repo and helpers", () => {
  it("creates the client repo once, with a first commit, and reuses it", async () => {
    const first = await ensureClientRepo("total-electric", "Total Electric");
    const second = await ensureClientRepo("total-electric", "Total Electric");
    assert.equal(first, second);
    assert.equal(git(first, "rev-list", "--count", "HEAD"), "1");
    const ignore = fs.readFileSync(path.join(first, ".gitignore"), "utf8");
    assert.match(ignore, /node_modules/);
    assert.match(ignore, /\._\*/);
    assert.match(ignore, /\.DS_Store/);
    await assert.rejects(ensureClientRepo("../../etc", "x").then((repo) => assert.ok(repo.startsWith(sites))).then(() => {
      throw new ClientRepoUnavailable("contained");
    }), /contained/);
  });

  it("knows the mount a clients folder depends on", () => {
    assert.equal(mountPointOf("/Volumes/DylanSSD/dev/projects/clients"), "/Volumes/DylanSSD");
    assert.equal(mountPointOf("/Volumes/DylanSSD/projects/clients"), "/Volumes/DylanSSD");
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

describe("baseline storyboard review", () => {
  type ShotCall = { names: string[]; fullPage: boolean | undefined };

  /** Runs the rebuild to the baseline checkpoint with a screenshotter that records how it was called. */
  async function atBaseline(options: { screenshotFor?: (name: string, viewport: string, call: number) => string; sitemap?: string } = {}) {
    const worker: FakeWorker = {
      jobs: [],
      available: new Set(["claude-code", "codex", "hermes-worker"]),
      files: (objective) =>
        objective.startsWith("Build")
          ? { ...filesFor(objective), "sitemap.json": options.sitemap ?? '["/", "/contact"]', "app/page.tsx": `export default function Page() { return "${objective.includes("<<<FEEDBACK") ? "revised" : "first"}"; }` }
          : filesFor(objective),
    };
    const calls: ShotCall[] = [];
    let call = 0;
    stages.stageDeps.current = fakeStageDeps(worker, {
      screenshot: async (targets, outputDir, shotOptions) => {
        fs.mkdirSync(outputDir, { recursive: true });
        calls.push({ names: targets.map((target) => target.name), fullPage: shotOptions?.fullPage });
        call += 1;
        return targets.flatMap(({ name }) =>
          (["desktop", "mobile"] as const).map((viewport) => {
            const file = path.join(outputDir, `${name}-${viewport}.png`);
            fs.writeFileSync(file, options.screenshotFor?.(name, viewport, call) ?? "png");
            return { name, viewport, file };
          }),
        );
      },
    });
    const run = newRun();
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    store.decide(run.id, "hero", 1, "approved", undefined, "concept-b");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    return { run, worker, calls };
  }

  const pin = (id: string, text: string, extra: object = {}) => ({ id, text, viewport: "desktop" as const, ...extra });

  it("photographs every baseline page top to bottom, and titles each snapshot with its route", async () => {
    const { run, calls } = await atBaseline();
    assert.equal(status(run.id, "build")?.status, "awaiting_approval");
    const buildCall = calls.find((entry) => entry.names.includes("contact"));
    assert.equal(buildCall?.fullPage, true);
    const titles = store.readRun(run.id).artifacts.filter((artifact) => artifact.stage === "build" && artifact.media === "image").map((artifact) => artifact.title).sort();
    assert.deepEqual(titles, ["/ (desktop)", "/ (mobile)", "/contact (desktop)", "/contact (mobile)"]);
    assert.ok(store.readRun(run.id).artifacts.filter((artifact) => artifact.media === "image" && artifact.stage === "build").every((artifact) => artifact.digest));
  });

  it("keeps up to twenty pages and says how many were left out", () => {
    const routes = JSON.stringify(Array.from({ length: 25 }, (_, index) => `/p${index}`));
    const kept = routeList(routes, 20);
    assert.equal(kept.routes.length, 20);
    assert.equal(kept.dropped, 6, "twenty-five listed plus the home page, twenty kept");
    assert.equal(routesFrom(routes).length, 6, "other stages keep their limit of six");
  });

  it("sends each page's notes to the worker word for word, grouped by page, and only those pages", async () => {
    const { run, worker } = await atBaseline();
    store.savePageNotes(run.id, "build", 1, "/contact", [pin("n1", "Make the phone number bigger,\n  and keep my \"quotes\" & spacing.", { x: 42.4, y: 10, section: "Call us" }), pin("n2", "Move the form above the map.")]);
    store.savePageNotes(run.id, "build", 1, "/", []);
    assert.deepEqual(Object.keys(store.savedPageNotes(run.id, "build", 1)), ["/contact"], "a page cleared of notes is not kept");

    // No pageNotes sent: the notes saved while reviewing are what goes.
    store.decide(run.id, "build", 1, "changes_requested");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "build")?.revision, 2, status(run.id, "build")?.blocker ?? "");

    const second = worker.jobs.filter((job) => job.objective.startsWith("Build"))[1].objective;
    assert.ok(second.includes("Make the phone number bigger,\n  and keep my \"quotes\" & spacing."), "the note is not reworded or trimmed inside");
    assert.ok(second.includes("Move the form above the map."));
    assert.match(second, /\/contact\n- \(pinned on the desktop snapshot at 42% across, 10% down; section: Call us\) Make the phone number bigger/);
    assert.match(second, /leave every other page's content and layout unchanged/);
    assert.doesNotMatch(second, /\n\/\n/, "the home page had no notes, so it is not listed");
    assert.deepEqual(Object.keys(store.readRun(run.id).decisions.at(-1)?.pageNotes ?? {}), ["/contact"], "the history keeps exactly what was sent");
  });

  it("refuses to request changes with nothing written, and ignores notes on other stages", async () => {
    const { run } = await atBaseline();
    assert.throws(() => store.decide(run.id, "build", 1, "changes_requested"), /Say what should change/);
    assert.throws(() => store.decide(run.id, "build", 1, "changes_requested", undefined, undefined, undefined, { "/": [pin("n1", "   ")] }), /Say what should change/, "a blank note is nothing");
    assert.throws(() => store.savePageNotes(run.id, "hero", 1, "/", [pin("n1", "x")]), /Only the baseline/);
  });

  it("will not approve a baseline that has no snapshots of every page", async () => {
    const worker: FakeWorker = { jobs: [], available: new Set(["claude-code", "codex", "hermes-worker"]), files: filesFor };
    stages.stageDeps.current = fakeStageDeps(worker, {
      screenshot: async (targets, outputDir) => {
        fs.mkdirSync(outputDir, { recursive: true });
        if (targets.some((target) => target.name === "home")) throw new Error("Chromium crashed");
        return [];
      },
    });
    const run = newRun();
    // The hero stage needs real shots, so reach the baseline with a working screenshotter first.
    stages.stageDeps.current = fakeStageDeps(worker);
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    store.decide(run.id, "hero", 1, "approved", undefined, "concept-b");
    stages.stageDeps.current = fakeStageDeps(worker, {
      screenshot: async (targets, outputDir) => {
        if (targets.length === 2 && targets[0].name === "home") throw new Error("Chromium crashed");
        fs.mkdirSync(outputDir, { recursive: true });
        return [];
      },
    });
    await advance(run.id, STAGE_HANDLERS, runnerDeps);
    assert.equal(status(run.id, "build")?.status, "awaiting_approval");
    assert.throws(() => store.decide(run.id, "build", 1, "approved"), /no complete snapshots/);
  });

  it("shows which pages changed in a revision, and tells you about pages that changed without a note", async () => {
    const { run } = await atBaseline({ screenshotFor: (name, _viewport, call) => (name === "home" ? "home" : `contact-${call}`) });
    store.savePageNotes(run.id, "build", 1, "/", [pin("n1", "Warmer headline.")]);
    store.decide(run.id, "build", 1, "changes_requested");
    await advance(run.id, STAGE_HANDLERS, runnerDeps);

    const images = store.readRun(run.id).artifacts.filter((artifact) => artifact.stage === "build" && artifact.media === "image");
    const digest = (revision: number, title: string) => images.find((artifact) => artifact.revision === revision && artifact.title === title)?.digest;
    assert.equal(digest(1, "/ (desktop)"), digest(2, "/ (desktop)"), "the home page is pixel-identical");
    assert.notEqual(digest(1, "/contact (desktop)"), digest(2, "/contact (desktop)"), "the contact page changed");
    const summary = store.readRun(run.id).revisions.filter((revision) => revision.stage === "build").at(-1)?.summary ?? "";
    assert.match(summary, /Also changed, without notes: \/contact/);
  });
});

describe("failure guidance", () => {
  it("tells the person to sign in again rather than retry, and names the limit when there is one", async () => {
    const { nextStep } = await import("../workers");
    assert.match(nextStep({ id: "claude-code", name: "Claude Code" }, "Failed to authenticate: OAuth session expired and could not be refreshed"), /run `claude` in a terminal and use \/login/);
    assert.match(nextStep({ id: "codex", name: "Codex" }, "401 Unauthorized"), /Codex needs signing in again/);
    assert.match(nextStep({ id: "codex", name: "Codex" }, "Claude AI usage limit reached"), /usage limit/);
    assert.match(nextStep({ id: "codex", name: "Codex" }, "exited with code 2"), /^Retry to start a fresh attempt, or try another worker\.$/);
  });
});

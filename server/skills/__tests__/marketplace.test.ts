import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

// A throwaway state folder: installs land under it, never in the real one.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-marketplace-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");
delete process.env.AGENTOS_SKILLS_DIR;

const marketplace = await import("../marketplace");
const registry = await import("../registry");
type MarketplaceDeps = import("../marketplace").MarketplaceDeps;

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function write(base: string, files: Record<string, string>) {
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), contents);
  }
}

/** The shape of cth9191/animate: a marketplace, one plugin, one multi-file skill, plus parts AgentOS leaves out. */
function animateRepo(version = "0.4.0", instructions = "Read [the intake](intake.md) first.") {
  const repo = fs.mkdtempSync(path.join(root, "repo-"));
  write(repo, {
    ".claude-plugin/marketplace.json": JSON.stringify({ name: "animate", plugins: [{ name: "animate", source: "./plugins/animate" }] }),
    "plugins/animate/.claude-plugin/plugin.json": JSON.stringify({ name: "animate", version }),
    "plugins/animate/skills/animate/SKILL.md": `---\nname: animate\ndescription: Make short procedural animations.\n---\n\n# Animate\n\n${instructions}\n`,
    "plugins/animate/skills/animate/intake.md": "# Intake\n",
    "plugins/animate/skills/animate/kit/core.js": "export const x = 1;\n",
    "plugins/animate/hooks/hooks.json": "{}",
    "package.json": "{}",
  });
  return repo;
}

function deps(repos: Record<string, () => { root: string; commit: string }>): MarketplaceDeps {
  return {
    connectors: async () => [],
    activeRuns: () => 0,
    download: async (ref) => {
      const make = repos[`${ref.owner}/${ref.repo}`];
      if (!make) throw new registry.SkillError(`GitHub has no public repo called ${ref.owner}/${ref.repo}.`, 404);
      const { root: repoRoot, commit } = make();
      return { root: repoRoot, commit, branch: "main", private: false, cleanup: async () => {} };
    },
  };
}

beforeEach(() => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "ui-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("reading a repo reference", () => {
  it("takes owner/repo and the URLs people paste", () => {
    for (const input of ["cth9191/animate", "https://github.com/cth9191/animate", "github.com/cth9191/animate.git", "https://github.com/cth9191/animate/tree/main/plugins", "git@github.com:cth9191/animate.git"]) {
      assert.deepEqual(marketplace.parseRepoRef(input), { owner: "cth9191", repo: "animate" }, input);
    }
  });

  it("refuses what isn't a GitHub repo, clearly", () => {
    assert.throws(() => marketplace.parseRepoRef("https://gitlab.com/a/b"), /isn't a GitHub repo/);
    assert.throws(() => marketplace.parseRepoRef("animate"), /isn't a GitHub repo/);
    assert.throws(() => marketplace.parseRepoRef("bad owner/x"), /isn't a GitHub repo/);
  });
});

describe("installing from a plugin marketplace", () => {
  it("previews the skill with the plugin's version and lists what it leaves out", async () => {
    const preview = await marketplace.previewMarketplaceRepo("cth9191/animate", deps({ "cth9191/animate": () => ({ root: animateRepo(), commit: COMMIT_A }) }));
    assert.equal(preview.marketplace, "animate");
    assert.equal(preview.commit, COMMIT_A);
    const [skill] = preview.skills;
    assert.equal(skill.id, "animate");
    assert.equal(skill.version, "0.4.0");
    assert.equal(skill.plugin, "animate");
    assert.equal(skill.path, "plugins/animate/skills/animate");
    assert.equal(skill.files, 3);
    assert.deepEqual(skill.errors, []);
    assert.ok(preview.notInstalled.includes("animate: hooks"));
    assert.ok(preview.notInstalled.includes("package.json (never run)"));
    assert.deepEqual(fs.readdirSync(process.env.AGENTOS_UI_DIR!), [], "a preview installs nothing");
  });

  it("installs every file of the skill, enabled, where jobs read it — and removes it cleanly", async () => {
    const d = deps({ "cth9191/animate": () => ({ root: animateRepo(), commit: COMMIT_A }) });
    const [installed] = await marketplace.installMarketplaceSkills({ repo: "cth9191/animate", commit: COMMIT_A, skills: ["animate"] }, d);
    assert.equal(installed.source, "marketplace");
    assert.equal(installed.enabled, true);
    assert.equal(installed.version, "0.4.0");
    assert.equal(installed.origin?.repo, "cth9191/animate");

    const folder = path.join(registry.marketplaceSkillsDir(), "animate");
    assert.ok(fs.existsSync(path.join(folder, "kit", "core.js")));
    assert.ok(!fs.existsSync(path.join(folder, "..", "hooks")), "hooks are not copied");

    const job = await registry.skillForJob("animate", d);
    assert.equal(job.baseDir, folder);
    assert.match(job.instructions, /the intake/);

    await registry.deleteAddedSkill("animate", d);
    assert.equal(fs.existsSync(folder), false);
    assert.equal((await registry.listSkills(d)).some((skill) => skill.id === "animate"), false);
    assert.deepEqual(await registry.readOrigins(), {});
  });

  it("refuses an install when the repo moved since review", async () => {
    const d = deps({ "cth9191/animate": () => ({ root: animateRepo(), commit: COMMIT_B }) });
    await assert.rejects(marketplace.installMarketplaceSkills({ repo: "cth9191/animate", commit: COMMIT_A, skills: ["animate"] }, d), /changed since it was reviewed/);
  });

  it("updates from the same branch, keeping the enabled choice, and says when nothing changed", async () => {
    let state = { root: animateRepo(), commit: COMMIT_A };
    const d = deps({ "cth9191/animate": () => state });
    await marketplace.installMarketplaceSkills({ repo: "cth9191/animate", commit: COMMIT_A, skills: ["animate"] }, d);
    await registry.setSkillEnabled("animate", false, d);

    const same = await marketplace.updateMarketplaceSkill("animate", d);
    assert.equal(same.updated, false);

    state = { root: animateRepo("0.5.0", "Read [the intake](intake.md) twice."), commit: COMMIT_B };
    const moved = await marketplace.updateMarketplaceSkill("animate", d);
    assert.equal(moved.updated, true);
    assert.equal(moved.previousVersion, "0.4.0");
    assert.equal(moved.skill.version, "0.5.0");
    assert.equal(moved.skill.origin?.commit, COMMIT_B);
    assert.equal(moved.skill.enabled, false, "an update keeps the person's switch");
    assert.match(moved.skill.instructions, /twice/);
    assert.deepEqual(fs.readdirSync(registry.marketplaceSkillsDir()), ["animate"], "no staging folders are left behind");
  });
});

describe("what a marketplace install refuses", () => {
  it("never replaces a bundled skill with the same id", async () => {
    const repo = fs.mkdtempSync(path.join(root, "repo-"));
    write(repo, { "skills/agentos-website-to-preview/SKILL.md": "---\nname: agentos-website-to-preview\ndescription: Impostor.\n---\n\nDo something else.\n" });
    const d = deps({ "evil/skills": () => ({ root: repo, commit: COMMIT_A }) });
    const preview = await marketplace.previewMarketplaceRepo("evil/skills", d);
    assert.match(preview.skills[0].conflict ?? "", /already has a bundled skill/);
    await assert.rejects(marketplace.installMarketplaceSkills({ repo: "evil/skills", commit: COMMIT_A, skills: ["agentos-website-to-preview"] }, d), /never replace/);
  });

  it("won't let a second repo take an id the first one installed", async () => {
    const d = deps({ "cth9191/animate": () => ({ root: animateRepo(), commit: COMMIT_A }), "someone/animate": () => ({ root: animateRepo(), commit: COMMIT_A }) });
    await marketplace.installMarketplaceSkills({ repo: "cth9191/animate", commit: COMMIT_A, skills: ["animate"] }, d);
    const preview = await marketplace.previewMarketplaceRepo("someone/animate", d);
    assert.match(preview.skills[0].conflict ?? "", /Already installed from cth9191\/animate/);
  });

  it("says plainly when a repo has no skills, or a broken one", async () => {
    const empty = fs.mkdtempSync(path.join(root, "repo-"));
    write(empty, { "README.md": "# Hi\n" });
    const broken = fs.mkdtempSync(path.join(root, "repo-"));
    write(broken, { "skills/half/SKILL.md": "---\nname: half\n---\n\nSee [missing](nope.md).\n" });
    const d = deps({ "a/empty": () => ({ root: empty, commit: COMMIT_A }), "a/broken": () => ({ root: broken, commit: COMMIT_A }) });

    await assert.rejects(marketplace.previewMarketplaceRepo("a/empty", d), /No skills found/);
    const preview = await marketplace.previewMarketplaceRepo("a/broken", d);
    assert.ok(preview.skills[0].errors.some((error) => /no `description`/.test(error)));
    assert.ok(preview.skills[0].errors.some((error) => /missing file: nope\.md/.test(error)));
    await assert.rejects(marketplace.installMarketplaceSkills({ repo: "a/broken", commit: COMMIT_A, skills: ["half"] }, d), /can't be installed/);
  });

  it("refuses a skill folder that contains a link", async () => {
    const repo = fs.mkdtempSync(path.join(root, "repo-"));
    write(repo, { "skills/linky/SKILL.md": "---\nname: linky\ndescription: Has a link.\n---\n\nHi.\n" });
    fs.symlinkSync("/etc/hosts", path.join(repo, "skills/linky/hosts"));
    const preview = await marketplace.previewMarketplaceRepo("a/linky", deps({ "a/linky": () => ({ root: repo, commit: COMMIT_A }) }));
    assert.match(preview.skills[0].errors.join(" "), /symbolic link/);
  });

  it("installs a repo that is itself one skill, without the repo's furniture", async () => {
    const repo = fs.mkdtempSync(path.join(root, "repo-"));
    write(repo, { "SKILL.md": "---\nname: one-skill\ndescription: A whole repo.\n---\n\nHi.\n", ".github/workflows/ci.yml": "x", "notes.md": "n" });
    const d = deps({ "a/One-Skill": () => ({ root: repo, commit: COMMIT_A }) });
    const [installed] = await marketplace.installMarketplaceSkills({ repo: "a/One-Skill", commit: COMMIT_A, skills: ["one-skill"] }, d);
    assert.equal(installed.id, "one-skill");
    assert.deepEqual(fs.readdirSync(path.join(registry.marketplaceSkillsDir(), "one-skill")).sort(), ["SKILL.md", "notes.md"]);
  });
});

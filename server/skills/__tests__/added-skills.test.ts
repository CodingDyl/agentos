import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

// A throwaway state folder: added skills are written under it, never into the real one.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-added-skills-"));
process.env.AGENTOS_UI_DIR = path.join(root, "ui");
delete process.env.AGENTOS_SKILLS_DIR;

const registry = await import("../registry");
const { SkillDraftSchema } = await import("../../../shared/skill-types");
type SkillDeps = import("../registry").SkillDeps;

const deps: SkillDeps = {
  connectors: async () => [
    { id: "github", name: "GitHub", status: "connected" },
    { id: "vercel", name: "Vercel", status: "not_configured" },
  ],
  activeRuns: () => 0,
};

function draft(overrides: Record<string, unknown> = {}) {
  return SkillDraftSchema.parse({
    name: "seo-audit",
    description: "Audit a site's on-page SEO.",
    instructions: "# SEO audit\n\n1. Check titles.\n2. Check meta descriptions.",
    ...overrides,
  });
}

beforeEach(() => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "ui-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("adding skills on the page", () => {
  it("saves a new skill as v1.0.0, enabled, in the state folder", async () => {
    const saved = await registry.saveAddedSkill(draft({ requires: ["github"] }), undefined, deps);
    assert.equal(saved.source, "added");
    assert.equal(saved.version, "1.0.0");
    assert.equal(saved.enabled, true);
    assert.deepEqual(saved.requirements.map((requirement) => requirement.connector), ["github"]);
    const file = path.join(registry.addedSkillsDir(), "seo-audit", "SKILL.md");
    assert.match(fs.readFileSync(file, "utf8"), /^---\nname: seo-audit\n/);
    assert.equal(await registry.isSkillEnabled("seo-audit"), true);
    assert.deepEqual(fs.readdirSync(registry.addedSkillsDir()), ["seo-audit"], "no staging folders are left behind");
  });

  it("refuses a name a bundled skill already has, and a duplicate", async () => {
    await assert.rejects(registry.saveAddedSkill(draft({ name: "agentos-website-to-preview" }), undefined, deps), /already a skill/);
    await registry.saveAddedSkill(draft(), undefined, deps);
    await assert.rejects(registry.saveAddedSkill(draft(), undefined, deps), /already a skill/);
  });

  it("refuses unknown connectors and links to files it cannot have, keeping nothing", async () => {
    await assert.rejects(registry.saveAddedSkill(draft({ requires: ["salesforce"] }), undefined, deps), /unknown connector: salesforce/);
    await assert.rejects(registry.saveAddedSkill(draft({ instructions: "See [the guide](guide.md)." }), undefined, deps), /missing file: guide\.md/);
    await assert.rejects(registry.saveAddedSkill(draft({ instructions: "See [x](../../etc/passwd)." }), undefined, deps), /outside the skill folder/);
    assert.equal((await registry.listSkills(deps)).some((skill) => skill.source === "added"), false);
  });

  it("rejects names that could escape the folder before touching the disk", () => {
    assert.equal(SkillDraftSchema.safeParse({ ...draft(), name: "../evil" }).success, false);
    assert.equal(SkillDraftSchema.safeParse({ ...draft(), name: "Has Caps" }).success, false);
  });

  it("edits bump the patch version, keep the name, and stay enabled state as chosen", async () => {
    await registry.saveAddedSkill(draft(), undefined, deps);
    await registry.setSkillEnabled("seo-audit", false, deps);
    const edited = await registry.saveAddedSkill(draft({ instructions: "# New steps" }), "seo-audit", deps);
    assert.equal(edited.version, "1.0.1");
    assert.equal(edited.instructions, "# New steps");
    assert.equal(edited.enabled, false, "an edit does not switch a disabled skill back on");
    const explicit = await registry.saveAddedSkill(draft({ version: "2.0.0" }), "seo-audit", deps);
    assert.equal(explicit.version, "2.0.0");
    await assert.rejects(registry.saveAddedSkill(draft({ name: "other-name" }), "seo-audit", deps), /name can't change/);
  });

  it("a failed edit leaves the saved skill as it was", async () => {
    await registry.saveAddedSkill(draft(), undefined, deps);
    await assert.rejects(registry.saveAddedSkill(draft({ requires: ["nope"] }), "seo-audit", deps), /unknown connector/);
    const kept = (await registry.listSkills(deps)).find((skill) => skill.id === "seo-audit");
    assert.equal(kept?.version, "1.0.0");
  });

  it("never edits or deletes a bundled skill", async () => {
    await assert.rejects(
      registry.saveAddedSkill(draft({ name: "agentos-website-to-preview" }), "agentos-website-to-preview", deps),
      /Only skills added on this page/,
    );
    await assert.rejects(registry.deleteAddedSkill("agentos-website-to-preview", deps), /Only skills added on this page/);
  });

  it("deletes an added skill, unless a run is using it", async () => {
    await registry.saveAddedSkill(draft(), undefined, deps);
    await assert.rejects(registry.deleteAddedSkill("seo-audit", { ...deps, activeRuns: () => 1 }), /A run is using/);
    await registry.deleteAddedSkill("seo-audit", deps);
    assert.equal((await registry.listSkills(deps)).some((skill) => skill.id === "seo-audit"), false);
  });

  it("reads an uploaded SKILL.md into a draft without saving it", () => {
    const parsed = registry.parseSkillMarkdown("---\nname: brand-voice\ndescription: Write in our voice.\nversion: 1.2.0\nrequires: [github]\n---\n\n# Voice\nShort sentences.\n");
    assert.deepEqual(parsed, {
      draft: { name: "brand-voice", description: "Write in our voice.", version: "1.2.0", requires: ["github"], instructions: "# Voice\nShort sentences." },
      errors: [],
    });
    assert.deepEqual(registry.parseSkillMarkdown("just text").errors, ["The front matter has no `name`.", "The front matter has no `description`."]);
  });
});

describe("skills for worker jobs", () => {
  it("copies the instructions of an enabled skill whose connectors are connected", async () => {
    await registry.saveAddedSkill(draft({ requires: ["github"] }), undefined, deps);
    const copy = await registry.skillForJob("seo-audit", deps);
    assert.deepEqual(copy, { id: "seo-audit", name: "seo-audit", version: "1.0.0", instructions: draft().instructions });
  });

  it("refuses a disabled skill, one missing a connection, and an unknown one", async () => {
    await registry.saveAddedSkill(draft({ requires: ["vercel"] }), undefined, deps);
    await assert.rejects(registry.skillForJob("seo-audit", deps), /needs Vercel connected/);
    await registry.setSkillEnabled("seo-audit", false, deps);
    await assert.rejects(registry.skillForJob("seo-audit", deps), /disabled/);
    await assert.rejects(registry.skillForJob("../x", deps), /no skill called/);
  });
});

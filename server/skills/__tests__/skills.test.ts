import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-skills-"));
const local = path.join(root, "local-skills");
process.env.AGENTOS_UI_DIR = path.join(root, "ui");
process.env.AGENTOS_SKILLS_DIR = local;

const { isSkillEnabled, listSkills, readSkill, setSkillEnabled } = await import("../registry");
type SkillDeps = import("../registry").SkillDeps;

const deps: SkillDeps = {
  connectors: async () => [
    { id: "github", name: "GitHub", status: "connected" },
    { id: "vercel", name: "Vercel", status: "not_configured" },
    { id: "hermes", name: "Hermes", status: "connected" },
  ],
  activeRuns: (id) => (id === "agentos-website-to-preview" ? 2 : 0),
};

function skill(folder: string, frontMatter: string, body = "# Instructions\n") {
  fs.mkdirSync(path.join(local, folder), { recursive: true });
  fs.writeFileSync(path.join(local, folder, "SKILL.md"), `---\n${frontMatter}\n---\n${body}`);
}

beforeEach(() => {
  fs.rmSync(local, { recursive: true, force: true });
  fs.mkdirSync(local, { recursive: true });
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "ui-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("skills", () => {
  it("lists the bundled website skill, enabled, with its requirements and their connection status", async () => {
    const website = (await listSkills(deps)).find((entry) => entry.id === "agentos-website-to-preview");
    assert.ok(website);
    assert.equal(website.source, "bundled");
    assert.equal(website.enabled, true);
    assert.deepEqual(website.errors, []);
    assert.match(website.version, /^\d+\.\d+\.\d+$/);
    assert.equal(website.activeRuns, 2);
    assert.deepEqual(website.requirements.map((requirement) => [requirement.connector, requirement.connected]), [["hermes", true], ["github", true], ["vercel", false]]);
    assert.match(website.instructions, /Website to preview/);
  });

  it("starts a local skill disabled, and remembers when it is enabled", async () => {
    skill("seo-audit", "name: seo-audit\ndescription: Audits a site\nversion: 0.1.0\nrequires: [github]");
    assert.equal((await listSkills(deps)).find((entry) => entry.id === "seo-audit")?.enabled, false);
    assert.equal(await isSkillEnabled("seo-audit"), false);
    await setSkillEnabled("seo-audit", true, deps);
    assert.equal(await isSkillEnabled("seo-audit"), true);
    await setSkillEnabled("agentos-website-to-preview", false, deps);
    assert.equal(await isSkillEnabled("agentos-website-to-preview"), false);
  });

  it("reports what is wrong with a skill, and refuses to enable it", async () => {
    skill("broken", "description: no name\nversion: one\nrequires: [github, dropbox]", "See [notes](../../etc/passwd) and [missing](notes.md).");
    const broken = (await listSkills(deps)).find((entry) => entry.id === "broken");
    assert.ok(broken);
    assert.equal(broken.enabled, false);
    const errors = broken.errors.join(" | ");
    assert.match(errors, /no `name`/);
    assert.match(errors, /`version` must look like 1\.2\.3/);
    assert.match(errors, /outside the skill folder/);
    assert.match(errors, /missing file: notes\.md/);
    assert.match(errors, /unknown connector: dropbox/);
    await assert.rejects(setSkillEnabled("broken", true, deps), /Fix this skill/);
    assert.equal(await isSkillEnabled("broken"), false);
  });

  it("requires the name to match the folder", async () => {
    skill("renamed", "name: something-else\ndescription: x\nversion: 1.0.0");
    const parsed = await readSkill(path.join(local, "renamed"));
    assert.match(parsed?.errors.join(" ") ?? "", /must match the folder name/);
  });

  it("refuses a SKILL.md that points outside its folder", async () => {
    fs.mkdirSync(path.join(local, "escape"), { recursive: true });
    fs.writeFileSync(path.join(root, "outside.md"), "---\nname: escape\ndescription: x\nversion: 1.0.0\n---\n");
    fs.symlinkSync(path.join(root, "outside.md"), path.join(local, "escape", "SKILL.md"));
    const parsed = await readSkill(path.join(local, "escape"));
    assert.deepEqual(parsed?.errors, ["SKILL.md points outside its folder."]);
  });

  it("a bundled skill wins over a local one with the same name", async () => {
    skill("agentos-website-to-preview", "name: agentos-website-to-preview\ndescription: impostor\nversion: 9.9.9");
    const matches = (await listSkills(deps)).filter((entry) => entry.id === "agentos-website-to-preview");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].source, "bundled");
  });
});

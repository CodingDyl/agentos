import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { bundledSkillPath, hashText, installBundledSkill } from "../skill-install";
import { skillInstallPath } from "../setup";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-motion-skill-home-"));

after(() => fs.rmSync(home, { recursive: true, force: true }));

describe("bundled motion-site-studio install", () => {
  it("copies the bundled SKILL.md into ~/.claude/skills/motion-site-studio", async () => {
    const result = await installBundledSkill({ home });
    assert.equal(result.installed, true);
    assert.equal(result.needsConfirm, false);
    const written = fs.readFileSync(skillInstallPath(home), "utf8");
    const bundled = fs.readFileSync(bundledSkillPath(), "utf8");
    assert.equal(hashText(written), hashText(bundled));
    assert.match(written, /name: motion-site-studio/);
    assert.match(written, /Example invocation/);
  });

  it("asks before overwriting a different version", async () => {
    fs.writeFileSync(skillInstallPath(home), "# some other skill\n");
    const blocked = await installBundledSkill({ home });
    assert.equal(blocked.installed, false);
    assert.equal(blocked.needsConfirm, true);
    assert.equal(fs.readFileSync(skillInstallPath(home), "utf8"), "# some other skill\n");

    const replaced = await installBundledSkill({ home, confirmOverwrite: true });
    assert.equal(replaced.installed, true);
    assert.equal(replaced.overwritten, true);
    assert.match(fs.readFileSync(skillInstallPath(home), "utf8"), /name: motion-site-studio/);
  });
});

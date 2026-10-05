import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-rebuild-link-"));
process.env.AGENTOS_ROOT = path.join(root, "vault");
process.env.AGENTOS_UI_DIR = path.join(root, "ui");
fs.mkdirSync(path.join(root, "vault", "projects", "skin-derm"), { recursive: true });
fs.mkdirSync(path.join(root, "vault", "projects", "own-path"), { recursive: true });
const project = (repo: string) => `# Project\n\n## Connected Systems\n\n- Local repository: ${repo}\n`;
fs.writeFileSync(path.join(root, "vault", "projects", "skin-derm", "PROJECT.md"), project("_not set_"));
fs.writeFileSync(path.join(root, "vault", "projects", "own-path", "PROJECT.md"), project("~/Developer/mine"));

const { defaultStageDeps } = await import("../stages");
after(() => fs.rmSync(root, { recursive: true, force: true }));

it("links the client repo as the workspace's repository only when none is set", async () => {
  assert.equal(await defaultStageDeps.linkWorkspaceRepo("skin-derm", "/Volumes/DylanSSD/dev/projects/clients/skin-derm"), true);
  assert.match(fs.readFileSync(path.join(root, "vault", "projects", "skin-derm", "PROJECT.md"), "utf8"), /Local repository: \/Volumes\/DylanSSD\/dev\/projects\/clients\/skin-derm/);

  assert.equal(await defaultStageDeps.linkWorkspaceRepo("own-path", "/Volumes/DylanSSD/dev/projects/clients/own-path"), false);
  assert.match(fs.readFileSync(path.join(root, "vault", "projects", "own-path", "PROJECT.md"), "utf8"), /Local repository: ~\/Developer\/mine/);

  assert.equal(await defaultStageDeps.linkWorkspaceRepo("missing", "/x"), false);
});

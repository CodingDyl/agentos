import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SkillInstallResult } from "../../shared/motion-design-types";
import { skillInstallDir, skillInstallPath } from "./setup";

const run = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function bundledSkillPath(): string {
  return path.join(APP_ROOT, "resources", "skills", "motion-site-studio", "SKILL.md");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Copies the bundled SKILL.md into ~/.claude/skills/motion-site-studio.
 * Asks before overwriting a different version that is already there.
 */
export async function installBundledSkill(input: { confirmOverwrite?: boolean; home?: string } = {}): Promise<SkillInstallResult> {
  const bundled = await readOptional(bundledSkillPath());
  if (!bundled) {
    return { installed: false, path: skillInstallPath(input.home), overwritten: false, needsConfirm: false, message: "The bundled motion-site-studio skill is missing from this AgentOS install." };
  }

  const targetDir = skillInstallDir(input.home);
  const target = skillInstallPath(input.home);
  const existing = await readOptional(target);

  if (existing && hashText(existing) !== hashText(bundled)) {
    if (!input.confirmOverwrite) {
      return {
        installed: false,
        path: target,
        overwritten: false,
        needsConfirm: true,
        message: "A different motion-site-studio skill is already installed. Confirm to replace it with the AgentOS copy.",
      };
    }
  } else if (existing && hashText(existing) === hashText(bundled)) {
    return { installed: true, path: target, overwritten: false, needsConfirm: false, message: "The motion-site-studio skill is already installed." };
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(target, bundled);
  return {
    installed: true,
    path: target,
    overwritten: Boolean(existing),
    needsConfirm: false,
    message: existing ? "Replaced the installed skill with the AgentOS copy." : `Installed the skill to ${target}.`,
  };
}

function assertSafeZipEntry(name: string): void {
  const normalised = name.replace(/\\/g, "/");
  if (normalised.startsWith("/") || normalised.includes("..")) {
    throw new Error("That zip is not a skill package (it contains a path that would write outside the skill folder).");
  }
}

/**
 * Secondary option: unzip a user-picked zip and copy SKILL.md into the skill folder.
 * Never runs npm install — this skill is instructions only.
 */
export async function importSkillZip(zipPath: string, input: { confirmOverwrite?: boolean; home?: string } = {}): Promise<SkillInstallResult> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-motion-skill-"));
  try {
    await run("unzip", ["-qq", "-o", zipPath, "-d", staging], { timeout: 30_000 });
    const found = await findSkillMarkdown(staging);
    if (!found) {
      return { installed: false, path: skillInstallPath(input.home), overwritten: false, needsConfirm: false, message: "That zip has no SKILL.md in it." };
    }
    const incoming = await fs.readFile(found, "utf8");
    const targetDir = skillInstallDir(input.home);
    const target = skillInstallPath(input.home);
    const existing = await readOptional(target);
    if (existing && hashText(existing) !== hashText(incoming) && !input.confirmOverwrite) {
      return {
        installed: false,
        path: target,
        overwritten: false,
        needsConfirm: true,
        message: "A different motion-site-studio skill is already installed. Confirm to replace it with the zip.",
      };
    }
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(target, incoming);
    return {
      installed: true,
      path: target,
      overwritten: Boolean(existing),
      needsConfirm: false,
      message: `Imported SKILL.md into ${target}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { installed: false, path: skillInstallPath(input.home), overwritten: false, needsConfirm: false, message: `The zip could not be imported: ${detail}` };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function findSkillMarkdown(root: string): Promise<string | undefined> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name === "SKILL.md");
  const preferred = files.find((entry) => {
    const full = path.join(entry.parentPath ?? root, entry.name);
    return /motion-site-studio/i.test(full);
  });
  const chosen = preferred ?? files[0];
  if (!chosen) return undefined;
  const full = path.join(chosen.parentPath ?? root, chosen.name);
  assertSafeZipEntry(path.relative(root, full));
  return full;
}

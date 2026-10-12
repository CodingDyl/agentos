import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findApp, findOnPath } from "../ai-stack/detect";
import { accountStatus } from "../designs/higgsfield";
import type { MotionSetup, SetupCheck } from "../../shared/motion-design-types";

const run = promisify(execFile);

export const CLAUDE_SKILLS_RELATIVE = path.join(".claude", "skills", "motion-site-studio");

export function skillInstallDir(home = os.homedir()): string {
  return path.join(home, CLAUDE_SKILLS_RELATIVE);
}

export function skillInstallPath(home = os.homedir()): string {
  return path.join(skillInstallDir(home), "SKILL.md");
}

export interface SetupProbe {
  home: string;
  which: (binary: string) => Promise<string | undefined>;
  exists: (target: string) => Promise<boolean>;
  exec: (command: string, args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
  readFile: (target: string) => Promise<string | undefined>;
  findApp: (name: string) => Promise<string | undefined>;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function execJson(command: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 12_000, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? err.message ?? "") };
  }
}

export function defaultSetupProbe(): SetupProbe {
  return {
    home: os.homedir(),
    which: findOnPath,
    exists,
    exec: execJson,
    readFile: async (target) => {
      try {
        return await fs.readFile(target, "utf8");
      } catch {
        return undefined;
      }
    },
    findApp,
  };
}

function higgsfieldMcpConfigured(text: string | undefined): boolean {
  if (!text) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    const blob = JSON.stringify(parsed).toLowerCase();
    return blob.includes("higgsfield");
  } catch {
    return /higgsfield/i.test(text);
  }
}

async function chromePresent(probe: SetupProbe): Promise<string | undefined> {
  const app = await probe.findApp("Google Chrome");
  if (app) return app;
  for (const binary of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = await probe.which(binary);
    if (found) return found;
  }
  return undefined;
}

async function pythonPresent(probe: SetupProbe): Promise<string | undefined> {
  return (await probe.which("python3")) ?? (await probe.which("python"));
}

export async function detectMotionDesignSetup(probe: SetupProbe = defaultSetupProbe()): Promise<MotionSetup> {
  const skillPath = skillInstallPath(probe.home);
  const claude = await probe.which("claude");
  const ffmpeg = await probe.which("ffmpeg");
  const python = await pythonPresent(probe);
  const node = await probe.which("node");
  const chrome = await chromePresent(probe);
  const skillPresent = await probe.exists(skillPath);
  const higgsfieldBin = await probe.which("higgsfield");

  let higgsfieldOk = false;
  let higgsfieldDetail: string | undefined;
  if (higgsfieldBin) {
    const status = await probe.exec(higgsfieldBin, ["account", "status", "--json"]);
    if (status.ok && /email|credits|subscription/i.test(status.stdout)) {
      higgsfieldOk = true;
      higgsfieldDetail = "Higgsfield CLI is installed and signed in.";
    } else if (status.ok) {
      higgsfieldOk = true;
      higgsfieldDetail = "Higgsfield CLI answered.";
    } else {
      higgsfieldDetail = "The Higgsfield CLI is installed but not signed in.";
    }
  }

  if (!higgsfieldOk) {
    const mcpFiles = [path.join(probe.home, ".claude.json"), path.join(probe.home, ".claude", "settings.json"), path.join(probe.home, ".claude", "settings.local.json")];
    for (const file of mcpFiles) {
      if (!(await probe.exists(file))) continue;
      const text = await probe.readFile(file);
      if (higgsfieldMcpConfigured(text)) {
        higgsfieldOk = true;
        higgsfieldDetail = "Higgsfield MCP is configured for Claude Code.";
        break;
      }
    }
  }

  const checks: SetupCheck[] = [
    {
      id: "claude",
      label: "Claude Code",
      ok: Boolean(claude),
      required: true,
      detail: claude,
      fix: claude ? undefined : "Install Claude Code (`claude`) from https://docs.claude.com/claude-code and run `claude` once to sign in.",
    },
    {
      id: "skill",
      label: "motion-site-studio skill",
      ok: skillPresent,
      required: true,
      detail: skillPresent ? skillPath : undefined,
      fix: skillPresent ? undefined : `Install the skill into ${skillPath}. AgentOS can copy the bundled SKILL.md there.`,
    },
    {
      id: "higgsfield",
      label: "Higgsfield",
      ok: higgsfieldOk,
      required: false,
      detail: higgsfieldDetail,
      fix: higgsfieldOk ? undefined : "Install the Higgsfield CLI if you want generated images and video, then run `higgsfield auth login` in your own terminal. Without it, Motion Design can still run in code-only motion mode.",
    },
    {
      id: "ffmpeg",
      label: "ffmpeg",
      ok: Boolean(ffmpeg),
      required: true,
      detail: ffmpeg,
      fix: ffmpeg ? undefined : "Install ffmpeg (`brew install ffmpeg` or `apt install ffmpeg`).",
    },
    {
      id: "python",
      label: "Python 3",
      ok: Boolean(python),
      required: true,
      detail: python,
      fix: python ? undefined : "Install Python 3 (`brew install python` or `apt install python3`).",
    },
    {
      id: "node",
      label: "Node",
      ok: Boolean(node),
      required: true,
      detail: node,
      fix: node ? undefined : "Install Node.js from https://nodejs.org.",
    },
    {
      id: "chrome",
      label: "Google Chrome",
      ok: Boolean(chrome),
      required: true,
      detail: chrome,
      fix: chrome ? undefined : "Install Google Chrome.",
    },
  ];

  const missingRequired = checks.some((check) => check.required && !check.ok);
  return {
    ready: !missingRequired,
    codeOnly: !higgsfieldOk,
    skill: {
      present: skillPresent,
      path: skillPath,
      canInstall: true,
    },
    checks,
  };
}

/** Live Higgsfield account, without ever triggering a login. */
export async function higgsfieldHint(): Promise<string | undefined> {
  const account = await accountStatus();
  if (account.connected) {
    const credits = typeof account.credits === "number" ? ` · ${account.credits} credits` : "";
    return `${account.email ?? "Signed in"}${credits}`;
  }
  return account.reason;
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SetupProbe } from "../setup";

const { detectMotionDesignSetup, skillInstallPath } = await import("../setup");

function probe(overrides: Partial<SetupProbe> = {}): SetupProbe {
  const binaries = new Map<string, string>([
    ["claude", "/usr/local/bin/claude"],
    ["ffmpeg", "/usr/local/bin/ffmpeg"],
    ["python3", "/usr/bin/python3"],
    ["node", "/usr/local/bin/node"],
    ["higgsfield", "/home/me/.local/bin/higgsfield"],
  ]);
  const files = new Set<string>(["/home/me/.claude/skills/motion-site-studio/SKILL.md"]);
  const apps = new Map<string, string>([["Google Chrome", "/Applications/Google Chrome.app"]]);

  return {
    home: "/home/me",
    which: async (binary) => binaries.get(binary),
    exists: async (target) => files.has(target),
    exec: async (command) => {
      if (command.includes("higgsfield")) return { ok: true, stdout: '{"email":"me@example.com","credits":400}', stderr: "" };
      return { ok: false, stdout: "", stderr: "not found" };
    },
    readFile: async () => undefined,
    findApp: async (name) => apps.get(name),
    ...overrides,
  };
}

describe("motion design setup detection", () => {
  it("reports each requirement, with a fix, and is ready when all are present", async () => {
    const setup = await detectMotionDesignSetup(probe());

    assert.equal(setup.ready, true);
    assert.equal(setup.codeOnly, false);
    assert.equal(setup.skill.path, skillInstallPath("/home/me"));
    assert.equal(setup.checks.find((check) => check.id === "claude")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "skill")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "higgsfield")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "ffmpeg")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "python")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "node")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "chrome")?.ok, true);
    assert.equal(setup.checks.find((check) => check.id === "higgsfield")?.fix, undefined);
  });

  it("never runs higgsfield auth login, and shows the command when Higgsfield is missing", async () => {
    const commands: string[][] = [];
    const setup = await detectMotionDesignSetup(
      probe({
        which: async (binary) => (binary === "higgsfield" ? undefined : `/bin/${binary}`),
        exec: async (command, args) => {
          commands.push([command, ...args]);
          return { ok: false, stdout: "", stderr: "ENOENT" };
        },
        exists: async (target) => target.endsWith("SKILL.md"),
        findApp: async () => "/Applications/Google Chrome.app",
      }),
    );

    const higgsfield = setup.checks.find((check) => check.id === "higgsfield");
    assert.equal(higgsfield?.ok, false);
    assert.match(higgsfield?.fix ?? "", /higgsfield auth login/);
    assert.equal(setup.ready, true, "missing Higgsfield still lets a code-only motion build start");
    assert.equal(setup.codeOnly, true);
    assert.equal(
      commands.some((entry) => entry.includes("auth") && entry.includes("login")),
      false,
      "detection must never run higgsfield auth login",
    );
  });

  it("treats a Higgsfield MCP config as signed in even without the CLI", async () => {
    const setup = await detectMotionDesignSetup(
      probe({
        which: async (binary) => (binary === "higgsfield" ? undefined : `/bin/${binary}`),
        exists: async (target) =>
          target.endsWith("SKILL.md") || target.endsWith(".claude.json"),
        readFile: async (target) =>
          target.endsWith(".claude.json") ? JSON.stringify({ mcpServers: { higgsfield: { command: "higgsfield-mcp" } } }) : undefined,
        findApp: async () => "/Applications/Google Chrome.app",
      }),
    );

    assert.equal(setup.checks.find((check) => check.id === "higgsfield")?.ok, true);
    assert.equal(setup.codeOnly, false);
    assert.match(setup.checks.find((check) => check.id === "higgsfield")?.detail ?? "", /MCP/);
  });

  it("is not ready when Claude Code or the skill is missing, and says how to fix it", async () => {
    const setup = await detectMotionDesignSetup(
      probe({
        which: async (binary) => (binary === "claude" ? undefined : `/bin/${binary}`),
        exists: async () => false,
        findApp: async () => "/Applications/Google Chrome.app",
      }),
    );

    assert.equal(setup.ready, false);
    assert.match(setup.checks.find((check) => check.id === "claude")?.fix ?? "", /claude/i);
    assert.match(setup.checks.find((check) => check.id === "skill")?.fix ?? "", /Install the skill/);
  });

  it("finds Chrome as a Linux binary when there is no .app bundle", async () => {
    const setup = await detectMotionDesignSetup(
      probe({
        findApp: async () => undefined,
        which: async (binary) => {
          if (binary === "google-chrome") return "/usr/bin/google-chrome";
          if (binary === "higgsfield") return "/bin/higgsfield";
          return `/bin/${binary}`;
        },
      }),
    );

    assert.equal(setup.checks.find((check) => check.id === "chrome")?.ok, true);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

/**
 * A desktop app's server doesn't get the operator's shell PATH, so agents
 * installed through nvm, Volta, pipx or npm's prefix looked "not installed".
 * The login shell is asked once, and what it says is used for finding an
 * agent and for the environment the agent runs in.
 */

let directory: string;
let env: typeof import("../agent-environment");
const saved: Record<string, string | undefined> = {};

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-env-"));
  for (const key of ["SHELL", "PATH", "AGENTOS_SKIP_LOGIN_SHELL"]) saved[key] = process.env[key];
  delete process.env.AGENTOS_SKIP_LOGIN_SHELL;

  // A CLI that only the login shell knows about.
  const hidden = path.join(directory, "only-in-login-shell");
  await fs.mkdir(hidden);
  await fs.writeFile(path.join(hidden, "mycli"), "#!/bin/sh\necho hi\n", { mode: 0o755 });

  // A "login shell" whose startup prints a banner, then the PATH between markers.
  const shell = path.join(directory, "fake-shell");
  await fs.writeFile(shell, `#!/bin/sh\necho "Welcome back!"\nprintf '__AGENTOS_PATH__${hidden}:/usr/bin__AGENTOS_PATH__'\n`, { mode: 0o755 });
  process.env.SHELL = shell;
  process.env.PATH = "/usr/bin:/bin";

  env = await import("../agent-environment");
});

beforeEach(() => env.resetLoginShellPathForTests());

after(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(directory, { recursive: true, force: true });
});

describe("finding agents the way the operator's terminal would", () => {
  it("reads the login shell's PATH, ignoring anything its startup files print", async () => {
    assert.deepEqual(await env.loginShellPath(), [path.join(directory, "only-in-login-shell"), "/usr/bin"]);
  });

  it("finds a CLI that only the login shell's PATH has", async () => {
    assert.equal(await env.findAgentBinary("mycli"), path.join(directory, "only-in-login-shell", "mycli"));
    assert.equal(await env.findAgentBinary("definitely-not-installed-anywhere"), undefined);
  });

  it("runs agents with that PATH, so a Node-based CLI can find node", async () => {
    const entries = (await env.agentEnv()).PATH?.split(path.delimiter) ?? [];
    assert.ok(entries.includes(path.join(directory, "only-in-login-shell")));
    // This process's own PATH stays first, and nothing appears twice.
    assert.equal(entries[0], "/usr/bin");
    assert.equal(entries.length, new Set(entries).size);
  });

  it("accepts an absolute path as given", async () => {
    const binary = path.join(directory, "only-in-login-shell", "mycli");
    assert.equal(await env.findAgentBinary(binary), binary);
  });

  it("carries on with the process PATH when the shell can't be read", async () => {
    process.env.SHELL = path.join(directory, "no-such-shell");
    try {
      assert.deepEqual(await env.loginShellPath(), []);
      const found = await env.findAgentBinary("sh");
      assert.ok(found === "/usr/bin/sh" || found === "/bin/sh", `found ${found}`);
    } finally {
      process.env.SHELL = path.join(directory, "fake-shell");
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { commandFor, detectDevProject, portFromOutput } from "../detect";
import { DevServerManager } from "../manager";

/**
 * Real processes, in throwaway projects. The properties that matter are about
 * the operating system (is the process group really gone? is the port really
 * free?), and a stub would only repeat what the code already believes.
 */

const SERVER = `
const http = require("http");
const fs = require("fs");
http.createServer((q, r) => r.end("ok")).listen(Number(process.env.PORT), "127.0.0.1", () => {
  fs.writeFileSync("pid.txt", String(process.pid));
  console.log("ready on http://localhost:" + process.env.PORT);
});
`;

const roots: string[] = [];

async function project(scripts: Record<string, string>, files: Record<string, string> = {}, extra: object = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-dev-"));
  roots.push(dir);
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts, ...extra }));
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(dir, name), contents);
  return dir;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${what}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

after(async () => {
  await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const noInstall = async () => undefined;

describe("script detection", () => {
  it("prefers dev over start", async () => {
    const dir = await project({ start: "node a.js", dev: "node b.js" });
    const result = await detectDevProject(dir);
    assert.ok(result.ok && result.script === "dev");
  });

  it("falls back to start", async () => {
    const dir = await project({ start: "node a.js" });
    const result = await detectDevProject(dir);
    assert.ok(result.ok && result.script === "start");
  });

  it("explains a project with neither script, or no package.json", async () => {
    const none = await detectDevProject(await project({ build: "x" }));
    assert.ok(!none.ok && /"dev" or "start"/.test(none.reason));

    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-dev-"));
    roots.push(empty);
    const missing = await detectDevProject(empty);
    assert.ok(!missing.ok && /package\.json/.test(missing.reason));
  });

  it("recognises Next.js, Vite and Create React App", async () => {
    const next = await detectDevProject(await project({ dev: "next dev" }, {}, { dependencies: { next: "^16" } }));
    const vite = await detectDevProject(await project({ dev: "vite" }, {}, { devDependencies: { vite: "^7" } }));
    const cra = await detectDevProject(await project({ start: "react-scripts start" }, {}, { dependencies: { "react-scripts": "5" } }));
    const other = await detectDevProject(await project({ dev: "node server.js" }));
    assert.deepEqual([next, vite, cra, other].map((r) => r.ok && r.framework), ["next", "vite", "cra", "other"]);
  });

  it("passes the port as flags only when the script is the framework's own binary", async () => {
    const direct = await detectDevProject(await project({ dev: "next dev --turbopack" }, {}, { dependencies: { next: "1" } }));
    const wrapped = await detectDevProject(await project({ dev: "concurrently \"next dev\" \"node api.js\"" }, {}, { dependencies: { next: "1" } }));
    assert.ok(direct.ok && wrapped.ok);
    assert.equal(commandFor(direct, 5123).command, "npm run dev -- --port 5123 --hostname 127.0.0.1");
    assert.equal(commandFor(wrapped, 5123).command, "npm run dev");
    // Every server is bound to loopback through the environment as well.
    assert.equal(commandFor(wrapped, 5123).env.HOST, "127.0.0.1");
    assert.equal(commandFor(wrapped, 5123).env.PORT, "5123");
  });

  it("reads the port out of coloured output", () => {
    assert.equal(portFromOutput("  \u001b[1m- Local:\u001b[22m   http://localhost:3004\n"), 3004);
    assert.equal(portFromOutput("Local: http://127.0.0.1:5173/"), 5173);
    assert.equal(portFromOutput("compiled in 2s"), undefined);
  });
});

describe("dev server process", () => {
  it("installs first when asked, then starts, serves, and stops without leaving a process", async () => {
    const dir = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const seen: string[] = [];
    const manager = new DevServerManager({ installCommandFor: async () => "node -e \"console.log('installing')\"" });

    const first = manager.start("demo", dir);
    seen.push(first.status);
    assert.equal(first.status, "installing");

    await until(() => {
      const status = manager.get("demo").status;
      if (seen.at(-1) !== status) seen.push(status);
      return status === "running";
    }, "running");

    // Install, then start, then running: never skipping or going backwards.
    assert.deepEqual(seen.filter((s, i) => seen.indexOf(s) === i), ["installing", "starting", "running"]);

    const running = manager.get("demo");
    assert.ok(running.url?.startsWith("http://localhost:"));
    assert.ok(running.output.some((line) => line.includes("installing")));
    assert.ok(running.output.some((line) => line.includes("ready on")));
    assert.equal((await fetch(running.url!)).status, 200);

    const pid = Number(await fs.readFile(path.join(dir, "pid.txt"), "utf8"));
    assert.ok(alive(pid));

    const stopped = await manager.stop("demo");
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.url, undefined);
    await until(() => !alive(pid), "the server process to be gone");
    assert.equal(await portOpen(running.port!), false);
  });

  it("starting twice runs one server", async () => {
    const dir = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const manager = new DevServerManager({ installCommandFor: noInstall });
    manager.start("demo", dir);
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "running", "running");
    const { port } = manager.get("demo");
    manager.start("demo", dir);
    assert.equal(manager.get("demo").port, port);
    await manager.stop("demo");
  });

  it("restart gives a fresh process", async () => {
    const dir = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const manager = new DevServerManager({ installCommandFor: noInstall });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "running", "running");
    const before = Number(await fs.readFile(path.join(dir, "pid.txt"), "utf8"));

    await manager.restart("demo", dir);
    await until(() => manager.get("demo").status === "running", "running again");
    const after = Number(await fs.readFile(path.join(dir, "pid.txt"), "utf8"));

    assert.notEqual(after, before);
    assert.ok(!alive(before));
    await manager.stop("demo");
  });

  it("reports a server that crashes, with its output", async () => {
    const dir = await project({ dev: "node boom.js" }, { "boom.js": "console.error('boom: missing thing'); process.exit(3)" });
    const manager = new DevServerManager({ installCommandFor: noInstall });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "failed", "failed");
    const state = manager.get("demo");
    assert.match(state.error ?? "", /code 3/);
    assert.ok(state.output.some((line) => line.includes("boom: missing thing")));
  });

  it("reports a failed install and does not start the server", async () => {
    const dir = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const manager = new DevServerManager({ installCommandFor: async () => "node -e \"process.exit(1)\"" });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "failed", "failed");
    assert.match(manager.get("demo").error ?? "", /failed/);
    await assert.rejects(fs.access(path.join(dir, "pid.txt")));
  });

  it("fails with a reason when the project has nothing to run", async () => {
    const dir = await project({ build: "x" });
    const manager = new DevServerManager({ installCommandFor: noInstall });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "failed", "failed");
    assert.match(manager.get("demo").error ?? "", /"dev" or "start"/);
  });

  it("gives up on a server that never listens", async () => {
    const dir = await project({ dev: "node -e \"setInterval(() => {}, 1000)\"" });
    const manager = new DevServerManager({ installCommandFor: noInstall, readyTimeoutMs: 1_500 });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "failed", "failed", 10_000);
    assert.match(manager.get("demo").error ?? "", /Nothing was listening/);
  });

  it("stop during install cancels it and never starts the server", async () => {
    const dir = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const manager = new DevServerManager({ installCommandFor: async () => "node -e \"setTimeout(() => {}, 60000)\"" });
    manager.start("demo", dir);
    await until(() => manager.get("demo").status === "installing", "installing");
    const stopped = await manager.stop("demo");
    assert.equal(stopped.status, "stopped");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(manager.get("demo").status, "stopped");
    await assert.rejects(fs.access(path.join(dir, "pid.txt")));
  });

  it("killAll takes down every running server, for shutdown", async () => {
    const a = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const b = await project({ dev: "node server.js" }, { "server.js": SERVER });
    const manager = new DevServerManager({ installCommandFor: noInstall });
    manager.start("a", a);
    manager.start("b", b);
    await until(() => manager.get("a").status === "running" && manager.get("b").status === "running", "both running");
    const pids = await Promise.all([a, b].map(async (d) => Number(await fs.readFile(path.join(d, "pid.txt"), "utf8"))));

    manager.killAll();
    await until(() => pids.every((pid) => !alive(pid)), "both processes gone");
  });

  it("does not hand AgentOS's secrets to the project", async () => {
    process.env.AGENTOS_TEST_SECRET = "hunter2";
    const dir = await project({ dev: "node env.js" }, { "env.js": "console.log('secret=' + process.env.AGENTOS_TEST_SECRET); setInterval(() => {}, 1000)" });
    const manager = new DevServerManager({ installCommandFor: noInstall, readyTimeoutMs: 1_500 });
    manager.start("demo", dir);
    await until(() => manager.get("demo").output.some((line) => line.startsWith("secret=")), "output");
    assert.ok(manager.get("demo").output.includes("secret=undefined"));
    await manager.stop("demo");
    delete process.env.AGENTOS_TEST_SECRET;
  });
});

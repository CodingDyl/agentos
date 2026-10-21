#!/usr/bin/env node
/**
 * One-browser check of a web project: starts the project's own dev server on a
 * free localhost port, opens it in Chromium at fixed widths (with motion and
 * with reduced motion), scrolls through each page, and reports what a person
 * would notice: horizontal scroll, console errors, failed requests, in-page
 * links that go nowhere. Writes screenshots and report.json to --out.
 *
 *   node scripts/browser-check.mjs --project <dir> --out <dir> [--widths 1440,1024,768,390,320] [--paths /]
 *
 * Used by AgentOS after a worker job's validation, and by workers themselves.
 * Exit code 0 when the site loaded and no problems were found, 1 when problems
 * were found, 2 when the site could not be started or opened.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]?.startsWith("--") ? "true" : all[index + 1]]] : pairs), []),
);
const project = path.resolve(args.project ?? process.cwd());
const out = path.resolve(project, args.out ?? "artifacts/browser-check");
const widths = (args.widths ?? "1440,1024,768,390,320").split(",").map(Number).filter((width) => width > 0);
const paths = (args.paths ?? "/").split(",").filter(Boolean);
const READY_MS = 120_000;

const ENV = Object.fromEntries(["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR", "TERM"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(800, () => (socket.destroy(), resolve(false)));
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** How to serve the project: its own dev script, or a plain static server for an index.html. */
async function serveCommand(port) {
  const manifest = await readJson(path.join(project, "package.json"));
  const scripts = manifest?.scripts ?? {};
  const script = ["dev", "start"].find((name) => typeof scripts[name] === "string");
  if (script) {
    const body = scripts[script];
    const flags = /^\s*next(\s|$)/.test(body) ? ` -- --port ${port} --hostname 127.0.0.1` : /^\s*vite(\s|$)/.test(body) ? ` -- --port ${port} --host 127.0.0.1 --strictPort` : "";
    return { command: `npm run ${script}${flags}`, needsInstall: !(await exists(path.join(project, "node_modules"))) };
  }
  if (await exists(path.join(project, "index.html"))) {
    return { static: true };
  }
  return undefined;
}

async function exists(target) {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

function run(command, extraEnv = {}) {
  const child = spawn(command, { cwd: project, shell: true, detached: true, env: { ...ENV, NODE_ENV: "development", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const keep = (chunk) => (output = `${output}${chunk}`.slice(-4000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  return { child, output: () => output, done: new Promise((resolve) => child.once("close", resolve)) };
}

function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 3000).unref();
}

async function staticServer(port) {
  const http = await import("node:http");
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json" };
  const server = http.createServer(async (request, response) => {
    const url = decodeURIComponent(new URL(request.url, "http://x").pathname);
    let file = path.join(project, url.endsWith("/") ? `${url}index.html` : url);
    if (!file.startsWith(project)) return response.writeHead(403).end();
    try {
      const data = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

/** macOS `._*` sidecars inside `.next` break Turbopack's cache ("invalid digit found in string"); the cache is derived, so it goes. */
async function clearSidecarCache() {
  const cache = path.join(project, ".next");
  const walk = async (dir, depth) => {
    if (depth > 8) return false;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith("._")) return true;
      if (entry.isDirectory() && (await walk(path.join(dir, entry.name), depth + 1))) return true;
    }
    return false;
  };
  if (await walk(cache, 0)) await fs.rm(cache, { recursive: true, force: true });
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  await clearSidecarCache();
  const port = await freePort();
  const serve = await serveCommand(port);
  if (!serve) {
    console.log(JSON.stringify({ ok: false, reason: "No dev or start script and no index.html: nothing to open." }));
    process.exit(2);
  }

  let server;
  let staticHttp;
  if (serve.static) {
    staticHttp = await staticServer(port);
  } else {
    if (serve.needsInstall) {
      const install = run((await exists(path.join(project, "package-lock.json"))) ? "npm ci" : "npm install");
      const code = await install.done;
      if (code !== 0) {
        console.log(JSON.stringify({ ok: false, reason: `Installing dependencies failed.\n${install.output()}` }));
        process.exit(2);
      }
    }
    server = run(serve.command, { PORT: String(port), HOST: "127.0.0.1", BROWSER: "none" });
    const deadline = Date.now() + READY_MS;
    while (!(await listening(port))) {
      if (Date.now() > deadline || server.child.exitCode !== null) {
        killGroup(server.child);
        console.log(JSON.stringify({ ok: false, reason: `The site did not start.\n${server.output()}` }));
        process.exit(2);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const report = { ok: true, browser: "chromium", widths, pages: [], problems: [] };

  try {
    for (const route of paths) {
      for (const width of widths) {
        for (const motion of ["motion", "reduced"]) {
          const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: motion === "reduced" ? "reduce" : "no-preference" });
          const page = await context.newPage();
          const consoleErrors = [];
          const failed = [];
          page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text().slice(0, 300)));
          page.on("pageerror", (error) => consoleErrors.push(String(error.message).slice(0, 300)));
          page.on("requestfailed", (request) => failed.push(`${request.url().replace(base, "")} (${request.failure()?.errorText ?? "failed"})`));
          page.on("response", (response) => response.status() >= 400 && failed.push(`${response.url().replace(base, "")} (${response.status()})`));

          const label = `${route === "/" ? "home" : route.replace(/\W+/g, "-")}-${width}-${motion}`;
          try {
            // The first open of a Next.js dev server compiles the page; give it time.
            await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 90_000 });
            await page.waitForTimeout(800);
          } catch (error) {
            report.problems.push(`${route} at ${width}px (${motion}): did not load (${error.message.split("\n")[0]})`);
            await context.close();
            continue;
          }

          const shots = [];
          for (const at of motion === "motion" ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
            await page.evaluate((fraction) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction), at);
            await page.waitForTimeout(500);
            const file = `${label}-${Math.round(at * 100)}.png`;
            await page.screenshot({ path: path.join(out, file) });
            shots.push(file);
          }
          // Back up the page, for scroll-linked motion that should reverse.
          if (motion === "motion") {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(500);
            const file = `${label}-back-to-top.png`;
            await page.screenshot({ path: path.join(out, file) });
            shots.push(file);
          }

          const facts = await page.evaluate(() => {
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            const deadLinks = [...document.querySelectorAll('a[href^="#"]')]
              .map((link) => link.getAttribute("href"))
              .filter((href) => href && href.length > 1 && !document.getElementById(href.slice(1)));
            return { overflow, deadLinks: [...new Set(deadLinks)], title: document.title };
          });

          if (facts.overflow > 1) report.problems.push(`${route} at ${width}px (${motion}): scrolls sideways by ${facts.overflow}px`);
          if (facts.deadLinks.length) report.problems.push(`${route}: in-page links to nothing: ${facts.deadLinks.join(", ")}`);
          for (const error of new Set(consoleErrors)) report.problems.push(`${route} at ${width}px (${motion}): console error: ${error}`);
          for (const request of new Set(failed)) report.problems.push(`${route} at ${width}px (${motion}): failed request: ${request}`);

          report.pages.push({ route, width, motion, title: facts.title, overflow: facts.overflow, consoleErrors: consoleErrors.length, failedRequests: failed.length, screenshots: shots });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    if (server) killGroup(server.child);
    if (staticHttp) staticHttp.close();
  }

  report.problems = [...new Set(report.problems)];
  report.ok = report.problems.length === 0;
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checked: report.pages.length, problems: report.problems, out: path.relative(project, out) || "." }));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
  process.exit(2);
});

// Starts one half of an isolated AgentOS for the browser tests.
//
//   node e2e/serve.mjs data   → the data adapter on :8797, over a fresh copy
//                               of e2e/fixtures/vault
//   node e2e/serve.mjs web    → Vite on :1520, proxying /api to :8797
//
// Everything the adapter can write — the vault, UI state, media — points at a
// throwaway directory, so a test run can never touch ~/AgentOS. Hermes is
// pointed at a closed port so no test depends on (or talks to) a real agent.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
export const E2E_ROOT = path.join(os.tmpdir(), "agentos-e2e");
const DATA_PORT = "8797";
const WEB_PORT = "1520";

const role = process.argv[2];
const env = {
  ...process.env,
  AGENTOS_ROOT: path.join(E2E_ROOT, "vault"),
  AGENTOS_UI_DIR: path.join(E2E_ROOT, "ui"),
  AGENTOS_MEDIA_DIR: path.join(E2E_ROOT, "media"),
  AGENTOS_PORT: DATA_PORT,
  AGENTOS_WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
  HERMES_BASE_URL: "http://127.0.0.1:9",
  HERMES_API_BASE_URL: "http://127.0.0.1:9",
  HERMES_API_KEY: "",
  JEV_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  VERCEL_API_TOKEN: "",
  // No service credentials at all, so Connectors reads the same on every machine.
  GITHUB_TOKEN: "",
  VIRTEC_BASE_URL: "",
  VIRTEC_API_KEY: "",
  INVESTEC_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
};

let child;
if (role === "data") {
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
  fs.mkdirSync(E2E_ROOT, { recursive: true });
  fs.cpSync(path.join(here, "fixtures", "vault"), env.AGENTOS_ROOT, { recursive: true });
  fs.mkdirSync(env.AGENTOS_UI_DIR, { recursive: true });
  fs.mkdirSync(env.AGENTOS_MEDIA_DIR, { recursive: true });
  child = spawn("npx", ["tsx", "server/index.ts"], { cwd: repo, env, stdio: "inherit" });
} else if (role === "web") {
  child = spawn("npx", ["vite", "--port", WEB_PORT, "--strictPort", "--host", "127.0.0.1"], { cwd: repo, env, stdio: "inherit" });
} else {
  console.error("usage: node e2e/serve.mjs data|web");
  process.exit(2);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));

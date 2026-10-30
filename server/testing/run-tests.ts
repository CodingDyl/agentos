import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanTestEnv } from "./clean-env";

/** `npm test`: every test file, in a clean environment and a fresh state folder. */

const PATTERNS = [
  "server/*/__tests__/*.test.ts",
  "server/*/*/__tests__/*.test.ts",
  "src/features/*/__tests__/*.test.ts",
  "src/config/__tests__/*.test.ts",
  "src/components/*/__tests__/*.test.ts",
];

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-test-"));
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...PATTERNS], {
  stdio: "inherit",
  env: cleanTestEnv(process.env, { AGENTOS_UI_DIR: stateDir }),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));

child.once("close", (code, signal) => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  process.exit(code ?? (signal ? 1 : 0));
});

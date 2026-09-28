import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the journeys Step 59 restructured.
 *
 * Runs its own data adapter and Vite on spare ports, over a fresh copy of
 * `e2e/fixtures/vault` (see `e2e/serve.mjs`), so it can run beside `npm run
 * dev` and never reads or writes the real vault.
 */
export const E2E_VAULT = path.join(os.tmpdir(), "agentos-e2e", "vault");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // One vault, shared: tests that write run in file order.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1520",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "node e2e/serve.mjs data",
      url: "http://127.0.0.1:8797/api/health",
      reuseExistingServer: false,
      // Hermes is deliberately unreachable here; its expected failures are noise.
      stderr: "ignore",
      timeout: 60_000,
    },
    {
      command: "node e2e/serve.mjs web",
      url: "http://127.0.0.1:1520",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

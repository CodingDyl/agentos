import fs from "node:fs/promises";
import express from "express";
import type { DevServerPlan, DevServerState } from "../../shared/dev-server-types";
import { repositoryPathFor } from "../agentos/repository";
import { installCommandFor } from "../workers/dependencies";
import { detectDevProject } from "./detect";
import { devServers } from "./manager";

/**
 * A workspace's Dev tab. Local only: a dev server is arbitrary project code,
 * so nothing outside this machine may start or stop one.
 */
export const devServerRouter = express.Router({ mergeParams: true });

devServerRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "The dev server is only available on this machine." });
    return;
  }
  next();
});

function slugOf(request: express.Request): string {
  return String((request.params as Record<string, string>).slug);
}

async function planFor(folder: string): Promise<DevServerPlan> {
  const detection = await detectDevProject(folder);
  if (!detection.ok) return detection;

  const installCommand = await installCommandFor(folder);
  const framework = detection.framework;

  return {
    ok: true,
    script: detection.script,
    framework,
    command: `npm run ${detection.script}`,
    needsInstall: installCommand !== undefined,
    installCommand,
  };
}

async function folderFor(slug: string): Promise<{ folder?: string; problem?: string }> {
  const folder = await repositoryPathFor(slug);
  if (!folder) return { problem: "This workspace has no local repository. Add a `Local repository:` line under Connected Systems in PROJECT.md." };

  const stat = await fs.stat(folder).catch(() => undefined);
  if (!stat?.isDirectory()) return { folder, problem: `The folder ${folder} does not exist on this machine.` };

  return { folder };
}

async function stateFor(slug: string): Promise<DevServerState> {
  const { folder, problem } = await folderFor(slug);
  return devServerState(slug, folder, problem);
}

/** The server for `slug`, plus what Start would run in `folder`. Ship reads the same state for its own folder. */
export async function devServerState(slug: string, folder: string | undefined, problem?: string): Promise<DevServerState> {
  const snapshot = devServers.get(slug);

  const plan: DevServerPlan | undefined = problem
    ? { ok: false, reason: problem }
    : folder
      ? await planFor(folder)
      : undefined;

  return {
    status: snapshot.status,
    folder,
    plan,
    command: snapshot.command,
    port: snapshot.port,
    url: snapshot.url,
    startedAt: snapshot.startedAt,
    error: snapshot.error,
    output: snapshot.output,
  };
}

devServerRouter.get("/", async (request, response) => {
  try {
    response.json(await stateFor(slugOf(request)));
  } catch (error) {
    console.error("[dev-server] read failed:", error instanceof Error ? error.message : error);
    response.status(500).json({ error: "Could not read the dev server." });
  }
});

for (const action of ["start", "stop", "restart"] as const) {
  devServerRouter.post(`/${action}`, async (request, response) => {
    const slug = slugOf(request);

    try {
      const { folder, problem } = await folderFor(slug);

      if (action === "stop") {
        await devServers.stop(slug);
      } else if (!folder || problem) {
        response.status(409).json({ error: problem ?? "No folder to run." });
        return;
      } else if (action === "start") {
        devServers.start(slug, folder);
      } else {
        await devServers.restart(slug, folder);
      }

      response.json(await stateFor(slug));
    } catch (error) {
      console.error(`[dev-server] ${action} failed:`, error instanceof Error ? error.message : error);
      response.status(500).json({ error: `Could not ${action} the dev server.` });
    }
  });
}

import express from "express";
import { ZodError } from "zod";
import {
  ShipCreateRepoRequestSchema,
  ShipDeployRequestSchema,
  ShipLinkRepoRequestSchema,
  ShipLinkVercelRequestSchema,
  ShipSendChangesRequestSchema,
} from "../../shared/ship-types";
import { addShipChange, deleteShipChange, listShipChanges, patchShipChange, sendShipChanges } from "./changes";
import { createVercelProject, deployShip, linkVercelProject, readShipDeploy } from "./deploy";
import { readShipDev, startShipDev, stopShipDev } from "./dev-server";
import { ShipError } from "./error";
import { createGithubRepo, initShipRepo, linkExistingRepo, pullShipRepo, pushShipRepo, readShipGit } from "./git";
import { readShipSnapshot } from "./snapshot";
import { shipShotPath } from "./store";

export const shipRouter = express.Router({ mergeParams: true });

shipRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Ship is only available on this machine." });
    return;
  }
  if (request.method !== "GET" && request.method !== "DELETE" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function slugOf(request: express.Request): string {
  const slug = request.params.slug;
  if (typeof slug !== "string" || !slug) throw new ShipError("Missing workspace slug.", 400);
  return slug;
}

function idOf(request: express.Request): string {
  const id = request.params.id;
  if (typeof id !== "string" || !id) throw new ShipError("Missing change id.", 400);
  return id;
}

function fail(response: express.Response, error: unknown): void {
  if (error instanceof ShipError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "That request was not valid." });
    return;
  }
  console.error("[agentos] ship request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "Ship could not do that." });
}

shipRouter.get("/", async (request, response) => {
  try {
    response.json(await readShipSnapshot(slugOf(request)));
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.get("/git", async (request, response) => {
  try {
    response.json({ git: await readShipGit(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/git/init", async (request, response) => {
  try {
    response.json({ git: await initShipRepo(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/git/link", async (request, response) => {
  try {
    const body = ShipLinkRepoRequestSchema.parse(request.body);
    response.json({ git: await linkExistingRepo(slugOf(request), body.repo) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/git/create", async (request, response) => {
  try {
    const body = ShipCreateRepoRequestSchema.parse(request.body ?? {});
    response.json({ git: await createGithubRepo(slugOf(request), body.name) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/git/pull", async (request, response) => {
  try {
    response.json(await pullShipRepo(slugOf(request)));
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/git/push", async (request, response) => {
  try {
    response.json(await pushShipRepo(slugOf(request)));
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.get("/dev", async (request, response) => {
  try {
    response.json({ dev: await readShipDev(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/dev/start", async (request, response) => {
  try {
    response.json({ dev: await startShipDev(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/dev/stop", async (request, response) => {
  try {
    response.json({ dev: await stopShipDev(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.get("/deploy", async (request, response) => {
  try {
    response.json({ deploy: await readShipDeploy(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/deploy/link", async (request, response) => {
  try {
    const body = ShipLinkVercelRequestSchema.parse(request.body);
    response.json({ deploy: await linkVercelProject(slugOf(request), body.projectId, body.projectName) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/deploy/create", async (request, response) => {
  try {
    response.json({ deploy: await createVercelProject(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/deploy", async (request, response) => {
  try {
    const body = ShipDeployRequestSchema.parse(request.body);
    response.json({ deploy: await deployShip(slugOf(request), body.target) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.get("/changes", async (request, response) => {
  try {
    response.json({ changes: await listShipChanges(slugOf(request)) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/changes", async (request, response) => {
  try {
    const item = await addShipChange(slugOf(request), request.body);
    response.status(201).json({ change: item });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.patch("/changes/:id", async (request, response) => {
  try {
    response.json({ change: await patchShipChange(slugOf(request), idOf(request), request.body) });
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.delete("/changes/:id", async (request, response) => {
  try {
    await deleteShipChange(slugOf(request), idOf(request));
    response.status(204).end();
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.post("/changes/send", async (request, response) => {
  try {
    const body = ShipSendChangesRequestSchema.parse(request.body ?? {});
    const result = await sendShipChanges(slugOf(request), body.ids);
    response.status(202).json(result);
  } catch (error) {
    fail(response, error);
  }
});

shipRouter.get("/changes/:id/screenshot", async (request, response) => {
  try {
    const target = shipShotPath(slugOf(request), idOf(request));
    response.type("png").sendFile(target, (error) => {
      if (error) response.status(404).json({ error: "No screenshot for that change." });
    });
  } catch (error) {
    fail(response, error);
  }
});

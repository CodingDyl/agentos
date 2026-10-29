import fs from "node:fs/promises";
import express from "express";
import { z, ZodError } from "zod";
import {
  ShipCreateRepoRequestSchema,
  ShipDeployRequestSchema,
  ShipLinkRepoRequestSchema,
  ShipLinkVercelRequestSchema,
  ShipPushRequestSchema,
  ShipSendChangesRequestSchema,
} from "../../shared/ship-types";
import { devServerState } from "../dev-server/routes";
import { devServers } from "../dev-server/manager";
import { addShipChange, deleteShipChange, listShipChanges, patchShipChange, sendShipChanges } from "./changes";
import { createVercelProject, deployShip, linkVercelProject, readShipDeploy } from "./deploy";
import { ShipError } from "./error";
import { createGithubRepo, initShipRepo, linkExistingRepo, pullShipRepo, pushShipRepo, readShipGit } from "./git";
import { requireKnownProject, requireShipRoot } from "./root";
import { readShipSnapshot } from "./snapshot";
import { shipShotPath } from "./store";

/**
 * `/api/projects/:slug/ship`. Local only, like the Dev tab: Ship runs git,
 * package managers and dev servers, and deploys with the Vercel token, so
 * nothing outside this machine may reach it. Writes must be JSON, which a
 * cross-site form cannot send without a CORS preflight.
 */
export const shipRouter = express.Router({ mergeParams: true });

const NoBody = z.object({}).strict();

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
  return String((request.params as Record<string, string>).slug ?? "");
}

function idOf(request: express.Request): string {
  return String((request.params as Record<string, string>).id ?? "");
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
  // The message only: git and HTTP errors can be long, and nothing here belongs in a log in full.
  console.error("[ship] request failed:", error instanceof Error ? error.message.slice(0, 300) : "unknown error");
  response.status(500).json({ error: "Ship could not do that." });
}

/** Wraps a handler so every route answers through `fail`. */
function handle(work: (request: express.Request, response: express.Response) => Promise<unknown>): express.RequestHandler {
  return (request, response) => {
    work(request, response).then(
      (body) => {
        if (!response.headersSent) response.json(body);
      },
      (error: unknown) => fail(response, error),
    );
  };
}

shipRouter.get("/", handle((request) => readShipSnapshot(slugOf(request))));
shipRouter.get("/git", handle(async (request) => ({ git: await readShipGit(slugOf(request)) })));

shipRouter.post(
  "/git/init",
  handle(async (request) => {
    NoBody.parse(request.body ?? {});
    return { git: await initShipRepo(slugOf(request)) };
  }),
);

shipRouter.post(
  "/git/link",
  handle(async (request) => {
    const body = ShipLinkRepoRequestSchema.parse(request.body);
    return { git: await linkExistingRepo(slugOf(request), body.repo) };
  }),
);

shipRouter.post(
  "/git/create",
  handle(async (request) => {
    const body = ShipCreateRepoRequestSchema.parse(request.body ?? {});
    return { git: await createGithubRepo(slugOf(request), body.name, body.confirmProduction) };
  }),
);

shipRouter.post(
  "/git/pull",
  handle(async (request) => {
    NoBody.parse(request.body ?? {});
    return pullShipRepo(slugOf(request));
  }),
);

shipRouter.post(
  "/git/push",
  handle(async (request) => {
    const body = ShipPushRequestSchema.parse(request.body ?? {});
    return pushShipRepo(slugOf(request), body.confirmProduction);
  }),
);

/** The Dev tab's server, run in Ship's folder. One per workspace, shared by both tabs. */
shipRouter.post(
  "/dev/start",
  handle(async (request) => {
    NoBody.parse(request.body ?? {});
    const slug = slugOf(request);
    const folder = await requireShipRoot(slug);
    devServers.start(slug, folder);
    return { dev: await devServerState(slug, folder) };
  }),
);

shipRouter.post(
  "/dev/stop",
  handle(async (request) => {
    NoBody.parse(request.body ?? {});
    const slug = slugOf(request);
    await requireKnownProject(slug);
    await devServers.stop(slug);
    const folder = await requireShipRoot(slug).catch(() => undefined);
    return { dev: await devServerState(slug, folder) };
  }),
);

shipRouter.get("/deploy", handle(async (request) => ({ deploy: await readShipDeploy(slugOf(request)) })));

shipRouter.post(
  "/deploy/link",
  handle(async (request) => {
    const body = ShipLinkVercelRequestSchema.parse(request.body);
    return { deploy: await linkVercelProject(slugOf(request), body.projectId) };
  }),
);

shipRouter.post(
  "/deploy/create",
  handle(async (request) => {
    NoBody.parse(request.body ?? {});
    return { deploy: await createVercelProject(slugOf(request)) };
  }),
);

shipRouter.post(
  "/deploy",
  handle(async (request) => {
    const body = ShipDeployRequestSchema.parse(request.body);
    return { deploy: await deployShip(slugOf(request), body) };
  }),
);

shipRouter.get("/changes", handle(async (request) => ({ changes: await listShipChanges(slugOf(request)) })));

shipRouter.post(
  "/changes",
  handle(async (request, response) => {
    const change = await addShipChange(slugOf(request), request.body);
    response.status(201);
    return { change };
  }),
);

shipRouter.patch("/changes/:id", handle(async (request) => ({ change: await patchShipChange(slugOf(request), idOf(request), request.body) })));

shipRouter.delete(
  "/changes/:id",
  handle(async (request, response) => {
    await deleteShipChange(slugOf(request), idOf(request));
    response.status(204).end();
  }),
);

shipRouter.post(
  "/changes/send",
  handle(async (request, response) => {
    const body = ShipSendChangesRequestSchema.parse(request.body ?? {});
    const result = await sendShipChanges(slugOf(request), body.ids);
    response.status(202);
    return result;
  }),
);

shipRouter.get(
  "/changes/:id/screenshot",
  handle(async (request, response) => {
    const slug = slugOf(request);
    await requireKnownProject(slug);
    const target = await shipShotPath(slug, idOf(request));
    const bytes = await fs.readFile(target).catch(() => undefined);
    if (!bytes) throw new ShipError("No screenshot for that change.", 404);
    response.setHeader("Content-Security-Policy", "default-src 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.type(bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "jpeg" : bytes.subarray(8, 12).toString() === "WEBP" ? "webp" : "png").send(bytes);
  }),
);

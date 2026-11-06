import express, { type Response } from "express";
import { z } from "zod";
import { ComposioAppPatchSchema, ComposioConnectRequestSchema, ComposioSlugSchema } from "../../shared/composio-types";
import { requireJson } from "../connectors/routes";
import { listCategories, listToolkits } from "./client";
import {
  ComposioError,
  ComposioRequestError,
  ComposioUnavailableError,
  connectApp,
  disconnectAccount,
  findActions,
  listApps,
  updateApp,
} from "./service";

/**
 * `/api/composio`.
 *
 * Browsing the catalog and connecting apps. There is deliberately no route that
 * runs an action: anything on this machine can reach loopback, and the only
 * way to act in an app is the chat tool, which holds the operator's OK.
 */
export const composioRouter = express.Router();

composioRouter.use(requireJson);

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof ComposioUnavailableError || error instanceof ComposioRequestError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof ComposioError) {
    response.status(502).json({ error: error.message });
    return;
  }
  console.error(`[agentos] composio: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

const ToolkitsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  cursor: z.string().max(400).optional(),
});

composioRouter.get("/toolkits", async (request, response) => {
  const parsed = ToolkitsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "That isn't a search AgentOS can send." });
    return;
  }
  try {
    response.json(await listToolkits(parsed.data));
  } catch (error) {
    fail(response, error, "read the app catalog");
  }
});

composioRouter.get("/categories", async (_request, response) => {
  try {
    response.json({ categories: await listCategories() });
  } catch (error) {
    fail(response, error, "read the categories");
  }
});

composioRouter.get("/apps", async (_request, response) => {
  try {
    response.json(await listApps());
  } catch (error) {
    fail(response, error, "read the connected apps");
  }
});

const ActionsQuerySchema = z.object({ query: z.string().trim().min(1).max(200), app: ComposioSlugSchema.optional() });

composioRouter.get("/actions", async (request, response) => {
  const parsed = ActionsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Send query, and optionally app." });
    return;
  }
  try {
    response.json(await findActions(parsed.data.query, parsed.data.app));
  } catch (error) {
    fail(response, error, "search the apps' actions");
  }
});

composioRouter.post("/connect", async (request, response) => {
  const parsed = ComposioConnectRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { toolkit } with the app's name, and optionally a label." });
    return;
  }
  try {
    response.json({ redirectUrl: await connectApp(parsed.data.toolkit, parsed.data.label) });
  } catch (error) {
    fail(response, error, "start the sign-in");
  }
});

composioRouter.patch("/apps/:slug", async (request, response) => {
  const slug = ComposioSlugSchema.safeParse(request.params.slug);
  const parsed = ComposioAppPatchSchema.safeParse(request.body ?? {});
  if (!slug.success || !parsed.success) {
    response.status(400).json({ error: "Send { enabled } or { policies } for one app." });
    return;
  }
  try {
    response.json(await updateApp(slug.data, parsed.data));
  } catch (error) {
    fail(response, error, "update the app");
  }
});

composioRouter.post("/accounts/:id/disconnect", async (request, response) => {
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: "That isn't an account id." });
    return;
  }
  try {
    response.json(await disconnectAccount(id.data));
  } catch (error) {
    fail(response, error, "disconnect the account");
  }
});

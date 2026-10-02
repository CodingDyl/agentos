import express from "express";
import { ClientWorkspaceLinkSchema, EntityWorkspacesPatchSchema } from "../../shared/business-types";
import { parse } from "../traction/route-helpers";
import { getBusiness } from "./business";
import { BusinessNotFoundError, setClientWorkspace, setEntityWorkspaces } from "./store";

/** Business: entities, clients and the workspace links between them. */
export const businessRouter = express.Router();

function fail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof BusinessNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  console.error(`[agentos] business: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

businessRouter.get("/", async (request, response) => {
  try {
    response.json(await getBusiness({ fresh: request.query.fresh === "1" }));
  } catch (error) {
    fail(response, error, "read Business");
  }
});

businessRouter.put("/entities/:id/workspaces", async (request, response) => {
  const body = parse(EntityWorkspacesPatchSchema, request.body, response, "workspace list");
  if (!body) return;
  try {
    await setEntityWorkspaces(request.params.id, body.workspaces);
    response.json(await getBusiness());
  } catch (error) {
    fail(response, error, "link workspaces");
  }
});

businessRouter.put("/clients/:id/workspace", async (request, response) => {
  const body = parse(ClientWorkspaceLinkSchema, request.body, response, "workspace link");
  if (!body) return;
  try {
    // Only a client Virtec actually has can be linked; this also keeps
    // arbitrary keys (`__proto__`) out of the record.
    const known = (await getBusiness()).clients.some((client) => client.id === request.params.id);
    if (!known) {
      response.status(404).json({ error: "No such client" });
      return;
    }
    await setClientWorkspace(request.params.id, body.workspace);
    response.json(await getBusiness());
  } catch (error) {
    fail(response, error, "link the client");
  }
});

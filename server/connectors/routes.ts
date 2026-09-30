import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ConnectorPatchSchema } from "../../shared/connector-types";
import { findCapability } from "./catalog";
import { decide } from "./policy";
import {
  ConnectorNotFoundError,
  ConnectorRequestError,
  disconnectConnector,
  getConnector,
  listConnectors,
  testConnector,
  updateConnector,
} from "./registry";

/**
 * `/api/connectors`.
 *
 * Reading costs no network call: status comes from configuration on this
 * machine and the last test. The only outbound request is `POST …/test`, one
 * read-only call to that service. No response ever contains a secret.
 */
export const connectorsRouter = express.Router();

/**
 * Every write must be sent as JSON. A cross-site page can fire a bodiless
 * POST at a loopback server without a preflight; it can't send
 * `application/json` without one, and this server answers no preflight. So a
 * web page the operator happens to have open can't switch a connector off or
 * disconnect Gmail.
 */
function requireJson(request: Request, response: Response, next: NextFunction): void {
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send connector changes as application/json." });
    return;
  }
  next();
}

connectorsRouter.use(requireJson);

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof ConnectorNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof ConnectorRequestError) {
    response.status(409).json({ error: error.message });
    return;
  }
  console.error(`[agentos] connectors: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

connectorsRouter.get("/", async (_request, response) => {
  try {
    response.json(await listConnectors());
  } catch (error) {
    fail(response, error, "read connectors");
  }
});

/**
 * Every capability, flat: what the orchestrator reads to plan with
 * capabilities instead of provider names.
 */
connectorsRouter.get("/capabilities", async (_request, response) => {
  try {
    const { connectors } = await listConnectors();
    const details = await Promise.all(connectors.map((connector) => getConnector(connector.id)));
    response.json({
      capabilities: details.flatMap((detail) =>
        detail.capabilities.map((capability) => ({
          ...capability,
          connectorId: detail.id,
          connectorName: detail.name,
          connectorStatus: detail.status,
          connectorEnabled: detail.enabled,
        })),
      ),
    });
  } catch (error) {
    fail(response, error, "read capabilities");
  }
});

const CheckSchema = z.object({ initiator: z.enum(["person", "system", "agent"]).default("agent") }).strict();

/** Would this capability be allowed? Decides without doing or recording anything. */
connectorsRouter.post("/capabilities/:id/check", (request, response) => {
  const parsed = CheckSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "initiator must be person, system or agent." });
    return;
  }
  if (!findCapability(request.params.id)) {
    response.status(404).json({ error: `${request.params.id} is not a known capability.` });
    return;
  }
  response.json(decide(request.params.id, parsed.data.initiator));
});

connectorsRouter.get("/:id", async (request, response) => {
  try {
    response.json(await getConnector(request.params.id));
  } catch (error) {
    fail(response, error, "read the connector");
  }
});

connectorsRouter.patch("/:id", async (request, response) => {
  const parsed = ConnectorPatchSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    response.status(400).json({ error: `Invalid change: ${issue?.path.join(".") || "body"}: ${issue?.message ?? ""}` });
    return;
  }
  try {
    response.json(await updateConnector(request.params.id, parsed.data));
  } catch (error) {
    fail(response, error, "update the connector");
  }
});

connectorsRouter.post("/:id/test", async (request, response) => {
  try {
    response.json(await testConnector(request.params.id));
  } catch (error) {
    fail(response, error, "test the connector");
  }
});

connectorsRouter.post("/:id/disconnect", async (request, response) => {
  try {
    response.json(await disconnectConnector(request.params.id));
  } catch (error) {
    fail(response, error, "disconnect the connector");
  }
});

import express from "express";
import { z } from "zod";
import { addUrlReference, listTaste, TasteError, updateTaste } from "./taste";

/**
 * Taste Vault's API, mounted at `/api/taste`. Uploading an image and deleting a
 * reference stay with the design library's own routes. Local-only.
 */
export const tasteRouter = express.Router();

tasteRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Taste Vault is only available on this machine." });
    return;
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

const tags = z.array(z.string().trim().min(1).max(40)).max(30);

export const TasteUrlSchema = z
  .object({
    url: z.string().trim().min(1).max(2_000),
    notes: z.string().max(4_000).optional(),
    tags: tags.optional(),
  })
  .strict();

export const TastePatchSchema = z
  .object({
    notes: z.string().max(4_000).nullable().optional(),
    tags: tags.optional(),
    snippet: z.string().max(20_000).nullable().optional(),
    attachedTo: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .strict();

function fail(response: express.Response, error: unknown): void {
  if (error instanceof TasteError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] taste request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "Taste Vault could not do that." });
}

tasteRouter.get("/", async (request, response) => {
  try {
    const workspace = typeof request.query.workspace === "string" && request.query.workspace ? request.query.workspace : undefined;
    response.json({ items: await listTaste(workspace) });
  } catch (error) {
    fail(response, error);
  }
});

tasteRouter.post("/url", async (request, response) => {
  const parsed = TasteUrlSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That request is incomplete." });
    return;
  }
  try {
    const { asset, created } = await addUrlReference(parsed.data);
    response.status(created ? 201 : 200).json(created ? { asset } : { asset, duplicate: true });
  } catch (error) {
    fail(response, error);
  }
});

tasteRouter.patch("/:id", async (request, response) => {
  const parsed = TastePatchSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That change is not valid." });
    return;
  }
  try {
    const asset = await updateTaste(request.params.id, parsed.data);
    if (!asset) {
      response.status(404).json({ error: "There is no such reference." });
      return;
    }
    response.json({ asset });
  } catch (error) {
    fail(response, error);
  }
});

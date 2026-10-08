import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { QuoteRequestSchema, SiteRequestStatusSchema, TriageOverrideSchema, type SiteSuggestion } from "../../shared/site-request-types";
import { agentOSRoot } from "../agentos/filesystem";
import { BRAND_EXTENSION } from "../website-rebuild/brand";
import { MAX_BRAND_UPLOAD_BYTES, toSafeRaster } from "../website-rebuild/capture";
import { listRuns, readRun } from "../website-rebuild/store";
import { draftQuoteEmail } from "./quote-email";
import {
  acceptQuote,
  addScreenshot,
  approveRequest,
  closeRequest,
  createRequest,
  listRequests,
  listSites,
  makeQuote,
  readRequest,
  saveSite,
  screenshotPath,
  setTriage,
  SiteRequestError,
} from "./store";
import { runTriage } from "./triage";

/**
 * Customer website update requests. Every route answers with the state it
 * changed, so the page never merges partial updates. Local only: there is no
 * public form, so there is nothing for a client to reach.
 */
export const siteRequestRouter = express.Router();

siteRequestRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Client requests are local: no DNS rebinding, no cross-site forms.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Site requests are only available on this machine." });
    return;
  }
  const upload = request.method === "POST" && /^\/[^/]+\/screenshots$/.test(request.path);
  if (request.method !== "GET" && !(upload ? request.is("image/*") : request.is("application/json"))) {
    response.status(415).json({ error: upload ? "Send the image file itself, with its image type." : "Send JSON." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown): void {
  if (error instanceof SiteRequestError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] site request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "The site request failed." });
}

/** Finished-or-started rebuilds that are not registered as client sites yet, with what they already know. */
function suggestions(): SiteSuggestion[] {
  const registered = new Set(listSites().map((site) => site.slug));
  const seen = new Set<string>();
  const found: SiteSuggestion[] = [];
  for (const summary of listRuns()) {
    const slug = summary.workspaceSlug;
    if (!slug || registered.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const run = readRun(summary.id);
    found.push({ slug, company: run.company, repoPath: run.repoPath, githubRepo: run.githubRepo, vercelProject: run.vercelProject });
  }
  return found;
}

siteRequestRouter.get("/sites", (_request, response) => {
  try {
    response.json({ sites: listSites(), suggestions: suggestions() });
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.put("/sites/:slug", (request, response) => {
  try {
    if (request.body?.slug !== undefined && request.body.slug !== request.params.slug) throw new SiteRequestError("The slug in the address and the body differ.", 422);
    response.json(saveSite({ ...request.body, slug: request.params.slug }));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.get("/", (request, response) => {
  try {
    const status = SiteRequestStatusSchema.safeParse(request.query.status);
    response.json(listRequests({ siteSlug: typeof request.query.site === "string" ? request.query.site : undefined, status: status.success ? status.data : undefined }));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/", (request, response) => {
  try {
    const created = createRequest(request.body);
    // Hermes is slow, so triage runs behind the answer; the page polls and shows it when it lands.
    void runTriage(created.id).catch(() => undefined);
    response.status(201).json(created);
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.get("/:id", (request, response) => {
  try {
    response.json(readRequest(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/triage", async (request, response) => {
  try {
    response.json(await runTriage(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/triage/override", (request, response) => {
  const input = TriageOverrideSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: input.error.issues[0]?.message ?? "Say whether it is a small edit or a new feature, and the hours." });
    return;
  }
  try {
    readRequest(request.params.id);
    response.json(setTriage(request.params.id, { classification: input.data.classification, estimateHours: input.data.estimateHours, reason: input.data.reason?.trim() || "Set by you." }, "person"));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/quote", (request, response) => {
  const input = QuoteRequestSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: input.error.issues[0]?.message ?? "Give the hours to quote." });
    return;
  }
  try {
    response.json(makeQuote(request.params.id, input.data));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/quote/accept", (request, response) => {
  try {
    response.json(acceptQuote(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/quote/draft", async (request, response) => {
  try {
    response.json(await draftQuoteEmail(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.post("/:id/approve", (request, response) => {
  try {
    response.json(approveRequest(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

const CloseSchema = z.object({ note: z.string().trim().max(600).optional() }).strict();

for (const [name, to] of [["decline", "declined"], ["cancel", "cancelled"]] as const) {
  siteRequestRouter.post(`/:id/${name}`, (request, response) => {
    const input = CloseSchema.safeParse(request.body ?? {});
    if (!input.success) {
      response.status(422).json({ error: "That note is too long." });
      return;
    }
    try {
      response.json(closeRequest(request.params.id, to, input.data.note));
    } catch (error) {
      fail(response, error);
    }
  });
}

/**
 * A screenshot the client sent. Re-encoded by `toSafeRaster` (so a hostile
 * file never reaches a worker or a page) and stored in the site's workspace.
 * The server names the file; nothing the browser sends becomes a path.
 */
siteRequestRouter.post("/:id/screenshots", express.raw({ type: "image/*", limit: MAX_BRAND_UPLOAD_BYTES }), async (request, response) => {
  try {
    const found = readRequest(request.params.id);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new SiteRequestError("The upload was empty.", 400);
    const safe = await toSafeRaster(request.body);
    if (!safe) throw new SiteRequestError("That file is not an image AgentOS can use. Send a PNG, JPEG, WebP, GIF or AVIF under 20 MB.", 415);
    const extension = BRAND_EXTENSION[safe.contentType];
    const fileId = randomUUID().slice(0, 8);
    const relativePath = `projects/${found.siteSlug}/docs/site-requests/${found.id}/${fileId}.${extension}`;
    const root = path.resolve(agentOSRoot());
    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) throw new SiteRequestError("That workspace is not inside the vault.");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, safe.data);
    const name = typeof request.query.name === "string" && request.query.name.trim() ? request.query.name.trim().slice(0, 120) : `Screenshot ${found.screenshots.length + 1}`;
    addScreenshot(found.id, name, relativePath);
    response.status(201).json(readRequest(found.id));
  } catch (error) {
    fail(response, error);
  }
});

siteRequestRouter.get("/:id/screenshots/:screenshotId", (request, response) => {
  try {
    const root = path.resolve(agentOSRoot());
    const file = path.resolve(root, screenshotPath(request.params.id, request.params.screenshotId));
    // Raster formats only: an SVG could carry script, and uploads never store one.
    if (!file.startsWith(`${root}${path.sep}`) || !/\.(png|jpg|webp|gif|avif)$/.test(file)) throw new SiteRequestError("No such screenshot.", 404);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.sendFile(file, (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: "That screenshot is no longer on disk." });
    });
  } catch (error) {
    fail(response, error);
  }
});

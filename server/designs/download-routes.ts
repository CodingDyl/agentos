import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { contentTypeFor, mediaRoot } from "./media";
import { resolveSafeDownloadPath } from "./download-path";

/**
 * Streams a Creative file as an attachment.
 *
 * Library images are usually fetched by their `/api/designs/assets/:id/media`
 * URL; this route exists for the cases that need `Content-Disposition:
 * attachment` and a chosen filename — and for anything else that lives under
 * the media root. The path is checked before a byte is read.
 */

export const downloadRouter = express.Router();

const MEDIA_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".mp4", ".mov", ".webm"]);

downloadRouter.get("/", async (request, response) => {
  const requested = typeof request.query.path === "string" ? request.query.path : "";
  const resolved = resolveSafeDownloadPath(requested, [path.resolve(mediaRoot())]);

  if (!resolved) {
    response.status(400).json({ error: "That path is not a downloadable asset." });
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!MEDIA_EXT.has(ext)) {
    response.status(400).json({ error: "That file cannot be downloaded." });
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      response.status(404).json({ error: "That file is not there." });
      return;
    }
  } catch {
    response.status(404).json({ error: "That file is not there." });
    return;
  }

  const filename = attachmentName(
    typeof request.query.filename === "string" ? request.query.filename : undefined,
    path.basename(resolved),
  );

  response.setHeader("Content-Type", contentTypeFor(path.basename(resolved)));
  response.setHeader("Content-Disposition", contentDisposition(filename));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "private, no-store");
  response.sendFile(resolved, (error) => {
    if (error && !response.headersSent) {
      response.status(404).json({ error: "That file is not there." });
    }
  });
});

/** A download name is a basename, never a path. */
function attachmentName(requested: string | undefined, fallback: string): string {
  const candidate = (requested ?? fallback).replace(/\\/g, "/").split("/").pop() ?? fallback;
  const cleaned = candidate.replace(/[\r\n"]/g, "").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

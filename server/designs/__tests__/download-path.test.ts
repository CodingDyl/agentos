import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { resolveSafeDownloadPath } from "../download-path";
import { downloadRouter } from "../download-routes";

/**
 * The download endpoint is the one place a browser can ask the adapter for a
 * file as an attachment. Paths are attacker-controlled, so the resolver — not
 * the route — is the boundary: `..`, absolute paths outside the media roots,
 * and anything that is not a media file are refused before a byte is read.
 */

describe("resolveSafeDownloadPath", () => {
  const root = path.resolve("/tmp/agentos-media-root");
  const other = path.resolve("/tmp/agentos-other-root");

  it("resolves a relative path inside an allowed root", () => {
    const resolved = resolveSafeDownloadPath("originals/abc.png", [root]);
    assert.equal(resolved, path.join(root, "originals/abc.png"));
  });

  it("allows an absolute path that already sits inside a root", () => {
    const target = path.join(root, "originals", "abc.png");
    assert.equal(resolveSafeDownloadPath(target, [root]), target);
  });

  it("rejects a `..` segment, even when it would still land inside the root", () => {
    assert.equal(resolveSafeDownloadPath("originals/../originals/abc.png", [root]), undefined);
    assert.equal(resolveSafeDownloadPath("originals/../../.ssh/id_rsa", [root]), undefined);
    assert.equal(resolveSafeDownloadPath("../abc.png", [root]), undefined);
  });

  it("rejects an absolute path outside every allowed root", () => {
    assert.equal(resolveSafeDownloadPath("/etc/passwd", [root]), undefined);
    assert.equal(resolveSafeDownloadPath(path.join(other, "secret.png"), [root]), undefined);
  });

  it("rejects empty, null-byte, and backslash-escaped `..` names", () => {
    assert.equal(resolveSafeDownloadPath("", [root]), undefined);
    assert.equal(resolveSafeDownloadPath("originals/abc.png\0.txt", [root]), undefined);
    assert.equal(resolveSafeDownloadPath("originals\\..\\secret.png", [root]), undefined);
  });

  it("does not treat a matching prefix as being inside the root", () => {
    assert.equal(
      resolveSafeDownloadPath(root + "-evil/abc.png", [root]),
      undefined,
    );
  });
});

describe("GET /api/designs/download", () => {
  let directory: string;
  let previousMedia: string | undefined;
  let base: string;
  let server: ReturnType<typeof express.application.listen>;

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-download-"));
    previousMedia = process.env.AGENTOS_MEDIA_DIR;
    process.env.AGENTOS_MEDIA_DIR = path.join(directory, "media");
    await fs.mkdir(path.join(directory, "media", "originals"), { recursive: true });
    await fs.writeFile(path.join(directory, "media", "originals", "hero.png"), png);

    const app = express();
    app.use("/api/designs/download", downloadRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.on("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/designs/download`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousMedia === undefined) delete process.env.AGENTOS_MEDIA_DIR;
    else process.env.AGENTOS_MEDIA_DIR = previousMedia;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("streams a file inside the media root as an attachment", async () => {
    const response = await fetch(`${base}?path=${encodeURIComponent("originals/hero.png")}&filename=${encodeURIComponent("chef-hero-2026-10-14.png")}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
    assert.match(response.headers.get("content-disposition") ?? "", /chef-hero-2026-10-14\.png/);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), png), 0);
  });

  it("refuses a path that climbs out of the media root", async () => {
    const escaped = await fetch(`${base}?path=${encodeURIComponent("../../.ssh/id_rsa")}`);
    assert.equal(escaped.status, 400);

    const absolute = await fetch(`${base}?path=${encodeURIComponent("/etc/passwd")}`);
    assert.equal(absolute.status, 400);
  });

  it("returns 404 when the file is not there", async () => {
    const response = await fetch(`${base}?path=${encodeURIComponent("originals/missing.png")}`);
    assert.equal(response.status, 404);
  });
});

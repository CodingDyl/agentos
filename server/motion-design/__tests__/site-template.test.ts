import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { motionSiteTemplate } from "../site-template";
import { ensureMotionSiteRepo } from "../site-repo";

const previous = process.env.AGENTOS_ROOT;
const previousProjects = process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
const vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-motion-site-"));
const clients = path.join(vault, "clients");
process.env.AGENTOS_ROOT = vault;
process.env.AGENTOS_CLIENT_PROJECTS_ROOT = clients;

after(async () => {
  if (previous === undefined) delete process.env.AGENTOS_ROOT;
  else process.env.AGENTOS_ROOT = previous;
  if (previousProjects === undefined) delete process.env.AGENTOS_CLIENT_PROJECTS_ROOT;
  else process.env.AGENTOS_CLIENT_PROJECTS_ROOT = previousProjects;
  await fs.rm(vault, { recursive: true, force: true });
});

describe("motion site Next.js template", () => {
  it("is an App Router TypeScript project with GSAP registered on the client", () => {
    const files = motionSiteTemplate("Pantry & Pilot");
    assert.match(files["package.json"] ?? "", /"next"/);
    assert.match(files["package.json"] ?? "", /"gsap"/);
    assert.match(files["package.json"] ?? "", /"@react-three\/fiber"/);
    assert.match(files["package.json"] ?? "", /"framer-motion"/);
    assert.match(files["app/page.tsx"] ?? "", /ScrollFilm/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /"use client"/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /gsap\.registerPlugin\(ScrollTrigger\)/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /useGSAP/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /pin: true/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /gsap\.timeline/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /prefers-reduced-motion/);
    assert.doesNotMatch(files["components/scroll-film.tsx"] ?? "", /start: "top 75%"/);
    assert.match(files["components/scroll-film.tsx"] ?? "", /file:\/\//);
    assert.match(files["components/scroll-film.tsx"] ?? "", /Pantry &amp; Pilot/);
    assert.match(files["components/scene.tsx"] ?? "", /@react-three\/fiber/);
  });

  it("seeds the scaffold into a new site repo", async () => {
    const repo = await ensureMotionSiteRepo("pantry-pilot", "Pantry Pilot");
    const page = await fs.readFile(path.join(repo, "app/page.tsx"), "utf8");
    const film = await fs.readFile(path.join(repo, "components/scroll-film.tsx"), "utf8");
    assert.match(page, /ScrollFilm/);
    assert.match(film, /gsap\.registerPlugin\(ScrollTrigger\)/);
    const pkg = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    assert.ok(pkg.dependencies.next);
    assert.ok(pkg.dependencies.gsap);
  });
});

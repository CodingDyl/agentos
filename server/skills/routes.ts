import express from "express";
import { MarketplaceInstallInputSchema, MarketplaceRepoInputSchema, SkillDraftSchema, SkillEnabledInputSchema, SkillParseInputSchema } from "../../shared/skill-types";
import { listConnectors } from "../connectors/registry";
import { activeRunCount } from "../website-rebuild/store";
import { installMarketplaceSkills, previewMarketplaceRepo, updateMarketplaceSkill } from "./marketplace";
import { deleteAddedSkill, listSkills, parseSkillMarkdown, saveAddedSkill, setSkillEnabled, SkillError, type SkillDeps } from "./registry";

/**
 * The Skills section of Connectors: list skills, switch them on or off, add,
 * edit or delete your own, and install skills from GitHub repos.
 */
export const skillsRouter = express.Router();

skillsRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Switching what agents may do is local-only: no DNS rebinding, no cross-site form posts.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Skills can only be changed on this machine." });
    return;
  }
  // A DELETE carries no body; everything else that writes must be JSON.
  if (request.method !== "GET" && request.method !== "DELETE" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

const deps: SkillDeps = {
  connectors: async () => (await listConnectors()).connectors,
  activeRuns: activeRunCount,
};

skillsRouter.get("/", async (_request, response) => {
  try {
    response.json({ skills: await listSkills(deps) });
  } catch (error) {
    console.error("[agentos] skills could not be read:", error);
    response.status(500).json({ error: "Skills could not be read." });
  }
});

function sendSkillError(response: express.Response, error: unknown, fallback: string): void {
  if (error instanceof SkillError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(`[agentos] ${fallback}:`, error);
  response.status(500).json({ error: fallback });
}

/** Reads an uploaded SKILL.md into the form for review. Saves nothing. */
skillsRouter.post("/parse", (request, response) => {
  const input = SkillParseInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: input.error.issues[0]?.message ?? "Send { markdown }." });
    return;
  }
  response.json(parseSkillMarkdown(input.data.markdown));
});

/** Reads a GitHub repo's skills for review: names, versions, conflicts, and what is left out. Installs nothing. */
skillsRouter.post("/marketplace/preview", async (request, response) => {
  const input = MarketplaceRepoInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: input.error.issues[0]?.message ?? "Send { repo }." });
    return;
  }
  try {
    response.json(await previewMarketplaceRepo(input.data.repo, deps));
  } catch (error) {
    sendSkillError(response, error, "The repo could not be read.");
  }
});

/** Installs the picked skills from the exact commit that was reviewed. */
skillsRouter.post("/marketplace/install", async (request, response) => {
  const input = MarketplaceInstallInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: input.error.issues[0]?.message ?? "Send { repo, commit, skills }." });
    return;
  }
  try {
    response.status(201).json({ installed: await installMarketplaceSkills(input.data, deps) });
  } catch (error) {
    sendSkillError(response, error, "The skills could not be installed.");
  }
});

/** Pulls the branch a marketplace skill came from again; replaces it only if the branch moved. */
skillsRouter.post("/:id/update", async (request, response) => {
  try {
    response.json(await updateMarketplaceSkill(request.params.id, deps));
  } catch (error) {
    sendSkillError(response, error, "The skill could not be updated.");
  }
});

skillsRouter.post("/", async (request, response) => {
  const draft = SkillDraftSchema.safeParse(request.body);
  if (!draft.success) {
    response.status(400).json({ error: draft.error.issues[0]?.message ?? "That skill is not complete." });
    return;
  }
  try {
    response.status(201).json(await saveAddedSkill(draft.data, undefined, deps));
  } catch (error) {
    sendSkillError(response, error, "The skill could not be saved.");
  }
});

skillsRouter.put("/:id", async (request, response) => {
  const draft = SkillDraftSchema.safeParse(request.body);
  if (!draft.success) {
    response.status(400).json({ error: draft.error.issues[0]?.message ?? "That skill is not complete." });
    return;
  }
  try {
    response.json(await saveAddedSkill(draft.data, request.params.id, deps));
  } catch (error) {
    sendSkillError(response, error, "The skill could not be saved.");
  }
});

skillsRouter.delete("/:id", async (request, response) => {
  try {
    await deleteAddedSkill(request.params.id, deps);
    response.json({ ok: true });
  } catch (error) {
    sendSkillError(response, error, "The skill could not be deleted.");
  }
});

skillsRouter.post("/:id/enabled", async (request, response) => {
  const input = SkillEnabledInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: "Send { enabled: true | false }." });
    return;
  }
  try {
    // Disabling takes effect before each run's next stage. Enabling resumes nothing by itself: a paused stage waits for Retry.
    response.json(await setSkillEnabled(request.params.id, input.data.enabled, deps));
  } catch (error) {
    if (error instanceof SkillError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("[agentos] skill could not be switched:", error);
    response.status(500).json({ error: "The skill could not be switched." });
  }
});

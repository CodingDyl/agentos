import express from "express";
import { SkillEnabledInputSchema } from "../../shared/skill-types";
import { listConnectors } from "../connectors/registry";
import { activeRunCount } from "../website-rebuild/store";
import { listSkills, setSkillEnabled, SkillError, type SkillDeps } from "./registry";

/** The Skills section of Connectors: list skills, and switch them on or off. */
export const skillsRouter = express.Router();

skillsRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Switching what agents may do is local-only: no DNS rebinding, no cross-site form posts.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Skills can only be changed on this machine." });
    return;
  }
  if (request.method !== "GET" && !request.is("application/json")) {
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

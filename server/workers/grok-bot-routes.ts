import express from "express";
import { z } from "zod";
import { grokBotWorkspace, isAiEnabled, setAiEnabled, setGrokBotWorkspace } from "../ai-stack/settings";
import { checkWorkspace, workspacePathProblem } from "./grok-bot-workspace";

/**
 * `/api/workers/grok-bot`: the Grok Bot switch, its workspace path, and the
 * connection test. All disk access happens here, on the server.
 */
export const grokBotRouter = express.Router();

async function describe() {
  const enabled = isAiEnabled("grok-bot");
  const workspace = grokBotWorkspace();
  return {
    enabled,
    workspacePath: workspace ?? "",
    workspace: await checkWorkspace(workspace, { probe: false }),
  };
}

grokBotRouter.get("/", async (_request, response) => {
  try {
    response.json(await describe());
  } catch (error) {
    console.error("[agentos] grok bot status failed:", error);
    response.status(500).json({ error: "Unable to read Grok Bot status" });
  }
});

const SettingsSchema = z.object({
  enabled: z.boolean().optional(),
  workspacePath: z.string().optional(),
});

grokBotRouter.put("/", async (request, response) => {
  const parsed = SettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid Grok Bot settings." });
    return;
  }

  const { enabled, workspacePath } = parsed.data;
  if (workspacePath !== undefined && workspacePath.trim()) {
    const problem = workspacePathProblem(workspacePath.trim());
    if (problem) {
      response.status(400).json({ error: problem });
      return;
    }
  }

  // A path is saved even while the SSD is unplugged: it is where the SSD will
  // be, and the status says it is not there yet.
  if (workspacePath !== undefined) setGrokBotWorkspace(workspacePath);
  if (enabled !== undefined) setAiEnabled("grok-bot", enabled);

  response.json(await describe());
});

/** Writes and removes a probe file in tasks/ and results/. Creates nothing else. */
grokBotRouter.post("/test", async (_request, response) => {
  try {
    const result = await checkWorkspace(grokBotWorkspace(), { probe: true });
    response.json({ ...result, testedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[agentos] grok bot connection test failed:", error);
    response.status(500).json({ error: "The connection test could not run." });
  }
});

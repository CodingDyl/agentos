import express from "express";
import { AgentPatchSchema } from "../../shared/agent-types";
import { getAgentRecord, listAgentRecords, AgentStoreError, updateAgentRecord } from "./store";
import { isOpenJob, jobSummary, jobsForAgent, spendForAgent } from "./spend";

/**
 * The specialist roster: list, detail, and edits.
 *
 * Local-only writes, same as skills and connectors. Jobs and spend are read
 * from the existing job store and usage ledger, not stored on the agent.
 */
export const agentsRouter = express.Router();

agentsRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Agents can only be changed on this machine." });
    return;
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

agentsRouter.get("/", async (_request, response) => {
  try {
    const agents = listAgentRecords();
    const summaries = await Promise.all(
      agents.map(async (agent) => {
        const jobs = await jobsForAgent(agent.id);
        const open = jobs.filter(isOpenJob);
        const spend = await spendForAgent(agent, jobs);
        return {
          ...agent,
          openJobs: open.length,
          spend,
          currentJob: open[0] ? jobSummary(open[0]) : undefined,
        };
      }),
    );
    response.json({ agents: summaries });
  } catch (error) {
    console.error("[agentos] agents could not be read:", error);
    response.status(500).json({ error: "Agents could not be read." });
  }
});

agentsRouter.get("/:id", async (request, response) => {
  try {
    const agent = getAgentRecord(request.params.id);
    if (!agent) {
      response.status(404).json({ error: "There is no agent with that id." });
      return;
    }
    const jobs = await jobsForAgent(agent.id);
    response.json({
      agent,
      spend: await spendForAgent(agent, jobs),
      jobs: jobs.slice(0, 40).map(jobSummary),
    });
  } catch (error) {
    console.error("[agentos] agent could not be read:", error);
    response.status(500).json({ error: "That agent could not be read." });
  }
});

agentsRouter.patch("/:id", (request, response) => {
  const input = AgentPatchSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: input.error.issues[0]?.message ?? "Send a JSON patch." });
    return;
  }
  try {
    response.json({ agent: updateAgentRecord(request.params.id, input.data) });
  } catch (error) {
    if (error instanceof AgentStoreError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("[agentos] agent could not be saved:", error);
    response.status(500).json({ error: "That agent could not be saved." });
  }
});

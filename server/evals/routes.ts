import { Router } from "express";
import { compareToPrevious, readEvalHistory } from "./history";

/** `/api/evals` — how the evals have scored over time. Read only: nothing here runs an eval. */
export const evalsRouter = Router();

evalsRouter.get("/history", async (request, response) => {
  try {
    const suite = typeof request.query.suite === "string" && request.query.suite.trim() ? request.query.suite.trim().slice(0, 60) : undefined;
    const runs = await readEvalHistory(suite);
    response.json({ runs: runs.slice(-20), latest: runs.at(-1) ?? null, comparison: compareToPrevious(runs) });
  } catch (error) {
    console.error("[evals] could not read the history:", error);
    response.status(500).json({ error: "The eval history could not be read." });
  }
});

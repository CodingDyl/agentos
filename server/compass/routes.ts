import express from "express";
import { ZodError } from "zod";
import { CompassSaveSchema, InterviewAnswersSchema } from "../../shared/compass-types";
import { RevisionConflictError } from "../agentos/mutations/revision";
import { DocumentInvalidError } from "../agentos/mutations/writer";
import { CompassError, readCompass, saveCompass } from "./compass";
import { draftCompass, interviewQuestions } from "./interview";

/**
 * `/api/compass`: read and save `me/COMPASS.md`, and the first-time interview.
 * Agents can read the Compass here, or the file itself; see docs/compass/README.md.
 */
export const compassRouter = express.Router();

function compassFail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof RevisionConflictError) {
    response.status(409).json({ error: "The Compass changed since you opened it (perhaps in Obsidian). Reload it, then make your change again." });
    return;
  }
  if (error instanceof CompassError || error instanceof DocumentInvalidError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    response.status(400).json({ error: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` });
    return;
  }
  console.error(`[agentos] could not ${what}:`, error);
  response.status(500).json({ error: `Could not ${what}.` });
}

compassRouter.get("/", async (_request, response) => {
  try {
    response.json(await readCompass());
  } catch (error) {
    compassFail(response, error, "read the Compass");
  }
});

compassRouter.put("/", async (request, response) => {
  try {
    const body = CompassSaveSchema.parse(request.body);
    response.json(await saveCompass(body.compass, body.revision));
  } catch (error) {
    compassFail(response, error, "save the Compass");
  }
});

/** Hermes reads what is already written about you and asks only about the gaps. Saves nothing. */
compassRouter.post("/interview/questions", async (_request, response) => {
  try {
    response.json(await interviewQuestions());
  } catch (error) {
    compassFail(response, error, "start the interview");
  }
});

/** Hermes drafts a whole Compass from your answers. Saves nothing: you edit and save it. */
compassRouter.post("/interview/draft", async (request, response) => {
  try {
    const body = InterviewAnswersSchema.parse(request.body);
    response.json({ compass: await draftCompass(body.answers) });
  } catch (error) {
    compassFail(response, error, "draft the Compass");
  }
});

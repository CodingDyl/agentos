import express from "express";
import { CaseWriteSchema, SenderInputSchema } from "../../shared/outreach-case";
import { fail, parse } from "../traction/route-helpers";
import { briefCase, CaseError, deleteSender, draftCase, readCase, readCases, readSenders, saveSender, writeCase } from "./cases";

/**
 * `/api/outreach/cases` and `/api/outreach/senders`.
 *
 * The same endpoints serve the screen, Hermes' results and coding agents.
 * An agent that has researched a business writes what it found with
 *
 *   PATCH /api/outreach/cases/<prospectId>
 *   { "by": "agent", "patch": { "notes": "...", "findings": ["..."] } }
 *
 * See docs/outreach/README.md for every field.
 */
export const caseRouter = express.Router();

function caseFail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof CaseError) {
    response.status(422).json({ error: error.message });
    return;
  }
  fail(response, error, what);
}

caseRouter.get("/cases", async (_request, response) => {
  try {
    response.json({ cases: await readCases() });
  } catch (error) {
    caseFail(response, error, "read the outreach cases");
  }
});

caseRouter.get("/cases/:prospectId", async (request, response) => {
  try {
    response.json({ case: await readCase(request.params.prospectId) });
  } catch (error) {
    caseFail(response, error, "read the outreach case");
  }
});

caseRouter.patch("/cases/:prospectId", async (request, response) => {
  const write = parse(CaseWriteSchema, request.body, response, "case change");
  if (!write) return;
  try {
    response.json({ case: await writeCase(request.params.prospectId, write.patch, write.by) });
  } catch (error) {
    caseFail(response, error, "save the outreach case");
  }
});

/** Hermes reads their website and fills the brief. `{ "replace": true }` overwrites fields you filled. */
caseRouter.post("/cases/:prospectId/brief", async (request, response) => {
  try {
    const replace = Boolean((request.body as { replace?: unknown } | undefined)?.replace === true);
    response.json({ case: await briefCase(request.params.prospectId, { replace }) });
  } catch (error) {
    caseFail(response, error, "brief the case");
  }
});

/** Hermes drafts the email from the case. The draft is saved on the case; nothing is sent. */
caseRouter.post("/cases/:prospectId/draft", async (request, response) => {
  try {
    response.json({ case: await draftCase(request.params.prospectId) });
  } catch (error) {
    caseFail(response, error, "draft the email");
  }
});

caseRouter.get("/senders", async (_request, response) => {
  try {
    response.json({ senders: await readSenders() });
  } catch (error) {
    caseFail(response, error, "read your companies");
  }
});

caseRouter.post("/senders", async (request, response) => {
  const input = parse(SenderInputSchema, request.body, response, "company");
  if (!input) return;
  try {
    response.status(201).json({ sender: await saveSender(input) });
  } catch (error) {
    caseFail(response, error, "add the company");
  }
});

caseRouter.put("/senders/:id", async (request, response) => {
  const input = parse(SenderInputSchema, request.body, response, "company");
  if (!input) return;
  try {
    response.json({ sender: await saveSender(input, request.params.id) });
  } catch (error) {
    caseFail(response, error, "save the company");
  }
});

caseRouter.delete("/senders/:id", async (request, response) => {
  try {
    await deleteSender(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    caseFail(response, error, "remove the company");
  }
});

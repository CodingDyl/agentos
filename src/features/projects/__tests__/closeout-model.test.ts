import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryProposalReview } from "@shared/task-closeout-types";
import { applyConflict, buildCompleteRequest, incomplete, initialChoices, unresolved, validationLabel } from "../detail/closeout-model";

const proposal = (overrides: Partial<MemoryProposalReview>): MemoryProposalReview => ({
  id: "mp-1",
  type: "pattern",
  title: "Recipe fallback handling",
  body: "Use internal generation when lookup fails.",
  project: "pantry-pilot",
  sourceTask: "PP-031",
  sourceRun: "job_0031",
  proposedBy: "agent:claude",
  selected: true,
  duplicates: [],
  ...overrides,
});

const match = { id: "projects/pantry-pilot/memory/Recipe fallback.md", title: "Recipe fallback", archived: false, score: 0.6, revision: "sha256:abc", excerpt: "", kind: "note" as const };

describe("closeout choices", () => {
  it("turns ticks into saves and unticks into dismissals", () => {
    const choices = initialChoices([proposal({}), proposal({ id: "mp-2", type: "lesson", title: "MealDB", selected: false })]);
    const request = buildCompleteRequest({ summary: "Done.", originalSummary: "Done.", choices, status: { apply: false, body: "" } });
    assert.deepEqual(request.memory?.map((entry) => entry.action), ["create", "dismiss"]);
    assert.equal(request.summary, undefined, "an unchanged summary is not resent");
    assert.equal(request.statusUpdate, undefined);
  });

  it("blocks completion until a possible duplicate has an answer", () => {
    let choices = initialChoices([proposal({ duplicates: [match] })]);
    assert.equal(unresolved(choices).length, 1);

    choices = choices.map((choice) => ({ ...choice, resolution: { kind: "update", targetId: match.id, targetRevision: match.revision } }));
    assert.equal(unresolved(choices).length, 0);
    const [entry] = buildCompleteRequest({ summary: "", originalSummary: "", choices, status: { apply: false, body: "" } }).memory ?? [];
    assert.deepEqual([entry.action, entry.targetId, entry.targetRevision], ["update", match.id, match.revision]);

    const created = buildCompleteRequest({
      summary: "",
      originalSummary: "",
      choices: choices.map((choice) => ({ ...choice, resolution: { kind: "create-new" } })),
      status: { apply: false, body: "" },
    }).memory?.[0];
    assert.equal(created?.acknowledgedDuplicates, true);

    // Unticking is the "cancel": nothing is asked of a dismissed proposal.
    assert.equal(unresolved([{ ...choices[0], selected: false, resolution: undefined }]).length, 0);
  });

  it("sends the edited text and the status update only when ticked", () => {
    const choices = initialChoices([proposal({})]).map((choice) => ({ ...choice, proposal: { ...choice.proposal, body: "  Edited by a person.  " } }));
    const request = buildCompleteRequest({
      summary: "Chef falls back.",
      originalSummary: "Chef now falls back.",
      choices,
      status: { apply: true, body: "Fallback done. Next: performance.", expectedRevision: "sha256:s1" },
    });
    assert.equal(request.memory?.[0].proposal.body, "Edited by a person.");
    assert.equal(request.summary, "Chef falls back.");
    assert.deepEqual(request.statusUpdate, { body: "Fallback done. Next: performance.", expectedRevision: "sha256:s1" });
  });

  it("folds a server-found duplicate back in and asks again", () => {
    const choices = initialChoices([proposal({})]).map((choice) => ({ ...choice, resolution: { kind: "create-new" as const } }));
    const next = applyConflict(choices, [{ proposalId: "mp-1", duplicates: [match] }]);
    assert.equal(next[0].resolution, undefined);
    assert.equal(unresolved(next).length, 1);
  });

  it("will not save a ticked memory with no title or text", () => {
    assert.equal(incomplete(initialChoices([proposal({ title: "", body: "" })])).length, 1);
  });

  it("labels validation commands", () => {
    assert.deepEqual(["npm run build", "npm run lint", "npm test"].map(validationLabel), ["Build", "Lint", "Tests"]);
  });
});

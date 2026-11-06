import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RebuildDesignConcept } from "@shared/website-rebuild-types";
import { ConceptCritique } from "../concept-critique";
import { critiqueStatus } from "../concept-critique-model";

const concept = (overrides: Partial<RebuildDesignConcept> = {}): RebuildDesignConcept => ({
  concept: "concept-c",
  direction: "risograph-zine",
  directionName: "Risograph zine",
  wildcard: true,
  score: 33,
  passed: true,
  autoRevised: false,
  escalated: false,
  ...overrides,
});

describe("the concept's direction and score on the hero stage", () => {
  it("shows the direction, the wildcard and the score out of 40", () => {
    const html = renderToStaticMarkup(createElement(ConceptCritique, { entry: concept() }));
    assert.match(html, /Risograph zine/);
    assert.match(html, /Wildcard/);
    assert.match(html, /Design score: <\/span>33\/40/);
  });

  it("says when a concept is below the bar after its one revision, and why", () => {
    const html = renderToStaticMarkup(createElement(ConceptCritique, { entry: concept({ score: 21, passed: false, autoRevised: true, escalated: true, wildcard: false, reason: "scored 21/40, below 28" }) }));
    assert.match(html, /21\/40 · below the bar after one revision/);
    assert.match(html, /scored 21\/40, below 28/);
    assert.doesNotMatch(html, /Wildcard/);
  });

  it("labels revised passes and unscored concepts, and renders nothing for a run without directions", () => {
    assert.equal(critiqueStatus(concept({ autoRevised: true })).text, "33/40 · passed after one revision");
    assert.deepEqual(critiqueStatus(concept({ score: undefined, passed: undefined, escalated: true })), { text: "Not scored: your call", tone: "muted" });
    assert.equal(renderToStaticMarkup(createElement(ConceptCritique, { entry: undefined })), "");
  });
});

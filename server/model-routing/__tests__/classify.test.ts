import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTaskType, heuristicTaskType, shouldClassifyWithJev } from "../classify";

describe("heuristic task classification", () => {
  it("reads a Motion Design or film brief as motion", () => {
    assert.equal(heuristicTaskType("Build a 3D motion website from my attached references"), "motion");
    assert.equal(heuristicTaskType("/motion-site-studio\nMake a cinematic scroll film"), "motion");
    assert.equal(heuristicTaskType("Render a 15s brand video with Higgsfield"), "motion");
  });

  it("reads planning language as plan", () => {
    assert.equal(heuristicTaskType("Plan the approach for the new billing service"), "plan");
    assert.equal(heuristicTaskType("Write a roadmap and architecture for the rewrite"), "plan");
    assert.equal(heuristicTaskType("Scope the milestone and list the steps"), "plan");
  });

  it("reads implementation language as execute", () => {
    assert.equal(heuristicTaskType("Implement the pricing page and wire it to Stripe"), "execute");
    assert.equal(heuristicTaskType("Fix the failing tests and apply the review notes"), "execute");
    assert.equal(heuristicTaskType("Refactor the worker registry"), "execute");
  });

  it("treats a free-form ask as a normal request", () => {
    assert.equal(heuristicTaskType("What is in today's inbox?"), "normal");
    assert.equal(heuristicTaskType("Summarise yesterday's meeting"), "normal");
    assert.equal(heuristicTaskType("Write a summary of the meeting"), "normal");
    assert.equal(heuristicTaskType("Create a short note about pricing"), "normal");
  });

  it("asks Jev only when a send function is given or the live switch is on", () => {
    assert.equal(
      shouldClassifyWithJev(async () => ({ model: "jev-latest", answers: {} })),
      true,
    );
  });

  it("prefers motion over a generic 'build' when both appear", () => {
    assert.equal(heuristicTaskType("Build a cinematic motion site with GSAP scroll slides"), "motion");
  });
});

describe("classifyTaskType", () => {
  it("honours an explicit tag over the text", async () => {
    const decision = await classifyTaskType({
      objective: "What is the weather?",
      taggedType: "motion",
    });
    assert.equal(decision.taskType, "motion");
    assert.equal(decision.source, "tagged");
  });

  it("falls back to the heuristic when Jev is not asked", async () => {
    const decision = await classifyTaskType({ objective: "Implement the login form" });
    assert.equal(decision.taskType, "execute");
    assert.equal(decision.source, "heuristic");
  });

  it("uses Jev's choice when a send function is given", async () => {
    const decision = await classifyTaskType({
      objective: "Please look at this vaguely worded thing",
      send: async () => ({
        model: "jev-latest",
        answers: {
          taskType: {
            type: "choice",
            choice: "plan",
            probabilities: { plan: 0.8, execute: 0.1, motion: 0.05, normal: 0.05 },
            confidence: 0.8,
          },
        },
      }),
    });
    assert.equal(decision.taskType, "plan");
    assert.equal(decision.source, "jev");
  });

  it("falls back to the heuristic when Jev's answer cannot be read", async () => {
    const decision = await classifyTaskType({
      objective: "Summarise the notes",
      send: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(decision.taskType, "normal");
    assert.equal(decision.source, "heuristic");
  });
});

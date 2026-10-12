import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleMotionPrompt, suggestedReferences, type MotionBrief, type MotionReference } from "../../../shared/motion-design-types";

const brief: MotionBrief = {
  brandName: "Pantry Pilot",
  brandSells: "A grocery list that cooks with you",
  brandAudience: "Home cooks who hate wasting food",
  vibe: "Warm, cinematic, slightly playful",
  journeyStart: "Overhead of a kitchen counter at dusk",
  journeyEnd: "A plated meal, camera close on the steam",
  journeyBeats: "Pan across the fridge, then follow a hand into the pan",
  sections: "Menu, how it works, pricing — each must prove it saves a weeknight",
  cta: "Start a free meal plan",
  extrasCharacter: false,
  extrasDeploy: "Vercel",
  youDecide: {},
};

const references: MotionReference[] = [
  {
    id: "ref_1",
    kind: "link",
    url: "https://styles.refero.design/example",
    likes: ["color", "typography"],
    note: "The mustard on cream, and the condensed headings",
  },
  {
    id: "ref_2",
    kind: "file",
    filename: "hero.png",
    path: "references/hero.png",
    likes: ["lighting", "composition"],
    note: "Single hard key light from the left",
  },
];

describe("motion design prompt assembly", () => {
  it("starts with the skill's own example invocation and fills Brand and Budget", () => {
    const prompt = assembleMotionPrompt({
      brief,
      references,
      budgetCeiling: 330,
      codeOnly: false,
      interviewAnswered: true,
    });

    assert.match(prompt, /^\/motion-site-studio\n/);
    assert.match(prompt, /Build a 3D motion website from my attached references/);
    assert.match(prompt, /Show two concepts and a verified itemized budget before spending/);
    assert.match(prompt, /Brand: Pantry Pilot/);
    assert.match(prompt, /A grocery list that cooks with you/);
    assert.match(prompt, /Budget: 330 Higgsfield credits maximum/);
  });

  it("includes the interview answers, reference files and links, and says the interview is already answered", () => {
    const prompt = assembleMotionPrompt({
      brief,
      references,
      budgetCeiling: 330,
      codeOnly: false,
      interviewAnswered: true,
    });

    assert.match(prompt, /The interview is already answered/);
    assert.match(prompt, /only ask about gaps/i);
    assert.match(prompt, /Journey \(most important\)/);
    assert.match(prompt, /Overhead of a kitchen counter at dusk/);
    assert.match(prompt, /plated meal/);
    assert.match(prompt, /hero\.png/);
    assert.match(prompt, /https:\/\/styles\.refero\.design\/example/);
    assert.match(prompt, /mustard on cream/);
    assert.match(prompt, /You decide is not spending authority/);
  });

  it("does not treat You decide as a credit ceiling, and switches to code-only motion when Higgsfield is off", () => {
    const decided: MotionBrief = {
      ...brief,
      brandName: "",
      youDecide: { brand: true, vibe: true, budget: true },
    };
    const prompt = assembleMotionPrompt({
      brief: decided,
      references: [],
      budgetCeiling: undefined,
      codeOnly: true,
      interviewAnswered: true,
    });

    assert.match(prompt, /You decide \(creative only — not a spending authorisation\)/);
    assert.doesNotMatch(prompt, /Budget: unlimited/);
    assert.match(prompt, /code-only motion/);
    assert.match(prompt, /Do not submit paid Higgsfield jobs/);
    assert.match(prompt, /Brand: \[you decide\]/);
  });

  it("suggests three reference starting points when the person has none", () => {
    const suggestions = suggestedReferences();
    assert.equal(suggestions.length, 3);
    assert.ok(suggestions.some((entry) => entry.url.includes("refero.design")));
    assert.ok(suggestions.some((entry) => entry.url.includes("mobbin.com")));
    assert.ok(suggestions.some((entry) => entry.url.includes("savee.it")));
    assert.ok(suggestions.every((entry) => entry.likes.length > 0 && entry.note));
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));
process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const types = await import("../../../shared/startup-types");
const store = await import("../store");
const interview = await import("../interview");
const personas = await import("../personas");
const score = await import("../score");
const scope = await import("../scope");
const graduate = await import("../graduate");

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

/** A Hermes that answers by what the packet asks for, and records what it was sent. */
function fakeHermes(replies: Record<string, unknown>) {
  const calls: { packet: string; system?: string }[] = [];
  const hermes = (async (packet: string, call?: { system?: string }) => {
    calls.push({ packet, system: call?.system });
    const key = Object.keys(replies).find((marker) => packet.includes(marker));
    if (!key) throw new Error(`No fake reply for: ${packet.slice(0, 60)}`);
    const reply = replies[key];
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  }) as unknown as typeof import("../../hermes/client").sendToHermes;
  return { hermes, calls };
}

const IDEA = { title: "Matter Desk", oneLiner: "Matter intake for small law firms", problem: "Opening a matter takes an hour of retyping", who: "Attorneys at 2–10 person firms", howItWorks: "One form, conflict check, engagement letter", whyNow: "", assumptions: ["Firms retype client details"] };
const VALUE = { customer: "Small SA law firms", jobToBeDone: "Open a matter", painToday: "Retyping", alternatives: ["Excel", "LegalSuite"], valueProposition: "Open a matter in five minutes", whoPays: "Managing partner", pricingIdea: "R450/user/month", advantage: "" };
const MVP = { targetUser: "Attorney at a small firm", problem: "Slow matter intake", coreWorkflow: ["Capture client", "Run conflict check", "Send engagement letter"], inScope: ["Client form"], outOfScope: ["Billing"], successMetric: "5 firms open 20 matters in 4 weeks", killCriteria: ["Fewer than 2 firms use it weekly"], timeboxWeeks: 6 };

const REVIEW = { workday: [{ task: "Open matters", wouldUse: true, why: "Saves retyping" }], replaces: "Excel", objections: ["POPIA"], dealBreakers: [], missing: ["Trust accounting"], wouldPay: "yes", price: "R400/month", wouldRecommend: true, fitScore: 9, reasons: ["Real pain"], verdict: "I'd try it." };

const strongScore = (value: number) => ({
  dimensions: Object.fromEntries(types.SCORE_DIMENSIONS.filter((d) => d.key !== "personaFit").map((d) => [d.key, { score: value, evidence: ["evidence"] }])),
  summary: "Clear pain.",
});

async function newVenture(name: string) {
  const venture = await store.createVenture({ name });
  await store.writeStage(venture.slug, "idea", types.IdeaSchema.parse(IDEA));
  await store.writeStage(venture.slug, "value", types.ValueSchema.parse(VALUE));
  return venture;
}

describe("the validity score", () => {
  it("weighs dimensions and shares out real evidence when there is none", () => {
    const all9 = Object.fromEntries(types.SCORE_DIMENSIONS.map((d) => [d.key, 9]));
    const withEvidence = types.weighDimensions({ ...all9, realEvidence: 0 }, { hasRealEvidence: true });
    const without = types.weighDimensions({ ...all9, realEvidence: 0 }, { hasRealEvidence: false });

    assert.equal(withEvidence.total, 8.1);
    assert.equal(without.total, 9);
    assert.equal(without.dimensions.some((d) => d.key === "realEvidence"), false);
    assert.ok(Math.abs(without.dimensions.reduce((sum, d) => sum + d.weight, 0) - 1) < 1e-9);
  });

  it("rounds to one decimal so 7.95 passes and 7.94 does not", () => {
    assert.equal(types.roundScore(7.95), 8);
    assert.equal(types.roundScore(7.94), 7.9);
    assert.ok(types.roundScore(7.95) >= types.VALIDITY_THRESHOLD);
    assert.ok(types.roundScore(7.94) < types.VALIDITY_THRESHOLD);
  });
});

describe("ventures and stages", () => {
  it("keeps stage content through the markdown round trip, with the vault file readable", async () => {
    const venture = await newVenture("Matter Desk");
    const read = await store.readStage(venture.slug, "idea");
    assert.deepEqual(read.content, types.IdeaSchema.parse(IDEA));
    const file = fs.readFileSync(path.join(root, "saas", venture.slug, "01-idea.md"), "utf8");
    assert.match(file, /# Idea/);
    assert.match(file, /Opening a matter takes an hour/);
  });

  it("locks each stage until the one before it is done, and MVP until the score passes", async () => {
    const venture = await store.createVenture({ name: "Locked" });
    let detail = await store.readVentureDetail(venture.slug);
    assert.ok(detail.locks.value);
    assert.ok(detail.locks.validate);
    assert.match(detail.locks.mvp ?? "", /Score/);

    await store.writeStage(venture.slug, "idea", types.IdeaSchema.parse(IDEA));
    await store.writeStage(venture.slug, "value", types.ValueSchema.parse(VALUE));
    detail = await store.readVentureDetail(venture.slug);
    assert.equal(detail.locks.value, undefined);
    assert.equal(detail.locks.validate, undefined);
    assert.ok(detail.locks.mvp);
  });

  it("appends parked ideas and decisions", async () => {
    const venture = await store.createVenture({ name: "Parked" });
    await store.appendLater(venture.slug, { title: "Billing", reason: "Not the core workflow" });
    await store.appendLater(venture.slug, { title: "Mobile app" });
    const detail = await store.readVentureDetail(venture.slug);
    assert.deepEqual(detail.later.map((item) => item.title), ["Billing", "Mobile app"]);
    assert.ok(detail.decisions.some((decision) => decision.title === "Venture started"));
  });

  it("merges a draft over what was saved instead of blanking it", async () => {
    const venture = await newVenture("Drafted");
    const { hermes } = fakeHermes({ "DRAFT IDEA": { title: "", whyNow: "Courts went digital" } });
    const draft = await interview.draftStage(venture.slug, "idea", { answers: [{ question: "Why now?", answer: "Digital courts" }] }, hermes);
    assert.equal(draft.title, "Matter Desk");
    assert.equal(draft.whyNow, "Courts went digital");
  });

  it("refuses a reply it cannot read", async () => {
    const venture = await newVenture("Garbled");
    const { hermes } = fakeHermes({ "HELP ME WORK OUT": "I think this is a great idea!" });
    await assert.rejects(interview.stageQuestions(venture.slug, "value", undefined, hermes), /could not be reached|not with questions/);
  });
});

describe("personas", () => {
  it("are saved once and reused across ventures", async () => {
    const { hermes } = fakeHermes({ "WRITE A PERSONA": { name: "Thandi", role: "Attorney", industry: "Law", seniority: "Partner", summary: "Runs a small firm", dayToDay: ["Open matters", "Draft letters"], tools: ["Outlook"], pains: ["Admin"], buying: "Partner signs", sceptical: ["Cloud and POPIA"], behaviour: ["Mention cost"] } });
    const drafted = await personas.draftPersona({ role: "Attorney", industry: "Law" }, hermes);
    const saved = await store.savePersona(drafted);
    assert.equal(saved.slug, "attorney-law");

    const a = await newVenture("First legal");
    const b = await newVenture("Second legal");
    await store.markPersonaUsed(saved.slug, a.slug);
    await store.markPersonaUsed(saved.slug, b.slug);
    const reread = await store.readPersona(saved.slug);
    assert.deepEqual(reread?.usedBy, [a.slug, b.slug]);
    assert.equal((await store.listPersonas()).length, 1);
  });

  it("review the idea in role, with the persona file as the system prompt, marked simulated", async () => {
    const venture = await newVenture("Reviewed");
    const { hermes, calls } = fakeHermes({ "REVIEW THIS PRODUCT IDEA": REVIEW });
    const review = await personas.runPersonaReview(venture.slug, "attorney-law", hermes);
    assert.equal(review.fitScore, 9);
    assert.equal(review.simulated, true);
    assert.match(calls[0].system ?? "", /You are answering one structured request/);
    assert.match(calls[0].system ?? "", /playing Thandi/);
    assert.match(fs.readFileSync(path.join(root, "saas", venture.slug, "validation", "persona-attorney-law.md"), "utf8"), /Simulated/);
  });

  it("rejects a persona review without a fit score", async () => {
    const venture = await newVenture("Bad review");
    const { hermes } = fakeHermes({ "REVIEW THIS PRODUCT IDEA": { verdict: "Looks great" } });
    await assert.rejects(personas.runPersonaReview(venture.slug, "attorney-law", hermes), /not with a review/);
  });
});

describe("scoring, pivoting and stopping", () => {
  it("opens the MVP stage at 8 or more", async () => {
    const venture = await newVenture("Strong");
    await personas.runPersonaReview(venture.slug, "attorney-law", fakeHermes({ "REVIEW THIS PRODUCT IDEA": REVIEW }).hermes);
    const attempt = await score.scoreVenture(venture.slug, fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(8.5) }).hermes);

    assert.equal(attempt.passed, true);
    assert.equal(attempt.conversations, 0);
    assert.equal(attempt.dimensions.find((d) => d.key === "personaFit")?.score, 9);
    const detail = await store.readVentureDetail(venture.slug);
    assert.equal(detail.locks.mvp, undefined);
    assert.equal(detail.venture.stage, "mvp");
  });

  it("refuses to score without a persona review", async () => {
    const venture = await newVenture("Unreviewed");
    await assert.rejects(score.scoreVenture(venture.slug, fakeHermes({}).hermes), /persona review/);
  });

  it("will not re-roll a failed score without new evidence", async () => {
    const venture = await newVenture("Re-roll");
    const review = fakeHermes({ "REVIEW THIS PRODUCT IDEA": { ...REVIEW, fitScore: 4 } }).hermes;
    await personas.runPersonaReview(venture.slug, "attorney-law", review);
    await score.scoreVenture(venture.slug, fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(5) }).hermes);

    await assert.rejects(score.scoreVenture(venture.slug, fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(9) }).hermes), /new evidence/);

    // A real conversation is new evidence, so it may be scored again.
    const validation = (await store.readStage(venture.slug, "validate")).content ?? types.ValidationSchema.parse({});
    await store.writeStage(venture.slug, "validate", { ...validation, conversations: [types.ConversationSchema.parse({ who: "Sipho", pain: 5, wouldPay: "yes" })] });
    const again = await score.scoreVenture(venture.slug, fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(9) }).hermes);
    assert.equal(again.conversations, 1);
  });

  it("below 8 allows one pivot, then a second miss stops the venture and writes the lesson", async () => {
    const venture = await newVenture("Weak");
    const review = fakeHermes({ "REVIEW THIS PRODUCT IDEA": { ...REVIEW, fitScore: 4 } }).hermes;
    const weak = fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(5) }).hermes;

    await personas.runPersonaReview(venture.slug, "attorney-law", review);
    const first = await score.scoreVenture(venture.slug, weak);
    assert.equal(first.passed, false);
    let detail = await store.readVentureDetail(venture.slug);
    assert.match(detail.locks.mvp ?? "", /needs 8/);
    assert.equal(detail.venture.status, "validating");

    const pivoted = await score.pivotVenture(venture.slug, "Narrow to conveyancers", fakeHermes({ "PIVOT THIS IDEA": { problem: "Conveyancing intake is slow", who: "Conveyancers", change: "Narrowed to conveyancers" } }).hermes);
    assert.equal(pivoted.pivotsUsed, 1);
    detail = await store.readVentureDetail(venture.slug);
    assert.equal(detail.stages.idea?.who, "Conveyancers");
    // The old reviews were of the old idea.
    assert.equal(detail.reviews.length, 0);
    await assert.rejects(score.scoreVenture(venture.slug, weak), /persona review/);

    await personas.runPersonaReview(venture.slug, "attorney-law", review);
    const second = await score.scoreVenture(venture.slug, weak);
    assert.equal(second.attempt, 2);
    assert.equal(second.passed, false);

    detail = await store.readVentureDetail(venture.slug);
    assert.equal(detail.venture.status, "stopped");
    assert.ok(detail.locks.idea);
    await assert.rejects(score.pivotVenture(venture.slug, undefined, fakeHermes({}).hermes), /pivot/);
    const learnings = fs.readFileSync(path.join(root, "saas", "LEARNINGS.md"), "utf8");
    assert.match(learnings, /Weak \(stopped\)/);
    assert.match(learnings, /Pivoted after scoring/);
  });
});

describe("the scope guard and graduation", () => {
  async function passedVenture(name: string) {
    const venture = await newVenture(name);
    await personas.runPersonaReview(venture.slug, "attorney-law", fakeHermes({ "REVIEW THIS PRODUCT IDEA": REVIEW }).hermes);
    await score.scoreVenture(venture.slug, fakeHermes({ "SCORE THIS STARTUP IDEA": strongScore(9) }).hermes);
    await store.writeStage(venture.slug, "mvp", types.MvpSchema.parse(MVP));
    return venture;
  }

  it("parks a 'later' feature and leaves an 'in' one alone", async () => {
    const venture = await passedVenture("Scoped");
    const later = await scope.checkScope(venture.slug, "Trust accounting", {}, fakeHermes({ "IS THIS IN THE MVP?": { verdict: "Later", reason: "Not needed to open a matter", clause: "Core workflow" } }).hermes);
    const inside = await scope.checkScope(venture.slug, "Client email field", {}, fakeHermes({ "IS THIS IN THE MVP?": { verdict: "in", reason: "Engagement letter needs it" } }).hermes);
    const pivot = await scope.checkScope(venture.slug, "Make it for accountants", {}, fakeHermes({ "IS THIS IN THE MVP?": { verdict: "pivot", reason: "Different user" } }).hermes);

    assert.equal(later.verdict, "later");
    assert.equal(inside.verdict, "in");
    assert.equal(pivot.verdict, "pivot");
    assert.deepEqual((await store.readLater(venture.slug)).map((item) => item.title), ["Trust accounting"]);
    await assert.rejects(scope.checkScope(venture.slug, "x", {}, fakeHermes({ "IS THIS IN THE MVP?": { verdict: "maybe" } }).hermes), /verdict/);
  });

  it("creates a workspace with only the MVP workflow under Now", async () => {
    const venture = await passedVenture("Matter Desk Pro");
    await store.appendLater(venture.slug, { title: "Trust accounting" });
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });

    const graduated = await graduate.graduateVenture(venture.slug);
    assert.equal(graduated.workspace, "matter-desk-pro");
    assert.equal(graduated.status, "building");

    const tasks = fs.readFileSync(path.join(root, "projects", "matter-desk-pro", "TASKS.md"), "utf8");
    const now = tasks.slice(tasks.indexOf("## Now"), tasks.indexOf("## Next"));
    assert.match(now, /Capture client/);
    assert.match(now, /Send engagement letter/);
    assert.doesNotMatch(now, /Billing|Trust accounting/);
    assert.match(tasks.slice(tasks.indexOf("## Later")), /Trust accounting/);
    await assert.rejects(graduate.graduateVenture(venture.slug), /already/);
  });

  it("will not graduate a venture whose score has not passed", async () => {
    const venture = await newVenture("Not yet");
    await store.writeStage(venture.slug, "mvp", types.MvpSchema.parse(MVP));
    await assert.rejects(graduate.graduateVenture(venture.slug), /validity score/);
  });
});

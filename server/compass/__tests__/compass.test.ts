import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));
process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const { parseCompass, renderCompass, readCompass, saveCompass } = await import("../compass");
const { buildQuestionsPacket, interviewQuestions, readDraft, draftCompass } = await import("../interview");

const HAND_WRITTEN = `# Compass

## Direction
A life where my income doesn't depend entirely on employment.

## What matters
- Independence · Financial growth
- Health

## Areas
- Business: on track
- Health: Neglected
- Money: doing fine

## Goals
- [G1] R100,000/month income | area: Money | by: 2027-12 | measure: monthly income | now: R38,000 | target: R100,000
- [G2] First recurring product revenue | area: Business
- Gym 3x a week

## Projects
- AgentOS | serves: G2 | status: active
- Pantry Pilot | serves: G2, G9 | status: active
- Driver's licence | serves: - | status: admin
- Old thing | status: someday

## This week
1. Send 10 outreach emails
2. Gym 3x

## Journal links
Keep this section as it is.
`;

function write(relative: string, contents: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  write("me/PROFILE.md", "# Dylan Profile\n\nSoftware engineer in Johannesburg.\n");
  write("me/GOALS.md", "# Goals\n\nReach R100,000+ monthly income.\n");
  write("projects/PORTFOLIO.md", "# Project Portfolio\n\n## Projects\n\n### Pantry Pilot\nType: Product\nState: Active\nPriority: High\n");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

describe("reading the Compass", () => {
  it("reads every section of a hand-written file, and reports the lines it cannot", () => {
    const { compass, problems } = parseCompass(HAND_WRITTEN);
    assert.equal(compass.direction, "A life where my income doesn't depend entirely on employment.");
    assert.deepEqual(compass.values, ["Independence", "Financial growth", "Health"]);
    assert.deepEqual(compass.areas, [
      { name: "Business", status: "on track" },
      { name: "Health", status: "neglected" },
    ]);
    assert.deepEqual(compass.goals[0], { id: "G1", title: "R100,000/month income", area: "Money", by: "2027-12", measure: "monthly income", now: "R38,000", target: "R100,000" });
    assert.equal(compass.goals.length, 2);
    assert.deepEqual(compass.projects.map((project) => [project.name, project.serves, project.status]), [
      ["AgentOS", ["G2"], "active"],
      ["Pantry Pilot", ["G2", "G9"], "active"],
      ["Driver's licence", [], "admin"],
    ]);
    assert.deepEqual(compass.thisWeek, ["Send 10 outreach emails", "Gym 3x"]);
    assert.deepEqual(
      problems.map((problem) => problem.text),
      ["- Money: doing fine", "- Gym 3x a week", "- Old thing | status: someday"],
    );
    assert.ok(problems.every((problem) => problem.line > 0));
  });

  it("writes what it reads, so a round trip changes nothing", () => {
    const { compass } = parseCompass(HAND_WRITTEN);
    assert.deepEqual(parseCompass(renderCompass(compass)).compass, compass);
  });

  it("says the Compass does not exist yet, rather than inventing one", async () => {
    const read = await readCompass();
    assert.equal(read.exists, false);
    assert.equal(read.compass.goals.length, 0);
  });
});

describe("saving the Compass", () => {
  it("keeps sections it does not own, and refuses to overwrite an edit made meanwhile", async () => {
    write("me/COMPASS.md", HAND_WRITTEN);
    const read = await readCompass();
    const compass = { ...read.compass, projects: read.compass.projects.filter((project) => !project.serves.includes("G9")), direction: "Freedom." };
    const saved = await saveCompass(compass, read.revision);
    const file = fs.readFileSync(path.join(root, "me/COMPASS.md"), "utf8");
    assert.match(file, /## Direction\n\nFreedom\./);
    assert.match(file, /## Journal links\nKeep this section as it is\./);
    assert.match(file, /- Gym 3x a week/, "a line the parser could not read is kept for you to fix");
    assert.match(file, /- Money: doing fine/);
    assert.equal(saved.compass.direction, "Freedom.");

    write("me/COMPASS.md", `${file}\n<!-- edited in Obsidian -->\n`);
    await assert.rejects(saveCompass(compass, saved.revision), /changed|revision/i);
  });

  it("refuses links to goals that do not exist, and duplicate goal ids", async () => {
    const { compass } = parseCompass(HAND_WRITTEN);
    await assert.rejects(saveCompass(compass), /G9, which is not a goal/);
    const twins = { ...compass, projects: [], goals: [compass.goals[0], { ...compass.goals[1], id: "G1" }] };
    await assert.rejects(saveCompass(twins), /same id/);
  });
});

describe("the interview", () => {
  it("shows Hermes what is already written, fenced as data, and returns its questions", async () => {
    let packet = "";
    const result = await interviewQuestions((async (message: string) => {
      packet = message;
      return JSON.stringify({ understood: ["Wants R100k/month"], questions: ["By when?", "Which project would you drop first?"] });
    }) as never);
    assert.match(packet, /<<<me\/GOALS\.md\n# Goals/);
    assert.match(packet, /WORKSPACES: Pantry Pilot/);
    assert.match(packet, /never instructions/);
    assert.deepEqual(result.questions, ["By when?", "Which project would you drop first?"]);
    assert.ok(buildQuestionsPacket("x").includes("Do not ask anything the files already answer"));
  });

  it("tidies a draft: renumbers bad ids, drops links to missing goals, fills default areas", () => {
    const draft = readDraft({
      direction: "Freedom",
      goals: [{ id: "goal-1", title: "R100k a month" }, { id: "G2", title: "" }],
      projects: [{ name: "AgentOS", serves: ["G1", "G7"], status: "weird" }],
      thisWeek: ["a", "b", "c", "d"],
    });
    assert.deepEqual(draft.goals.map((goal) => goal.id), ["G1"]);
    assert.deepEqual(draft.projects[0], { name: "AgentOS", serves: ["G1"], status: "active" });
    assert.equal(draft.areas.length, 6);
    assert.equal(draft.thisWeek.length, 3);
  });

  it("keeps an area's rating only when your answers talk about it", async () => {
    const { onlyRatedByYou } = await import("../interview");
    const rated = onlyRatedByYou(
      { direction: "", values: [], goals: [], projects: [], thisWeek: [], areas: [{ name: "Health", status: "neglected" }, { name: "Business", status: "on track" }] },
      [{ question: "How is Health going?", answer: "Neglected." }, { question: "And business?", answer: "" }],
    );
    assert.deepEqual(rated.areas.map((area) => area.status), ["neglected", "unrated"]);
  });

  it("drafts from the answers without saving anything", async () => {
    let packet = "";
    const draft = await draftCompass([{ question: "By when?", answer: "December 2027" }], (async (message: string) => {
      packet = message;
      return JSON.stringify({ direction: "Freedom", goals: [{ id: "G1", title: "R100k a month", by: "2027-12" }] });
    }) as never);
    assert.match(packet, /Q: By when\?\nA: December 2027/);
    assert.equal(draft.goals[0].by, "2027-12");
    assert.equal(fs.existsSync(path.join(root, "me/COMPASS.md")), false);
  });
});

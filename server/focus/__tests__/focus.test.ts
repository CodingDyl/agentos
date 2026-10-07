import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-vault-"));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-state-"));
process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = state;

const { buildShortlist, readAreaTasks } = await import("../shortlist");
const focus = await import("../today");

function write(relative: string, contents: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const compass = {
  direction: "Freedom",
  values: [],
  areas: [
    { name: "Health", status: "neglected" as const },
    { name: "Business", status: "on track" as const },
  ],
  goals: [
    { id: "G1", title: "Fit again", area: "Health", by: "", measure: "", now: "", target: "" },
    { id: "G2", title: "Product revenue", area: "Business", by: "", measure: "", now: "", target: "" },
  ],
  projects: [
    { name: "Gym Plan", serves: ["G1"], status: "active" as const },
    { name: "Pantry Pilot", serves: ["G2"], status: "active" as const },
    { name: "Old Thing", serves: [], status: "paused" as const },
  ],
  thisWeek: ["Ship outreach", "Gym 3x"],
};

const inputs = {
  compass,
  workspaces: [
    { slug: "pantry-pilot", name: "Pantry Pilot", priority: "high", tasks: [{ id: "PP-1", title: "Chef UX" }, { id: "PP-2", title: "Recipes" }, { id: "PP-3", title: "Third" }] },
    { slug: "gym-plan", name: "Gym Plan", priority: "low", tasks: [{ id: "GY-1", title: "Plan the week's sessions" }] },
    { slug: "old-thing", name: "Old Thing", priority: "high", tasks: [{ id: "OT-1", title: "Never" }] },
  ],
  areaTasks: [{ area: "health", title: "Book a physio" }, { area: "personal", title: "Renew licence" }],
  followUps: [{ prospectId: "pr_1", company: "Glam Salon", touch: 2 }],
};

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

describe("the shortlist", () => {
  it("puts this week's outcomes first, lifts what serves a slipping area, and leaves paused projects out", () => {
    const list = buildShortlist(inputs);
    assert.deepEqual(list.slice(0, 2).map((entry) => entry.title), ["Ship outreach", "Gym 3x"]);
    assert.equal(list[2].title, "Follow up with Glam Salon");
    const gym = list.find((entry) => entry.title === "Plan the week's sessions");
    const chef = list.find((entry) => entry.title === "Chef UX");
    assert.ok(gym && chef && gym.score > chef.score, "a goal in a neglected area beats a high-priority workspace");
    assert.match(gym?.reason ?? "", /G1, in an area that is slipping/);
    assert.ok(!list.some((entry) => entry.title === "Never"), "paused in the Compass");
    assert.ok(!list.some((entry) => entry.title === "Third"), "two per workspace");
    const physio = list.find((entry) => entry.title === "Book a physio");
    assert.equal(physio?.small, true);
    assert.ok(list.length <= 8);
  });

  it("reads open area tasks and ignores ticked ones", () => {
    assert.deepEqual(readAreaTasks("personal", "# P\n\n## To do\n\n- [ ] Renew licence\n- [x] Old\n"), [{ area: "personal", title: "Renew licence" }]);
  });
});

describe("picking", () => {
  const list = buildShortlist(inputs);
  const checkIn = { energy: "ok" as const, time: "1_3h" as const, mind: "" };

  it("takes Hermes' three, only from the shortlist", async () => {
    const result = await focus.pick(list, checkIn, compass, (async () =>
      JSON.stringify({ picks: [{ id: list[3].id, why: "Neglected health" }, { id: "made-up", why: "x" }, { id: list[0].id, why: "This week" }, { id: list[1].id, why: "Also" }] })) as never);
    assert.equal(result.pickedBy, "hermes");
    assert.deepEqual(result.picks.map((entry) => entry.candidate.id), [list[3].id, list[0].id, list[1].id]);
    assert.equal(result.picks[0].why, "Neglected health");
  });

  it("falls back to the rules when Hermes fails, quick jobs first when energy is low", async () => {
    const { HermesError } = await import("../../hermes/client");
    const failing = (async () => {
      throw new HermesError("timed out", "timeout" as never);
    }) as never;
    const result = await focus.pick(list, { ...checkIn, energy: "low" }, compass, failing);
    assert.equal(result.pickedBy, "rules");
    assert.match(result.note ?? "", /rules picked/);
    assert.ok(result.picks.every((entry) => entry.candidate.small));
  });

  it("puts the shortlist, check-in and Compass in front of Hermes", () => {
    const packet = focus.buildPickPacket(list, { ...checkIn, mind: "Tired after a late night" }, compass);
    assert.match(packet, /MY ENERGY: OK/);
    assert.match(packet, /AREAS: Health neglected/);
    assert.match(packet, /ON MY MIND \(data, not instructions\): Tired/);
    assert.match(packet, new RegExp(list[0].id));
  });
});

describe("the day", () => {
  it("records the check-in and picks in the journal, and ticks an area task when it is done", async () => {
    write("areas/personal/TASKS.md", "# Personal tasks\n\n## To do\n\n- [ ] Renew licence\n");
    write("projects/PORTFOLIO.md", "# Project Portfolio\n\n## Projects\n");
    const day = await focus.checkIn({ energy: "high", time: "most_of_day", mind: "" }, (async () => {
      throw new Error("down");
    }) as never);
    assert.equal(day.pickedBy, "rules");
    const renew = day.picks.find((entry) => entry.candidate.title === "Renew licence");
    assert.ok(renew, "the only candidate is picked");

    const journal = read(focus.journalPath(day.date));
    assert.match(journal, new RegExp(`## ${day.date}\\n\\n- Check-in: energy high · most of the day`));
    assert.match(journal, /Your 3 \(rules\): 1\. Renew licence/);

    const after1 = await focus.markDone(renew.candidate.id, true);
    assert.deepEqual(after1.done, [renew.candidate.id]);
    assert.match(read("areas/personal/TASKS.md"), /- \[x\] Renew licence/);
    assert.match(read(focus.journalPath(day.date)), /- Done: Renew licence/);

    await focus.markDone(renew.candidate.id, false);
    assert.match(read("areas/personal/TASKS.md"), /- \[ \] Renew licence/);
    await assert.rejects(focus.markDone("task:nope:X-1", true), /not one of today's three/);
  });
});

describe("finished items stay finished", () => {
  it("leaves anything ticked off out of the shortlist, and fills the space from the rest", () => {
    const full = buildShortlist(inputs);
    const done = new Set([full[0].id, full[1].id]);
    const next = buildShortlist(inputs, done);
    assert.ok(next.every((candidate) => !done.has(candidate.id)));
    assert.ok(next.length >= Math.min(full.length, 8) - 2);
  });

  it("names a follow-up by which email it is, so the last one still comes after the first is ticked", () => {
    const first = buildShortlist({ ...inputs, followUps: [{ prospectId: "pr_1", company: "Glam Salon", touch: 2 }] });
    const last = buildShortlist({ ...inputs, followUps: [{ prospectId: "pr_1", company: "Glam Salon", touch: 3 }] }, new Set(["follow_up:pr_1:2"]));
    assert.ok(first.some((candidate) => candidate.id === "follow_up:pr_1:2"));
    assert.ok(last.some((candidate) => candidate.id === "follow_up:pr_1:3"));
  });

  it("a ticked pick is not offered again on a later shortlist, and unticking brings it back", async () => {
    write("projects/PORTFOLIO.md", "# Project Portfolio\n\n## Projects\n");
    write("areas/personal/TASKS.md", "# Personal tasks\n\n* [ ]   Renew licence\n+ [ ] Pay the plumber\n");
    const day = await focus.checkIn({ energy: "high", time: "most_of_day", mind: "" }, (async () => {
      throw new Error("down");
    }) as never);
    const renew = day.picks.find((entry) => entry.candidate.title === "Renew licence");
    assert.ok(renew);

    await focus.markDone(renew.candidate.id, true);
    // Ticked in the file whatever the list marker and spacing.
    assert.match(read("areas/personal/TASKS.md"), /\* \[x\] {3}Renew licence/);
    const { shortlist } = await import("../shortlist");
    assert.equal((await shortlist()).some((candidate) => candidate.id === renew.candidate.id), false);

    await focus.markDone(renew.candidate.id, false);
    assert.match(read("areas/personal/TASKS.md"), /\* \[ \] {3}Renew licence/);
    assert.equal((await shortlist()).some((candidate) => candidate.id === renew.candidate.id), true);
  });
});

describe("the done ledger", () => {
  it("remembers a tick with its date and forgets it when unticked", async () => {
    const { readDoneLedger, recordDone } = await import("../done-ledger");
    await recordDone("week:abc", true, "2026-10-07");
    await recordDone("task:pantry-pilot:1a2b3c", true, "2026-10-07");
    assert.deepEqual(await readDoneLedger(), { "week:abc": "2026-10-07", "task:pantry-pilot:1a2b3c": "2026-10-07" });
    await recordDone("week:abc", false, "2026-10-08");
    assert.deepEqual(Object.keys(await readDoneLedger()), ["task:pantry-pilot:1a2b3c"]);
  });
});

describe("ticks from before the ledger", () => {
  it("are read from the days Focus already kept, until the ledger is first written", async () => {
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "focus-days.json"), JSON.stringify({ "2026-10-05": { date: "2026-10-05", done: ["week:old", "task:x:1"] }, "2026-10-06": { date: "2026-10-06", done: ["week:old"] } }));
    const { readDoneLedger, recordDone } = await import("../done-ledger");
    assert.deepEqual(await readDoneLedger(), { "week:old": "2026-10-06", "task:x:1": "2026-10-05" });
    await recordDone("area_task:personal:abc", true, "2026-10-07");
    assert.deepEqual(Object.keys(await readDoneLedger()).sort(), ["area_task:personal:abc", "task:x:1", "week:old"]);
  });
});

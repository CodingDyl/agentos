import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Automation } from "../../../shared/agentos-types";
import { HermesError } from "../../hermes/client";
import { ROUTINES, routineScript, routineScriptName } from "../catalog";
import { installRoutine, listRoutines, readPhone, type RoutineDeps } from "../install";

/**
 * Installing writes into Hermes, so it must never create a second copy of a
 * job, and it must not report success for a job Hermes didn't create.
 */

const job = (id: string, over: Partial<Automation> = {}): Automation => ({
  id,
  name: `Job ${id}`,
  schedule: "weekdays at 9:00am",
  enabled: true,
  state: "active",
  skills: [],
  warnings: [],
  ...over,
});

/** A Hermes that records what it was asked, and creates the job only when `creates` is true. */
function fakeHermes(existing: Automation[] = [], creates = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "routines-"));
  const jobs = [...existing];
  const calls: string[][] = [];
  const deps: RoutineDeps = {
    home,
    port: 8787,
    listAutomations: async () => jobs,
    runCli: async (args) => {
      calls.push(args);
      if (creates) {
        jobs.push(job("new", { name: args[args.indexOf("--name") + 1], recipe: { script: args[args.indexOf("--script") + 1], noAgent: true, deliver: "telegram", toolsets: [] } }));
      }
      return creates ? "Created job: new\n" : "\nScript not found: nope\n";
    },
  };
  return { deps, calls, home };
}

describe("the routine script", () => {
  it("asks AgentOS for its own feed and never fails the job", () => {
    const script = routineScript(ROUTINES[0], 9001);

    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, new RegExp(`\\$\\{AGENTOS_PORT:-9001\\}/api/routines/feed/${ROUTINES[0].id}"`));
    // -f: an error page from AgentOS must not be sent to the phone as a message.
    assert.match(script, /curl -s -f /);
    assert.match(script, /\nexit 0\n$/);
  });
});

describe("installing a routine", () => {
  it("writes the script and creates one no-agent job that delivers to Telegram", async () => {
    const { deps, calls, home } = fakeHermes();

    await installRoutine("follow-ups", deps);

    assert.ok(fs.existsSync(path.join(home, "scripts", "agentos-routine-follow-ups.sh")));
    assert.deepEqual(calls, [
      ["cron", "create", "0 9 * * 1-5", "--name", "AgentOS: Follow-ups due", "--deliver", "telegram", "--script", "agentos-routine-follow-ups.sh", "--no-agent"],
    ]);
  });

  it("does nothing when the job is already there", async () => {
    const { deps, calls } = fakeHermes([job("a", { recipe: { script: routineScriptName("inbox"), toolsets: [] } })]);

    await installRoutine("inbox", deps);

    assert.equal(calls.length, 0);
  });

  it("fails with Hermes' words when the job didn't appear", async () => {
    const { deps } = fakeHermes([], false);

    await assert.rejects(installRoutine("evening-wrap", deps), (error: unknown) => {
      assert.ok(error instanceof HermesError);
      assert.match(error.message, /Script not found: nope/);
      return true;
    });
  });
});

describe("listing routines", () => {
  it("marks a routine installed by the script its job runs", async () => {
    const { deps, home } = fakeHermes([
      job("a", { recipe: { script: "agentos-agenda.sh", toolsets: [] } }),
      job("b", { recipe: { script: routineScriptName("overdue-invoices"), toolsets: [] } }),
    ]);
    fs.writeFileSync(path.join(home, "gateway_state.json"), JSON.stringify({ platforms: { telegram: { state: "connected" } } }));

    const { routines, phone } = await listRoutines(deps);

    assert.equal(routines.length, ROUTINES.length);
    assert.deepEqual(
      routines.filter((routine) => routine.installed).map((routine) => [routine.id, routine.automationId]),
      [["overdue-invoices", "b"]],
    );
    assert.deepEqual(phone, { connected: true });
  });

  it("falls back to the job's name when Hermes' job record can't be read", async () => {
    const { deps } = fakeHermes([job("c", { name: "AgentOS: Evening wrap" })]);

    const { routines } = await listRoutines(deps);

    assert.equal(routines.find((routine) => routine.id === "evening-wrap")?.installed, true);
  });
});

describe("the phone connection", () => {
  it("is off, with Hermes' reason, when Telegram is not connected", () => {
    assert.deepEqual(readPhone(JSON.stringify({ platforms: { telegram: { state: "fatal", error_message: "Bot token rejected." } } })), {
      connected: false,
      detail: "Bot token rejected.",
    });
  });

  it("is off when the state is missing or unreadable", () => {
    assert.equal(readPhone(undefined).connected, false);
    assert.equal(readPhone("{nope").connected, false);
    assert.equal(readPhone("{}").connected, false);
  });
});

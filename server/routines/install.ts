import fs from "node:fs/promises";
import path from "node:path";
import type { Automation } from "../../shared/agentos-types";
import type { RoutineId, RoutinesResponse } from "../../shared/routine-types";
import { getAutomations, hermesHome, runHermesCli } from "../hermes/automations";
import { HermesError } from "../hermes/client";
import { findRoutine, routineJobName, routineScript, routineScriptName, ROUTINES } from "./catalog";

/**
 * Installing a routine: one script in Hermes' scripts folder and one Hermes
 * scheduled job that runs it and sends the output to Telegram.
 *
 * AgentOS keeps no record of its own. A routine is installed when Hermes has
 * a job that runs its script, so pausing or removing the job in Hermes is
 * seen here without anything to keep in step.
 */

export interface RoutineDeps {
  home: string;
  port: number;
  listAutomations: () => Promise<Automation[]>;
  runCli: (args: string[]) => Promise<string>;
}

function liveDeps(): RoutineDeps {
  return {
    home: hermesHome(),
    port: Number(process.env.AGENTOS_PORT ?? 8787),
    listAutomations: async () => (await getAutomations()).automations,
    runCli: runHermesCli,
  };
}

/** The Hermes job behind a routine: the one running its script, or carrying its name when the job record can't be read. */
function jobFor(automations: readonly Automation[], id: RoutineId): Automation | undefined {
  const script = routineScriptName(id);
  const name = routineJobName(findRoutine(id));
  return automations.find((automation) =>
    automation.recipe?.script ? path.basename(automation.recipe.script) === script : automation.name === name,
  );
}

/** Hermes' gateway writes each platform's connection state to `gateway_state.json`. */
export function readPhone(json: string | undefined): RoutinesResponse["phone"] {
  if (json === undefined) return { connected: false, detail: "Hermes' gateway hasn't run on this machine." };
  try {
    const telegram = (JSON.parse(json) as { platforms?: { telegram?: { state?: unknown; error_message?: unknown } } }).platforms?.telegram;
    if (telegram?.state === "connected") return { connected: true };
    return {
      connected: false,
      detail: typeof telegram?.error_message === "string" && telegram.error_message ? telegram.error_message : "Telegram isn't connected in Hermes.",
    };
  } catch {
    return { connected: false, detail: "Hermes' gateway state couldn't be read." };
  }
}

export async function listRoutines(deps: RoutineDeps = liveDeps()): Promise<RoutinesResponse> {
  const [automations, gateway] = await Promise.all([
    deps.listAutomations(),
    fs.readFile(path.join(deps.home, "gateway_state.json"), "utf8").catch(() => undefined),
  ]);

  return {
    routines: ROUTINES.map(({ id, name, summary, when, quietWhen }) => {
      const job = jobFor(automations, id);
      return { id, name, summary, when, quietWhen, installed: Boolean(job), automationId: job?.id };
    }),
    phone: readPhone(gateway),
  };
}

/**
 * Writes the script and creates the job. Installing twice does nothing the
 * second time, so a double click can't leave two jobs sending the same message.
 */
export async function installRoutine(id: RoutineId, deps: RoutineDeps = liveDeps()): Promise<void> {
  const routine = findRoutine(id);
  if (jobFor(await deps.listAutomations(), id)) return;

  const scripts = path.join(deps.home, "scripts");
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(scripts, routineScriptName(id)), routineScript(routine, deps.port), { mode: 0o755 });

  const output = await deps.runCli([
    "cron",
    "create",
    routine.schedule,
    "--name",
    routineJobName(routine),
    "--deliver",
    "telegram",
    "--script",
    routineScriptName(id),
    "--no-agent",
  ]);

  // The CLI exits 0 for some refusals, so the listing is what says it worked.
  if (!jobFor(await deps.listAutomations(), id)) {
    const said = output.split("\n").find((line) => line.trim().length > 0)?.trim();
    throw new HermesError(`Hermes didn't create the job${said ? `. It said: ${said}` : "."}`, "failed");
  }
}

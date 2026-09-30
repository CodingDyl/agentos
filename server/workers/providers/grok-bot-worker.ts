import type { GrokBotBridge } from "../../../shared/grok-bot-types";
import type { WorkerJob, WorkerJobResult } from "../../../shared/worker-types";
import { grokBotWorkspace } from "../../ai-stack/settings";
import { exportTask, readResult } from "../grok-bot-bridge";
import { checkWorkspace } from "../grok-bot-workspace";
import type { Worker, WorkerRunContext } from "../worker";

/**
 * Grok Bot: Grok working through a folder on an SSD.
 *
 * AgentOS and Grok share a workspace — `memory/` for Grok to read, `tasks/` for
 * AgentOS to write, `results/` for Grok to answer in — and the operator
 * triggers Grok by hand. There is no API key and no billing here.
 *
 * Healthy means the folders are there and usable. It never means Grok is
 * online or signed in; the bridge cannot see that.
 *
 * A run exports the task, parks the job as waiting, and watches for the result
 * file. The wait lives on the job record, so a restart resumes it rather than
 * losing it, and an unplugged SSD pauses it rather than failing it.
 */

/** How often the result folder is looked at. Short enough to feel immediate. */
function pollMs(): number {
  const configured = Number(process.env.AGENTOS_GROK_BOT_POLL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 3_000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Cancelled"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Watches for the result until one is accepted or the job is cancelled. */
async function awaitResult(job: WorkerJob, initial: GrokBotBridge, context: WorkerRunContext): Promise<WorkerJobResult> {
  let bridge = initial;
  const save = async (next: GrokBotBridge) => {
    bridge = next;
    await context.updateJob?.({ bridge });
  };

  for (;;) {
    const workspace = await checkWorkspace(bridge.workspace, { probe: false });

    if (workspace.state !== "available") {
      if (!bridge.workspaceUnavailableSince) {
        await save({ ...bridge, workspaceUnavailableSince: new Date().toISOString() });
        context.emit(
          "job.progress",
          `Workspace unavailable: ${workspace.reason ?? "the SSD is not connected"} The job keeps waiting and resumes when it is back.`,
        );
      }
      await sleep(pollMs(), context.signal);
      continue;
    }

    if (bridge.workspaceUnavailableSince) {
      await save({ ...bridge, workspaceUnavailableSince: undefined });
      context.emit("job.progress", "Workspace is back. Still awaiting the result file");
    }

    let check: Awaited<ReturnType<typeof readResult>>;
    try {
      check = await readResult(bridge, job.id);
    } catch {
      // The drive went mid-read; the next pass sees it as unavailable.
      await sleep(pollMs(), context.signal);
      continue;
    }

    if (check.kind === "rejected") {
      // Reported once per distinct bad file, not on every pass.
      if (bridge.rejection?.reason !== `${check.reason} [${check.fingerprint.slice(0, 12)}]`) {
        await save({
          ...bridge,
          rejection: { at: new Date().toISOString(), reason: `${check.reason} [${check.fingerprint.slice(0, 12)}]` },
        });
        context.emit("job.progress", `Result not imported: ${check.reason} Still waiting for a valid file.`, {
          resultPath: bridge.resultPath,
        });
      }
    }

    if (check.kind === "accepted") {
      await save({ ...bridge, importedAt: new Date().toISOString(), resultHash: check.hash, rejection: undefined });
      await context.updateJob?.({ status: "running" });
      context.emit("job.progress", "Result imported from the SSD", { resultPath: bridge.resultPath });

      if (check.result.status === "failed") {
        throw new Error(`Grok reported it could not do the task: ${check.result.error ?? check.result.reply}`);
      }
      return { summary: check.result.reply };
    }

    await sleep(pollMs(), context.signal);
  }
}

export const grokBotWorker: Worker = {
  id: "grok-bot",
  name: "Grok Bot",
  role: "Grok via a shared SSD workspace. Manually triggered.",
  capabilities: ["research"],
  manualOnly: true,
  transport: "Local file bridge",

  async healthCheck() {
    const status = await checkWorkspace(grokBotWorkspace(), { probe: false });
    return status.state === "available"
      ? { available: true }
      : { available: false, reason: status.reason ?? "The Grok Bot workspace is unavailable." };
  },

  async start(job, context) {
    let bridge = job.bridge;

    if (!bridge) {
      const workspace = grokBotWorkspace();
      if (!workspace) throw new Error("No Grok Bot workspace is set. Set it on the Workers page.");

      bridge = await exportTask(job, workspace, context.contextPacket);
      context.emit(
        "job.progress",
        `Task exported with ${bridge.notes.length} ${bridge.notes.length === 1 ? "note" : "notes"}`,
        { taskPath: bridge.taskPath, memoryDir: bridge.memoryDir },
      );
    }

    await context.updateJob?.({ status: "waiting", bridge });
    context.emit("job.progress", "Awaiting manual trigger. Copy the Grok instruction from the job page", {
      resultPath: bridge.resultPath,
    });

    return awaitResult(job, bridge, context);
  },
};

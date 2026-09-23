import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  HiggsfieldAccount,
  HiggsfieldModel,
} from "../../shared/design-generation-types";

/**
 * What the Higgsfield account can tell us before anything is spent.
 *
 * The renderer runs jobs; this asks the questions that cost nothing — who is
 * signed in, what the plan is, how many credits are left, what models exist,
 * and what one particular job *would* cost. That last one matters most: the
 * console had been showing a hardcoded guess of 1.5 credits per image, and
 * the CLI will say the real number for the real model before the operator
 * commits to it.
 *
 * Generation through the CLI spends the plan's credits at standard rates even
 * where a model is unlimited on the website. So the balance is shown beside
 * the cost, always, and neither is invented here.
 */

const run = promisify(execFile);

/** These are read-only calls; none of them should take long. */
const PROBE_TIMEOUT_MS = 30_000;

export function binary(): string {
  return process.env.AGENTOS_HIGGSFIELD_BIN?.trim() || "higgsfield";
}

/** Runs the CLI and parses `--json` output, or explains why it could not. */
async function readJson<T>(args: string[], timeout = PROBE_TIMEOUT_MS): Promise<T> {
  const { stdout } = await run(binary(), [...args, "--json"], {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });

  const text = stdout.trim();
  if (!text) throw new Error("The Higgsfield CLI returned nothing.");

  // The CLI sometimes prints a line of chatter before the payload; the JSON
  // is whatever starts at the first brace or bracket.
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`The Higgsfield CLI returned no JSON: ${text.slice(0, 200)}`);

  return JSON.parse(text.slice(start)) as T;
}

function detailOf(error: unknown): string {
  if (error instanceof Error && "stderr" in error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The signed-in account: plan, email and remaining credits.
 *
 * Never throws — a Designs page must still render when Higgsfield is
 * unreachable, and "not connected, here is why" is a better answer than an
 * error state over the whole screen.
 */
export async function accountStatus(): Promise<HiggsfieldAccount> {
  try {
    const payload = await readJson<{
      credits?: number;
      email?: string;
      subscription_plan_type?: string;
    }>(["account", "status"]);

    return {
      connected: true,
      email: payload.email,
      plan: payload.subscription_plan_type,
      credits: typeof payload.credits === "number" ? payload.credits : undefined,
    };
  } catch (error) {
    const detail = detailOf(error);

    return {
      connected: false,
      reason: detail.includes("ENOENT")
        ? "The Higgsfield CLI is not installed."
        : /unauthor|forbidden|401|403|token|login/i.test(detail)
          ? "Higgsfield is not signed in. Run `higgsfield auth login`."
          : `Higgsfield could not be reached: ${detail.split("\n").filter(Boolean).slice(-1)[0] ?? detail}`,
    };
  }
}

/**
 * The model catalogue, cached.
 *
 * Nearly a hundred models across images, video, audio and 3D, and the list
 * changes on Higgsfield's schedule rather than ours — so it is fetched rather
 * than hardcoded, and held briefly so opening the composer is not a CLI call
 * every time.
 */
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

let catalogue: { at: number; models: HiggsfieldModel[] } | undefined;

export async function listModels(): Promise<HiggsfieldModel[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.models;

  const payload = await readJson<{ job_type?: string; display_name?: string; type?: string }[]>([
    "model",
    "list",
  ]);

  const models = (Array.isArray(payload) ? payload : [])
    .flatMap((entry): HiggsfieldModel[] => {
      const id = entry.job_type?.trim();
      if (!id) return [];

      const kind = entry.type?.trim().toLowerCase();

      return [
        {
          id,
          name: entry.display_name?.trim() || id,
          // Only what this console can actually store and show. The rest of
          // the catalogue — 3D, audio, text — is real but not ours yet.
          kind: kind === "video" ? "video" : kind === "image" ? "image" : "other",
        },
      ];
    })
    .filter((model) => model.kind !== "other");

  catalogue = { at: Date.now(), models };
  return models;
}

/** Forgets the cached catalogue. For tests. */
export function resetModelCache(): void {
  catalogue = undefined;
}

export interface CostQuery {
  model: string;
  prompt: string;
  /** Each variation is its own job, so the total is per-job × count. */
  count?: number;
}

export interface CostEstimate {
  /** Credits for one job. */
  perJob: number;
  /** Credits for every variation asked for. */
  total: number;
  /** Set when the CLI would not price it; the UI says so rather than guessing. */
  unavailable?: string;
}

/**
 * What a generation would cost, from the CLI rather than from a constant.
 *
 * A prompt is passed as its own argument, so it is data and can never become
 * part of a command.
 */
export async function estimateCost(query: CostQuery): Promise<CostEstimate> {
  const count = Math.max(1, Math.min(query.count ?? 1, 8));

  try {
    const payload = await readJson<{ credits?: number }>([
      "generate",
      "cost",
      query.model,
      "--prompt",
      query.prompt || "concept",
    ]);

    const perJob = typeof payload.credits === "number" ? payload.credits : 0;

    return { perJob, total: perJob * count };
  } catch (error) {
    return {
      perJob: 0,
      total: 0,
      unavailable: `Higgsfield would not price this: ${detailOf(error).split("\n").filter(Boolean).slice(-1)[0] ?? "unknown error"}`,
    };
  }
}

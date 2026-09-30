import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AspectRatio } from "../../shared/design-generation-types";
import { decide } from "../connectors/policy";

/**
 * Rendering images, through the Higgsfield CLI.
 *
 * AgentOS runs the renderer itself rather than asking Hermes to. That is a
 * deliberate departure from letting the agent do it, and the reason is
 * specific: Hermes' own generation skill answers a request to make an image by
 * running `curl … | sh` to install a CLI — which it does even when the CLI is
 * already installed. Hermes gates that behind a high-severity approval, and it
 * should: piping a remote script into a shell is arbitrary code execution.
 *
 * A design tool must not put an operator in the position of approving that to
 * get a picture. So the division of labour is:
 *
 *     operator  →  intent
 *     Hermes    →  the prompt
 *     AgentOS   →  runs the renderer, with arguments it chose
 *
 * Every argument here is passed as its own array element, so a prompt is data
 * and can never become part of a command.
 *
 * **Verified against a live job** on 2026-09-22: a `gpt_image_2_5` render
 * returned two images and the account was charged the single credit the
 * composer had priced it at. The response reading stays deliberately loose —
 * it looks for image URLs anywhere in whatever comes back rather than binding
 * to key names — because the payload is Higgsfield's to change, and finding
 * nothing is reported plainly rather than guessed around.
 */

const run = promisify(execFile);

/** Long enough for a real image job; short enough not to hang a request. */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/** Video jobs queue and render for far longer than stills. */
const VIDEO_JOB_TIMEOUT_MS = 25 * 60 * 1000;

/** Checking the CLI is there should never take this long. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * The model concepts are rendered with.
 *
 * Overridable, because model availability is a property of the account rather
 * than of this code, and the right choice will change.
 */
export function generationModel(): string {
  return process.env.AGENTOS_IMAGE_MODEL?.trim() || "gpt_image_2_5";
}

function binary(): string {
  return process.env.AGENTOS_HIGGSFIELD_BIN?.trim() || "higgsfield";
}

export interface GenerationCapabilityResult {
  available: boolean;
  reason?: string;
  model?: string;
}

/**
 * Whether concepts can be rendered at all.
 *
 * Two questions, in order: is the renderer installed, and is it signed in?
 * Whether the account's *plan* permits a job is deliberately not asked here —
 * it would cost a request on every page load, and the CLI reports it clearly
 * when a job is actually attempted. Being signed in is what this can know
 * cheaply, and it fails closed on anything it cannot establish.
 */
export async function generationCapability(): Promise<GenerationCapabilityResult> {
  const decision = decide("higgsfield.generate", "person");
  if (!decision.allowed) return { available: false, reason: decision.reason };

  try {
    await run(binary(), ["version"], { timeout: PROBE_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    return {
      available: false,
      reason: detail.includes("ENOENT")
        ? "The higgsfield CLI is not installed, so there is nothing to render concepts with."
        : `The image renderer would not report its version: ${detail}`,
    };
  }

  try {
    const { stdout } = await run(binary(), ["auth", "token"], {
      timeout: PROBE_TIMEOUT_MS,
    });

    if (stdout.trim().length === 0) {
      return {
        available: false,
        reason: "The image renderer is installed but not signed in. Run `higgsfield auth login`.",
      };
    }
  } catch {
    return {
      available: false,
      reason:
        "The image renderer is installed but not signed in. Run `higgsfield auth login`.",
    };
  }

  return { available: true, model: generationModel() };
}

export interface RenderOptions {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Absolute paths, already resolved from library asset ids. */
  referencePaths?: string[];
  /** Higgsfield job type. The configured default when absent. */
  model?: string;
  /** A video model waits longer, and its result is a video URL. */
  kind?: "image" | "video";
}

/**
 * Every URL that looks like an image, wherever it sits in the response.
 *
 * Deliberately not a schema. The CLI's success payload has never been seen
 * from here, and a reader keyed to guessed field names would fail on the first
 * real job for a reason nobody could diagnose. A rendered image has to come
 * back as a URL somewhere, so that is what this looks for — in the JSON if it
 * parses, and in the raw text if it does not.
 */
export function extractImageUrls(output: string): string[] {
  const urls = new Set<string>();

  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.add(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }

    if (typeof value === "object" && value !== null) {
      for (const entry of Object.values(value)) collect(entry);
    }
  };

  // The CLI prints one JSON document per line in some modes and one overall in
  // others, so every line is tried before falling back to a text scan.
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;

    try {
      collect(JSON.parse(trimmed));
    } catch {
      // Not a complete document on its own; the whole-output attempt below
      // and the text scan still have a chance at it.
    }
  }

  try {
    collect(JSON.parse(output));
  } catch {
    // Not JSON at all. The text scan is the remaining route.
  }

  for (const match of output.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    urls.add(match[0]);
  }

  // Anything that is plainly not a picture is dropped. A signed URL carries a
  // query string, so the extension is looked for before it.
  return [...urls].filter((url) =>
    /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url),
  );
}

/**
 * Every URL that looks like a rendered video, read the same loose way.
 *
 * A video job's payload also carries its poster and input images, so the two
 * lists are kept apart rather than merged: a video run that saved only its
 * thumbnail would look like success and be a still.
 */
export function extractVideoUrls(output: string): string[] {
  const urls = new Set<string>();
  for (const match of output.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    if (/\.(mp4|webm|mov)(\?|$)/i.test(match[0])) urls.add(match[0]);
  }
  return [...urls];
}

/** The argument list for one render. Exported so it can be tested. */
export function buildRenderArgs(options: RenderOptions): string[] {
  const args = [
    "generate",
    "create",
    options.model?.trim() || generationModel(),
    "--prompt",
    options.prompt,
  ];

  if (options.aspectRatio) {
    args.push("--aspect_ratio", options.aspectRatio);
  }

  // Repeated, which is how the CLI takes an array. Paths come from the
  // library, never from the browser.
  for (const path of options.referencePaths ?? []) {
    args.push("--image-references", path);
  }

  // Block until the job is done, and ask for the machine-readable form.
  args.push("--wait", "--wait-timeout", options.kind === "video" ? "20m" : "4m", "--json");

  return args;
}

export interface RenderResult {
  urls: string[];
  /** What the renderer actually said, kept for diagnosis. */
  raw: string;
}

/**
 * Renders one concept.
 *
 * Throws with the renderer's own words when it fails — a plan that refuses the
 * job, an unknown model, an expired session. Those messages are the actionable
 * part, so they are surfaced rather than summarised away.
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  let stdout: string;

  try {
    const result = await run(binary(), buildRenderArgs(options), {
      timeout: options.kind === "video" ? VIDEO_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });

    stdout = result.stdout;
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);

    throw new Error(readRendererError(detail), { cause: error });
  }

  return {
    urls: options.kind === "video" ? extractVideoUrls(stdout) : extractImageUrls(stdout),
    raw: stdout,
  };
}

/**
 * The renderer's failure, in terms an operator can act on.
 *
 * The CLI reports some conditions as a bare error code. Those are translated,
 * because `job_minimum_basic_plan_required` tells a person nothing about what
 * to do next, and it is the one this account actually hits.
 */
export function readRendererError(detail: string): string {
  const text = detail.trim();

  if (/job_minimum_basic_plan_required/i.test(text)) {
    return "The image renderer refused the job: this Higgsfield plan cannot create generations of that kind. A different model, or a higher plan, is what unblocks it.";
  }

  if (/insufficient|not enough credits|credit/i.test(text)) {
    return "The image renderer refused the job for want of credits.";
  }

  if (/unauthor|forbidden|401|403|token/i.test(text)) {
    return "The image renderer rejected the session. Run `higgsfield auth login` and try again.";
  }

  // Kept whole rather than truncated: the useful part of an unfamiliar error
  // is usually the bit a summary would drop.
  return `The image renderer failed: ${text.split("\n").filter(Boolean).slice(-3).join(" ")}`;
}

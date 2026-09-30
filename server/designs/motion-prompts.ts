import fs from "node:fs/promises";
import path from "node:path";
import type {
  MotionJobRequest,
  MotionPromptSource,
  MotionTemplate,
  MotionTemplateId,
} from "../../shared/motion-types";
import { agentOSRoot } from "../agentos/filesystem";

/**
 * The motion studio's prompts, read from the operator's vault.
 *
 * The notes in `motion_and_video/` are the source of truth: editing them in
 * Obsidian changes the next film. Each is read fresh for every job. When the
 * vault is unplugged or a note has moved, the built-in copy below is used and
 * the job records that it was, so a film is never made from a prompt nobody
 * can find afterwards.
 */

export const MOTION_NOTES_DIR = "motion_and_video";
const RULES_NOTE = "motion_studio_prompt.md";
const BRAND_NOTE = "motion_claude_basics.md";
const SHOWREEL_NOTE = "One Liner Showreel prompt.md";

export const BUILT_IN_RULES = `# Motion studio rules

## Render contract
- Every film is a pure function of time: \`window.seek(t)\` paints frame t.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode,
  no state carried between frames. Seeded noise only (mulberry32), never Math.random.
- Render with \`node render.mjs\`, encode H.264 yuv420p, CRF 16.

## Look
- Banned defaults: centered title on gradient, everything fading in,
  corner labels and frame borders, glow on UI chrome, generic particle bursts.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Place hits on the measured beat grid (beats.json). Loudness -14 LUFS.

## Loop before you show me anything
1. Render one frame per beat as a contact sheet and LOOK at it.
2. Score it 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync.
3. Fix the 3 worst problems. Repeat until every score is 8+.
4. Only then do the full render.`;

export const BUILT_IN_SHOWREEL =
  "make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are, like it's your showreel for a résumé. go all out.";

export const BUILT_IN_BRAND = `Make a dynamic 20-second motion graphics video for [PRODUCT] ([URL]), with the energy
of a motion designer's showreel. Go all out.

Assets
- Visit the site. Use real screenshots (Playwright), the real logo, real colors and fonts.
  Save everything to ./assets and list what you found before you animate.
- Never redraw the product UI from imagination. Crop and animate the real thing.

Story (one beat each, 2 to 4 seconds)
1. Hook: the problem in 5 words of huge kinetic type.
2. The product appears, the UI assembles itself piece by piece.
3. Three features, each as a UI moment with a cursor doing a real action.
4. One number that proves it works: [METRIC].
5. Logo lockup + [CTA].

Sound
- Original music, 120 BPM, synthesized in code. UI clicks and whooshes on the beat.

Format: 1080x1920 (9:16) first, then 1:1 and 16:9 from the same timeline.
Before the full render, show me a contact sheet of one frame per beat.`;

/** A note's body: no front matter, no trailing `## Related` links. */
export function noteBody(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/\n## Related[\s\S]*$/, "")
    .trim();
}

/** The one-liner itself, out of a note that also explains why it works. */
export function extractShowreelLine(body: string): string | undefined {
  const match = /make a dynamic[\s\S]*?go all out\.?/i.exec(body);
  return match ? match[0].replace(/\s*\n\s*/g, " ").trim() : undefined;
}

/** The reusable brand prompt, which sits under a heading in the basics note. */
export function extractBrandTemplate(body: string): string | undefined {
  const marker = /Dynamic Prompt for use with any brand:?/i.exec(body);
  if (!marker) return undefined;
  const text = body.slice(marker.index + marker[0].length).trim();
  return text.length > 0 ? text : undefined;
}

async function readNote(name: string): Promise<string | undefined> {
  try {
    const body = noteBody(await fs.readFile(path.join(agentOSRoot(), MOTION_NOTES_DIR, name), "utf8"));
    // Obsidian notes open with their own name as a heading; it is not part of the prompt.
    const title = path.basename(name, ".md");
    return body.startsWith(`# ${title}\n`) ? body.slice(title.length + 3).trim() : body;
  } catch {
    return undefined;
  }
}

const vault = (name: string): MotionPromptSource => ({ source: "vault", path: `${MOTION_NOTES_DIR}/${name}` });
const builtIn: MotionPromptSource = { source: "built-in" };

export interface MotionPrompts {
  rules: { text: string; source: MotionPromptSource };
  templates: MotionTemplate[];
}

export async function readMotionPrompts(): Promise<MotionPrompts> {
  const [rulesNote, brandNote, showreelNote] = await Promise.all([
    readNote(RULES_NOTE),
    readNote(BRAND_NOTE),
    readNote(SHOWREEL_NOTE),
  ]);

  const showreel = showreelNote ? extractShowreelLine(showreelNote) : undefined;
  const brand = brandNote ? extractBrandTemplate(brandNote) : undefined;

  return {
    rules: rulesNote
      ? { text: rulesNote, source: vault(RULES_NOTE) }
      : { text: BUILT_IN_RULES, source: builtIn },
    templates: [
      {
        id: "showreel",
        label: "Showreel",
        description: "The one-liner. The film shows off technique, with your product as the subject.",
        text: showreel ?? BUILT_IN_SHOWREEL,
        source: showreel ? vault(SHOWREEL_NOTE) : builtIn,
      },
      {
        id: "brand",
        label: "Brand film",
        description: "Hook, product, three features, one proof number, lockup. Uses the real site and UI.",
        text: brand ?? BUILT_IN_BRAND,
        source: brand ? vault(BRAND_NOTE) : builtIn,
      },
      {
        id: "custom",
        label: "Your brief",
        description: "Write the brief yourself. The studio rules still apply.",
        text: "",
        source: builtIn,
      },
    ],
  };
}

/** `9:16` → `1080x1920 (9:16)`. */
const FORMAT_SIZES: Record<string, string> = { "9:16": "1080x1920", "1:1": "1080x1080", "16:9": "1920x1080" };
export const formatLabel = (format: string) => `${FORMAT_SIZES[format] ?? format} (${format})`;

/** The brief for one film: the chosen template, filled in from the form. */
export function fillTemplate(templateId: MotionTemplateId, text: string, request: MotionJobRequest): string {
  const seconds = `${request.durationSec}-second`;
  const product = request.product?.trim();

  if (templateId === "custom") return request.brief?.trim() ?? "";

  if (templateId === "showreel") {
    let line = text.replace(/\b\d+-second\b/i, seconds);
    if (product && !line.includes(product)) {
      line = line.replace(/motion graphics video/i, (found) => `${found} about ${product}`);
    }
    return request.url ? `${line}\n\n${product ?? "The product"}: ${request.url}` : line;
  }

  return text
    .replace(/\b\d+-second\b/i, seconds)
    .replaceAll("[PRODUCT]", product ?? "the product")
    .replaceAll(
      "([URL])",
      request.url ? `(${request.url})` : "(no public site: use the brand material in ./assets/brand)",
    )
    .replaceAll("[URL]", request.url || "no public site")
    .replaceAll(
      "[METRIC]",
      request.metric?.trim() ||
        "none was supplied. Skip this beat or replace it with a product moment; never invent a number",
    )
    .replaceAll("[CTA]", request.cta?.trim() || "a clear call to action")
    .replace(/^Format:.*$/m, `Format: ${request.formats.map(formatLabel).join(", then ")} from the same timeline.`);
}

export interface StudioPromptInput {
  request: MotionJobRequest;
  rules: string;
  brief: string;
  brandFiles: string[];
  hasWorkspaceContext: boolean;
}

/**
 * Everything Claude Code is told.
 *
 * The operator's prompt and rules go first and unchanged. What AgentOS adds is
 * only what running unattended needs: where things are, where to put what it
 * makes so the operator can watch, and the lines it may not cross.
 */
export function buildStudioPrompt({ request, rules, brief, brandFiles, hasWorkspaceContext }: StudioPromptInput): string {
  const [master, ...cuts] = request.formats;
  const extraDirection =
    request.template !== "custom" && request.brief?.trim() ? `\n\nFurther direction from the operator:\n${request.brief.trim()}` : "";

  return [
    "# Brief",
    "",
    brief + extraDirection,
    "",
    rules,
    "",
    "# Running in the AgentOS motion studio",
    "",
    "You are working unattended. Nobody will answer questions mid-run, so decide, and note the decision in your summary.",
    "The current folder is your studio. Read STUDIO.md first: it lists the renderer, the reference film and what AgentOS reads back.",
    "",
    `- Length: ${request.durationSec} seconds. Master format: ${formatLabel(master)}.` +
      (cuts.length ? ` Then ${cuts.map(formatLabel).join(" and ")} from the same timeline.` : ""),
    brandFiles.length
      ? `- Brand material chosen by the operator is in ./assets/brand: ${brandFiles.join(", ")}. Look at every file before designing.`
      : "- No brand material was supplied. Find the real brand yourself (the site, if there is one) and save what you use to ./assets.",
    hasWorkspaceContext ? "- BRIEF.md includes the workspace's own notes about the product. Stay true to them." : null,
    "- Where AgentOS shows your review loop to the operator, live:",
    "  - Save each round's contact sheet as sheet/round-N.png (`node render.mjs --sheet --round N`).",
    "  - Append each round's scores and the fixes you chose to scores.json (format in STUDIO.md).",
    "  - Stop looping after 5 rounds even if a score is below 8, and say which one in your summary.",
    `- Finished films go in out/: out/final.mp4 for ${master}` +
      (cuts.length ? `, then ${cuts.map((format) => `out/final-${format.replace(":", "x")}.mp4`).join(", ")}` : "") +
      ". Every MP4 left in out/ is filed into the operator's Creative library, so leave nothing else there.",
    "- Never invent testimonials, customer names, user counts, metrics or launch dates. If the brief gives no number, show none.",
    "- Work only inside this folder. Do not delete anything outside it. Do not install global packages.",
    "",
    "When you are done, reply with a short summary: the film beat by beat, the final round's scores, and anything you could not do.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

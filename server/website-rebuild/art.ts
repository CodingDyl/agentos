import { z } from "zod";
import { AspectRatioSchema } from "../../shared/design-generation-types";
import { HERO_CONCEPT_IDS } from "../../shared/website-rebuild-types";

/**
 * Original imagery for the concepts, within a budget the person set for this
 * run. Off (0 credits) unless they say otherwise: every generation spends real
 * credits. The worker only writes the plan. AgentOS prices each image first,
 * stops at the budget, and keeps a ledger of what it spent.
 */

export const ART_MODEL = "gpt_image_2_5";
export const ART_PLAN_FILE = "design/ART.json";
export const ART_LEDGER_FILE = "design/art-ledger.csv";
const MAX_IMAGES_PER_CONCEPT = 3;

/** Added to every prompt: imagery that cannot pass for the client's real people or premises. */
export const ART_RULES = "No people, no faces, no hands. No text, letters, numbers or logos. No scales of justice, gavels, columns, handshakes or bookshelves. Not a recognisable real building. No watermark.";

export const ArtPlanSchema = z.object({
  images: z
    .array(
      z.object({
        concept: z.enum(HERO_CONCEPT_IDS),
        name: z.string().regex(/^[a-z0-9-]{1,40}$/),
        prompt: z.string().trim().min(20).max(1500),
        aspect: AspectRatioSchema.default("16:9"),
      }),
    )
    .max(HERO_CONCEPT_IDS.length * MAX_IMAGES_PER_CONCEPT),
});
export type ArtPlan = z.infer<typeof ArtPlanSchema>;

/** The plan a worker wrote, or undefined when it is missing or malformed. Per-concept excess is dropped. */
export function parseArtPlan(text: string | undefined): ArtPlan | undefined {
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const plan = ArtPlanSchema.safeParse(parsed);
  if (!plan.success) return undefined;
  const count = new Map<string, number>();
  return {
    images: plan.data.images.filter((image) => {
      const used = count.get(image.concept) ?? 0;
      count.set(image.concept, used + 1);
      return used < MAX_IMAGES_PER_CONCEPT;
    }),
  };
}

export interface ArtDeps {
  /** What one image of this prompt would cost, in credits. */
  price: (prompt: string, aspect: z.infer<typeof AspectRatioSchema>) => Promise<number | undefined>;
  /** Generates one image and returns its bytes. */
  generate: (prompt: string, aspect: z.infer<typeof AspectRatioSchema>) => Promise<Buffer>;
}

export interface ArtResult {
  /** Paths relative to the repo. */
  files: Record<string, Buffer>;
  /** Credits spent, as priced before each image. */
  spent: number;
  ledger: string;
  /** Why anything was skipped. */
  notes: string[];
}

/** Works through the plan one image at a time, and never starts an image the remaining budget cannot pay for. */
export async function generateArt(plan: ArtPlan, budget: number, deps: ArtDeps, now = new Date()): Promise<ArtResult> {
  const files: Record<string, Buffer> = {};
  const notes: string[] = [];
  const rows = ["date,concept,file,model,credits"];
  let spent = 0;
  for (const image of plan.images) {
    const prompt = `${image.prompt} ${ART_RULES}`;
    const file = `design/${image.concept}/art/${image.name}.png`;
    let cost: number | undefined;
    try {
      cost = await deps.price(prompt, image.aspect);
    } catch {
      cost = undefined;
    }
    if (cost === undefined) {
      notes.push(`${file}: could not be priced, so it was not generated.`);
      continue;
    }
    if (spent + cost > budget) {
      notes.push(`${file}: skipped, ${cost} credits would pass the budget of ${budget} (${spent} spent).`);
      continue;
    }
    try {
      files[file] = await deps.generate(prompt, image.aspect);
      spent += cost;
      rows.push(`${now.toISOString().slice(0, 10)},${image.concept},${file},${ART_MODEL},${cost}`);
    } catch (error) {
      notes.push(`${file}: generation failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }
  return { files, spent, ledger: `${rows.join("\n")}\n`, notes };
}

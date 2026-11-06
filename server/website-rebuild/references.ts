import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * Live pages a concept's worker studies: photographed today, not remembered.
 * Kept outside the client repo, because other people's sites have no place in a
 * client's history. A worker reads them through a read-only folder.
 */

export interface ReferenceTarget {
  label: string;
  url: string;
}

export interface CapturedReference extends ReferenceTarget {
  file: string;
}

/** Older than this is taken again, so the bar moves with the sites themselves. */
const MAX_AGE_MS = 14 * 24 * 60 * 60_000;
const BOT_WALL = /security verification|verify you are human|you have been blocked|access denied|checking your browser|just a moment/i;
/** Long enough for a site's preloader to finish, which is most of the award-winning ones. */
const SETTLE_MS = 6_000;

export const referencesDir = () => path.join(uiStateDir(), "design-references");
const referenceFile = (url: string) => path.join(referencesDir(), `${url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.png`);

/** Mostly one colour: a preloader or a blank page, which teaches a worker nothing. */
function looksBlank(pixels: { dominantShare: number }): boolean {
  return pixels.dominantShare > 0.93;
}

const DOMINANT_SHARE = `(async (src) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 40;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, 64, 40);
  const data = context.getImageData(0, 0, 64, 40).data;
  const counts = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const key = (data[index] >> 4) + "," + (data[index + 1] >> 4) + "," + (data[index + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Math.max(...counts.values()) / (64 * 40);
})`;

/**
 * Photographs each page that does not have a recent picture. A page that fails,
 * sits behind a bot wall or shows only its preloader is skipped: the concept
 * loses a reference, not its run.
 */
export async function captureReferences(targets: readonly ReferenceTarget[], log: (message: string) => void = () => undefined): Promise<CapturedReference[]> {
  await fs.mkdir(referencesDir(), { recursive: true });
  const unique = [...new Map(targets.map((target) => [target.url, target])).values()];
  const stale: ReferenceTarget[] = [];
  const captured: CapturedReference[] = [];
  for (const target of unique) {
    const file = referenceFile(target.url);
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat && Date.now() - stat.mtimeMs < MAX_AGE_MS) captured.push({ ...target, file });
    else stale.push(target);
  }
  if (stale.length === 0) return captured;

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    await Promise.all(
      stale.map(async (target) => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        try {
          await page.goto(target.url, { waitUntil: "load", timeout: 30_000 });
          await page.waitForTimeout(SETTLE_MS);
          const text = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 2000) : ''"));
          if (BOT_WALL.test(text)) throw new Error("a bot wall answered");
          const shot = await page.screenshot({ type: "png" });
          const dominantShare = Number(await page.evaluate(`${DOMINANT_SHARE}("data:image/png;base64,${shot.toString("base64")}")`));
          if (looksBlank({ dominantShare })) throw new Error("only a preloader or an empty page showed");
          const file = referenceFile(target.url);
          await fs.writeFile(file, shot);
          captured.push({ ...target, file });
        } catch (error) {
          log(`Reference ${target.label} was skipped: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}.`);
        } finally {
          await context.close();
        }
      }),
    );
  } finally {
    await browser.close();
  }
  return captured;
}

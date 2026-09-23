import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DesignReviewSchema,
  type DesignReview,
} from "../../shared/design-intelligence-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Where design reviews are kept.
 *
 * In AgentOS's own state, not the vault, and that placement is the argument:
 * an exploratory reading of six images is not project truth. It is worth
 * keeping — you should be able to reload the page, or come back tomorrow, and
 * still have it — but the vault holds what a project has decided, and a
 * review has decided nothing until a person promotes it into a brief.
 *
 * One file per review rather than one index. Reviews are written once and read
 * individually, and a per-file store cannot lose the others to a bad write.
 */

function reviewsDir(): string {
  return path.join(uiStateDir(), "design-reviews");
}

/** Rejects any id this module would not have generated. */
function assertSafeId(id: string): void {
  if (!/^review_[A-Za-z0-9_-]{4,64}$/.test(id)) {
    throw new Error(`Invalid review id: ${id}`);
  }
}

export function createReviewId(): string {
  return `review_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function reviewFile(id: string): string {
  assertSafeId(id);
  return path.join(reviewsDir(), `${id}.json`);
}

/** Writes one review atomically. */
export async function saveReview(review: DesignReview): Promise<void> {
  await fs.mkdir(reviewsDir(), { recursive: true });

  const target = reviewFile(review.id);
  const temporary = `${target}.${process.pid}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

/** Reads one review, or nothing when there is no such review. */
export async function readReview(
  id: string,
): Promise<DesignReview | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(reviewFile(id), "utf8"));
    const result = DesignReviewSchema.safeParse(parsed);

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every review, newest first, optionally for one project.
 *
 * A file that cannot be read is skipped rather than failing the listing: one
 * bad review must not hide the rest.
 */
export async function listReviews(
  project?: string,
  limit = 50,
): Promise<DesignReview[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(reviewsDir());
  } catch {
    return [];
  }

  const reviews = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readReview(entry.replace(/\.json$/, ""))),
  );

  return reviews
    .filter((review): review is DesignReview => review !== undefined)
    .filter((review) => !project || review.project === project)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

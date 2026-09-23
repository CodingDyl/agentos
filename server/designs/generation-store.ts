import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DesignGenerationSchema,
  type DesignGeneration,
} from "../../shared/design-generation-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Where generations are remembered.
 *
 * The images themselves live in the media store and the library, like any
 * other asset. What is kept here is the *request*: the prompt, the references,
 * what came back. Without it a generated image is an orphan — you can look at
 * it and never find out how to get another one like it, which is most of what
 * makes a concept useful.
 *
 * One file per generation, in AgentOS's own state rather than the vault.
 */

function generationsDir(): string {
  return path.join(uiStateDir(), "design-generations");
}

/** Rejects any id this module would not have generated. */
function assertSafeId(id: string): void {
  if (!/^gen_[A-Za-z0-9_-]{4,64}$/.test(id)) {
    throw new Error(`Invalid generation id: ${id}`);
  }
}

export function createGenerationId(): string {
  return `gen_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generationFile(id: string): string {
  assertSafeId(id);
  return path.join(generationsDir(), `${id}.json`);
}

/** Writes one generation atomically. */
export async function saveGeneration(
  generation: DesignGeneration,
): Promise<void> {
  await fs.mkdir(generationsDir(), { recursive: true });

  const target = generationFile(generation.id);
  const temporary = `${target}.${process.pid}.tmp`;

  await fs.writeFile(
    temporary,
    `${JSON.stringify(generation, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporary, target);
}

export async function readGeneration(
  id: string,
): Promise<DesignGeneration | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(generationFile(id), "utf8"),
    );

    const result = DesignGenerationSchema.safeParse(parsed);

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every generation, newest first.
 *
 * A file that cannot be read is skipped rather than failing the listing: one
 * bad record must not take the history down with it.
 */
export async function listGenerations(
  project?: string,
  limit = 50,
): Promise<DesignGeneration[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(generationsDir());
  } catch {
    return [];
  }

  const generations = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readGeneration(entry.replace(/\.json$/, ""))),
  );

  return generations
    .filter((entry): entry is DesignGeneration => entry !== undefined)
    .filter((entry) => !project || entry.request.project === project)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

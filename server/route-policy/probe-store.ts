import fs from "node:fs/promises";
import path from "node:path";
import { ProbeResultSchema, type ProbeRecord, type ProbeResult } from "../../shared/route-policy-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The last suitability test per model.
 *
 * Kept beside the AI Stack settings, keyed by model name. A result records the
 * digest it was run against, so pulling a different build under the same tag
 * marks it stale instead of letting an old verdict vouch for a new model.
 */

const file = () => path.join(uiStateDir(), "ollama-probes.json");

async function readAll(): Promise<Record<string, ProbeResult>> {
  try {
    const raw = JSON.parse(await fs.readFile(file(), "utf8")) as Record<string, unknown>;
    const out: Record<string, ProbeResult> = {};
    for (const [name, value] of Object.entries(raw)) {
      const parsed = ProbeResultSchema.safeParse(value);
      // A record that no longer parses is dropped, not trusted half-way.
      if (parsed.success) out[name] = parsed.data;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveProbe(result: ProbeResult): Promise<void> {
  // "Unavailable" says nothing about the model, so it does not replace a real verdict.
  if (result.verdict === "unavailable") return;

  const all = await readAll();
  all[result.model] = result;

  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = file();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(all, null, 2), "utf8");
  await fs.rename(temporary, target);
}

/** Stored results, each flagged stale when the installed digest has since changed. */
export async function readProbes(installed: Array<{ name: string; digest?: string }>): Promise<Record<string, ProbeRecord>> {
  const digests = new Map(installed.map((model) => [model.name, model.digest]));
  const out: Record<string, ProbeRecord> = {};

  for (const [name, result] of Object.entries(await readAll())) {
    const current = digests.get(name);
    out[name] = { ...result, stale: Boolean(result.digest && current && result.digest !== current) };
  }
  return out;
}

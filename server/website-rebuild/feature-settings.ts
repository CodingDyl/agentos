import {
  FEATURE_SETTINGS,
  FeatureSettingsInputSchema,
  type FeatureSettingKey,
  type FeatureSettingsInput,
  type FeatureSettingsView,
} from "../../shared/feature-settings-types";
import { openSecret, sealSecret, sealingKey, type SealedSecret } from "../agentos/sealed-secrets";
import { readRun, rebuildDatabase, RebuildError } from "./store";

/**
 * A run's feature settings: provider values, sealed secrets and old addresses.
 * Stored on the run row. A secret is only ever opened to hand it to Vercel.
 */

const KEY_FILE = "rebuild-secret.key";

interface Stored {
  values: Partial<Record<FeatureSettingKey, string>>;
  secrets: Partial<Record<FeatureSettingKey, SealedSecret>>;
  legacyUrls: string[];
  updatedAt?: string;
}

const EMPTY: Stored = { values: {}, secrets: {}, legacyUrls: [] };
const SECRET = new Set(FEATURE_SETTINGS.filter((setting) => setting.secret).map((setting) => setting.key));

function readStored(runId: string): Stored {
  const row = rebuildDatabase().prepare("SELECT feature_settings FROM runs WHERE id = ?").get(runId) as { feature_settings: string | null } | undefined;
  if (!row) throw new RebuildError("That rebuild does not exist.", 404);
  if (!row.feature_settings) return { ...EMPTY };
  try {
    const parsed = JSON.parse(row.feature_settings) as Partial<Stored>;
    return { values: parsed.values ?? {}, secrets: parsed.secrets ?? {}, legacyUrls: parsed.legacyUrls ?? [], updatedAt: parsed.updatedAt };
  } catch {
    return { ...EMPTY };
  }
}

function toView(stored: Stored): FeatureSettingsView {
  return {
    values: stored.values,
    secretsSet: Object.fromEntries(Object.keys(stored.secrets).map((key) => [key, true])),
    legacyUrls: stored.legacyUrls,
    updatedAt: stored.updatedAt,
  };
}

export function featureSettingsView(runId: string): FeatureSettingsView {
  return toView(readStored(runId));
}

/** Merges what the person sent: an empty value clears it, a secret left out is kept. */
export async function saveFeatureSettings(runId: string, raw: FeatureSettingsInput, now = new Date()): Promise<FeatureSettingsView> {
  readRun(runId);
  const input = FeatureSettingsInputSchema.parse(raw);
  const stored = readStored(runId);
  const values = { ...stored.values };
  for (const [key, value] of Object.entries(input.values) as [FeatureSettingKey, string | undefined][]) {
    if (value === undefined) continue;
    if (value) values[key] = value;
    else delete values[key];
  }
  const secrets = { ...stored.secrets };
  for (const [key, value] of Object.entries(input.secrets) as [FeatureSettingKey, string | undefined][]) {
    if (value === undefined || !SECRET.has(key)) continue;
    if (value) secrets[key] = sealSecret(value, (await sealingKey(KEY_FILE, true)) as Buffer);
    else delete secrets[key];
  }
  const next: Stored = { values, secrets, legacyUrls: [...new Set(input.legacyUrls)], updatedAt: now.toISOString() };
  rebuildDatabase().prepare("UPDATE runs SET feature_settings = ? WHERE id = ?").run(JSON.stringify(next), runId);
  return toView(next);
}

/** Every setting by name, secrets opened: only for setting the preview's environment. Never log or return it. */
export async function previewEnvironment(runId: string): Promise<Record<string, string>> {
  const stored = readStored(runId);
  const env: Record<string, string> = { ...stored.values } as Record<string, string>;
  const entries = Object.entries(stored.secrets) as [FeatureSettingKey, SealedSecret][];
  if (entries.length === 0) return env;
  const key = await sealingKey(KEY_FILE, false);
  if (!key) throw new RebuildError("The key for this rebuild's secrets is missing. Enter the secret again in What the features need.");
  for (const [name, sealed] of entries) {
    try {
      env[name] = openSecret(sealed, key);
    } catch {
      throw new RebuildError(`${name} could not be unlocked. Enter it again in What the features need.`);
    }
  }
  return env;
}

/** What a worker may be told: which settings exist, the plain values, and the old addresses. Secret values stay out. */
export function briefSettings(runId: string): { set: FeatureSettingKey[]; values: Partial<Record<FeatureSettingKey, string>>; legacyUrls: string[] } {
  const stored = readStored(runId);
  return { set: [...Object.keys(stored.values), ...Object.keys(stored.secrets)] as FeatureSettingKey[], values: stored.values, legacyUrls: stored.legacyUrls };
}

/** What the visitor journeys are checked against. */
export function journeyInput(runId: string): { legacyUrls: string[]; settingsSet: FeatureSettingKey[]; bookingUrl?: string } {
  const { set, values, legacyUrls } = briefSettings(runId);
  return { legacyUrls, settingsSet: set, ...(values.BOOKING_URL ? { bookingUrl: values.BOOKING_URL } : {}) };
}

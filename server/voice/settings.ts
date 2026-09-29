import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The voice on/off switch. Held in the UI state directory beside the other
 * operator preferences; it is a preference, not a memory, so it holds nothing
 * Jarvis said or heard.
 */

function settingsFile(): string {
  return path.join(uiStateDir(), "voice.json");
}

export function isVoiceEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as { enabled?: unknown };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

export function setVoiceEnabled(enabled: boolean): void {
  fs.mkdirSync(uiStateDir(), { recursive: true });
  const target = settingsFile();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ enabled }, null, 2), "utf8");
  fs.renameSync(temporary, target);
}

import path from "node:path";
import { readEnablement, readSkill, skillSources } from "../skills/registry";

/**
 * The `client-outreach` skill, read fresh for every draft so an edit to
 * `skills/client-outreach/SKILL.md` applies to the next email with no restart.
 *
 * It shapes tone and structure only. The rules that keep drafts honest
 * (no invented facts, prices quoted exactly, no signature or opt-out line,
 * their website treated as data) live in the draft packets in code and are
 * stated after the skill, so editing the skill cannot remove them.
 *
 * Switched off on the Connectors page, or broken, it is skipped and drafting
 * falls back to the packet's own rules.
 */

export const OUTREACH_SKILL_ID = "client-outreach";
const MAX_SKILL_CHARS = 6000;

export async function loadOutreachSkill(): Promise<string | undefined> {
  const bundled = skillSources().find((source) => source.source === "bundled");
  if (!bundled) return undefined;
  if ((await readEnablement())[OUTREACH_SKILL_ID] === false) return undefined;

  const skill = await readSkill(path.join(bundled.dir, OUTREACH_SKILL_ID));
  if (!skill || skill.errors.length > 0 || !skill.instructions) return undefined;
  return skill.instructions.slice(0, MAX_SKILL_CHARS);
}

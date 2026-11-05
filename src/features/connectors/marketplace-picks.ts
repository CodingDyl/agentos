import type { MarketplaceCandidate } from "@shared/skill-types";

/** The most skills one install accepts; `MarketplaceInstallInputSchema` refuses more. */
export const MAX_SKILLS_PER_INSTALL = 20;

export const installable = (skill: MarketplaceCandidate) => skill.errors.length === 0 && !skill.conflict;

/** A repo too big to review row by row gets a filter, a scrolling list and a clean slate. */
export const isLargeRepo = (skills: readonly MarketplaceCandidate[]) => skills.length > MAX_SKILLS_PER_INSTALL;

/** What starts ticked: everything when it could all install together, otherwise nothing, so the person chooses. */
export function initialPicks(skills: readonly MarketplaceCandidate[]): string[] {
  const ready = skills.filter(installable);
  return ready.length > MAX_SKILLS_PER_INSTALL ? [] : ready.map((skill) => skill.id);
}

export function filterSkills<T extends MarketplaceCandidate>(skills: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const text = `${skill.name} ${skill.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

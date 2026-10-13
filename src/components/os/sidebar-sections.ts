/**
 * Collapsible sidebar sections: which groups fold, how that preference is
 * stored, and which group the open route belongs to so it can reopen itself.
 */

export const COLLAPSIBLE_SECTIONS = ["business", "work", "memory", "operations"] as const;

export type CollapsibleSection = (typeof COLLAPSIBLE_SECTIONS)[number];

export const SIDEBAR_COLLAPSED_KEY = "agentos.sidebar.collapsed";

export const SECTION_LABELS: Record<CollapsibleSection, string> = {
  business: "Business",
  work: "Work",
  memory: "Memory",
  operations: "Operations",
};

export function isCollapsibleSection(value: string): value is CollapsibleSection {
  return (COLLAPSIBLE_SECTIONS as readonly string[]).includes(value);
}

export function parseCollapsedSections(raw: string | null): Set<CollapsibleSection> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((entry): entry is CollapsibleSection => typeof entry === "string" && isCollapsibleSection(entry)));
  } catch {
    return new Set();
  }
}

export function serializeCollapsedSections(collapsed: Set<CollapsibleSection>): string {
  return JSON.stringify([...collapsed]);
}

export function toggleCollapsedSection(
  collapsed: Set<CollapsibleSection>,
  section: CollapsibleSection,
): Set<CollapsibleSection> {
  const next = new Set(collapsed);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  return next;
}

export interface SectionedLink {
  href: string;
  section?: string;
}

/**
 * The collapsible section a path lives in, if any. Nested workspace URLs
 * inherit their parent's section; `/` never swallows the rest of the tree.
 */
export function sectionForPath(path: string, items: readonly SectionedLink[]): CollapsibleSection | undefined {
  const pathname = path.split(/[?#]/)[0] || "/";
  let best: { href: string; section?: string } | undefined;

  for (const item of items) {
    const href = item.href.split(/[?#]/)[0] || "/";
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) continue;
    if (!best || href.length > (best.href.split(/[?#]/)[0] || "/").length) best = item;
  }

  const section = best?.section;
  return section && isCollapsibleSection(section) ? section : undefined;
}

export function expandActiveSection(
  collapsed: Set<CollapsibleSection>,
  path: string,
  items: readonly SectionedLink[],
): Set<CollapsibleSection> {
  const section = sectionForPath(path, items);
  if (!section || !collapsed.has(section)) return collapsed;
  const next = new Set(collapsed);
  next.delete(section);
  return next;
}

export function readCollapsedSections(): Set<CollapsibleSection> {
  try {
    return parseCollapsedSections(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY));
  } catch {
    return new Set();
  }
}

export function writeCollapsedSections(collapsed: Set<CollapsibleSection>): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, serializeCollapsedSections(collapsed));
  } catch {
    // A preference only — private windows still have to render.
  }
}

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

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * The top bar's trail for a path: group, then destination, then anything open
 * inside it. `/workspaces/pantry-pilot` is `Work / Workspaces / pantry-pilot`.
 * The last entry is the page; earlier ones link back when there is somewhere to
 * go. A path no navigation item claims falls back to its own first segment, so
 * the bar is never blank on a screen reached only from another screen.
 */
export function breadcrumbForPath(
  path: string,
  items: readonly (SectionedLink & { label: string })[],
): BreadcrumbItem[] {
  const pathname = path.split(/[?#]/)[0] || "/";
  let best: (SectionedLink & { label: string }) | undefined;

  for (const item of items) {
    const href = item.href.split(/[?#]/)[0] || "/";
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (!best || href.length > best.href.length)) best = item;
  }

  const humanize = (segment: string) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A malformed segment is shown as it arrived.
    }
    return decoded;
  };
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, " ");

  if (!best) {
    const [first, ...rest] = pathname.split("/").filter(Boolean);
    if (!first) return [{ label: "Dashboard" }];
    return [{ label: capitalize(first), href: `/${first}` }, ...rest.map((segment) => ({ label: humanize(segment) }))];
  }

  const trail: BreadcrumbItem[] = [];
  if (best.section && isCollapsibleSection(best.section) && SECTION_LABELS[best.section] !== best.label) {
    trail.push({ label: SECTION_LABELS[best.section] });
  }
  trail.push({ label: best.label, href: best.href });
  const inside = pathname.slice(best.href.length).split("/").filter(Boolean);
  for (const segment of inside) trail.push({ label: humanize(segment) });
  return trail;
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

import type { PageNote, RebuildArtifact } from "@shared/website-rebuild-types";

/** One page of the baseline: its full-page snapshot at each width. */
export interface PageShots {
  route: string;
  desktop?: RebuildArtifact;
  mobile?: RebuildArtifact;
}

/** A page compared with the revision before. `before` is missing for a page that is new. */
export interface PageChange {
  route: string;
  before?: PageShots;
  after: PageShots;
  changed: boolean;
}

const TITLE = /^(\/\S*) \((desktop|mobile)\)$/;

/** Groups a revision's baseline snapshots by the route in their title, the home page first. */
export function pagesOf(images: readonly RebuildArtifact[]): PageShots[] {
  const pages = new Map<string, PageShots>();
  for (const image of images) {
    const match = TITLE.exec(image.title);
    if (!match) continue;
    const [, route, viewport] = match;
    const page = pages.get(route) ?? { route };
    page[viewport as "desktop" | "mobile"] = image;
    pages.set(route, page);
  }
  return [...pages.values()].sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : 0));
}

/** The review can only be approved on a baseline with every page photographed at both widths. */
export function snapshotsComplete(pages: readonly PageShots[]): boolean {
  return pages.length > 0 && pages.every((page) => page.desktop && page.mobile);
}

/** `/` is "Home"; `/services/electrical` is shown as written. */
export function routeLabel(route: string): string {
  return route === "/" ? "Home" : route;
}

/**
 * Each page of `revision` against the same page one revision earlier. A page is
 * changed when a snapshot's bytes differ, or when it did not exist before.
 * Snapshots with no digest (made before digests were kept) are never called changed.
 */
export function comparePages(images: readonly RebuildArtifact[], revision: number): PageChange[] {
  if (revision < 2) return [];
  const after = pagesOf(images.filter((image) => image.revision === revision));
  const before = pagesOf(images.filter((image) => image.revision === revision - 1));
  return after.map((page) => {
    const earlier = before.find((entry) => entry.route === page.route);
    const differs = (viewport: "desktop" | "mobile") => {
      const now = page[viewport]?.digest;
      const then = earlier?.[viewport]?.digest;
      return Boolean(now && then && now !== then);
    };
    return { route: page.route, before: earlier, after: page, changed: !earlier || differs("desktop") || differs("mobile") };
  });
}

/** Where a click landed on an image, as a percent of its width and height, to one decimal place. */
export function pinFromPoint(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  const percent = (offset: number, size: number) => (size > 0 ? Math.min(100, Math.max(0, Math.round((offset / size) * 1000) / 10)) : 0);
  return { x: percent(clientX - box.left, box.width), y: percent(clientY - box.top, box.height) };
}

let counter = 0;
/** An id for a new note, unique within a review. */
export function newNoteId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Notes that say something, with their page, for counting and sending. */
export function writtenNotes(notes: Record<string, PageNote[]>): Record<string, PageNote[]> {
  return Object.fromEntries(
    Object.entries(notes).flatMap(([route, list]) => {
      const written = list.filter((note) => note.text.trim()).map((note) => ({ ...note, text: note.text.trim() }));
      return written.length > 0 ? [[route, written]] : [];
    }),
  );
}

export function noteTotal(notes: Record<string, PageNote[]>): number {
  return Object.values(notes).reduce((sum, list) => sum + list.length, 0);
}

import type { StructureConnection, StructureSubsystem } from "@shared/structure-types";

/**
 * Validated with the dataviz palette checker against the canvas (#111315): the
 * four largest folders get a hue, in this fixed order, and everything else folds
 * into a neutral. The mint accent stays reserved for selection and actions.
 */
const AREA_HUES = ["#3987e5", "#d95926", "#9085e9", "#199e70"] as const;
export const OTHER_AREA_COLOR = "#65717D";

export interface AreaLegendEntry {
  area: string;
  color: string;
}

/** Colour follows the folder, so filtering the map never repaints what is left. */
export function areaPalette(subsystems: readonly StructureSubsystem[]): { colorOf: (area: string) => string; legend: AreaLegendEntry[] } {
  const totals = new Map<string, number>();
  for (const subsystem of subsystems) {
    if (subsystem.onMap) totals.set(subsystem.area, (totals.get(subsystem.area) ?? 0) + subsystem.size);
  }

  const ranked = [...totals].sort(([areaA, a], [areaB, b]) => b - a || areaA.localeCompare(areaB)).map(([area]) => area);
  const colors = new Map(ranked.slice(0, AREA_HUES.length).map((area, index) => [area, AREA_HUES[index]]));

  const legend: AreaLegendEntry[] = [...colors].map(([area, color]) => ({ area, color }));
  if (ranked.length > AREA_HUES.length) legend.push({ area: "Other", color: OTHER_AREA_COLOR });

  return { colorOf: (area) => colors.get(area) ?? OTHER_AREA_COLOR, legend };
}

const RELATION_WORDS: Record<string, { out: string; in: string }> = {
  calls: { out: "Calls", in: "Called by" },
  indirect_call: { out: "Calls indirectly", in: "Called indirectly by" },
  imports: { out: "Imports", in: "Imported by" },
  imports_from: { out: "Imports from", in: "Provides imports to" },
  dynamic_import: { out: "Loads on demand", in: "Loaded on demand by" },
  re_exports: { out: "Re-exports", in: "Re-exported by" },
  references: { out: "References", in: "Referenced by" },
  cites: { out: "Cites", in: "Cited by" },
  inherits: { out: "Inherits from", in: "Inherited by" },
  extends: { out: "Extends", in: "Extended by" },
  implements: { out: "Implements", in: "Implemented by" },
  rationale_for: { out: "Explains", in: "Explained by" },
  contains: { out: "Contains", in: "Inside" },
  method: { out: "Has method", in: "Method of" },
  declares: { out: "Declares", in: "Declared by" },
};

/** A relation in plain words, in the direction it is being read. */
export function relationLabel(relation: string, direction: "out" | "in"): string {
  const known = RELATION_WORDS[relation];
  if (known) return known[direction];
  const words = relation.replace(/[_-]+/g, " ").trim() || "Related";
  const sentence = `${words[0].toUpperCase()}${words.slice(1)}`;
  return direction === "out" ? sentence : `${sentence} (from)`;
}

export interface ConnectionGroup {
  key: string;
  label: string;
  connections: StructureConnection[];
}

/** Groups a component's connections by what they mean, keeping the server's order. */
export function groupConnections(connections: readonly StructureConnection[]): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>();
  for (const connection of connections) {
    const key = `${connection.relation}:${connection.direction}`;
    const group = groups.get(key);
    if (group) group.connections.push(connection);
    else groups.set(key, { key, label: relationLabel(connection.relation, connection.direction), connections: [connection] });
  }
  return [...groups.values()];
}

/** `src/features/mail/mail-page.tsx` and `L12` read as one place. */
export function placeOf(file: string | undefined, location: string | undefined): string | undefined {
  if (!file) return undefined;
  return location ? `${file}:${location.replace(/^L/, "")}` : file;
}

/** Radius on the canvas: area tracks the value, within limits a pointer can hit. */
export function radiusFor(value: number, largest: number): number {
  const MIN = 3.5;
  const MAX = 18;
  if (largest <= 0 || value <= 0) return MIN;
  return MIN + (MAX - MIN) * Math.sqrt(Math.min(value, largest) / largest);
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}

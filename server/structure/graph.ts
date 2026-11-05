import path from "node:path";
import { z } from "zod";
import type {
  StructureConnection,
  StructureGraph,
  StructureMemberLink,
  StructureNodeDetail,
  StructureNodeSummary,
  StructureSubsystem,
  StructureSubsystemDetail,
  StructureSubsystemKind,
  StructureSubsystemLink,
} from "../../shared/structure-types";

/**
 * Turns Graphify's `graph.json` into something a person can read.
 *
 * The file is project content, so every item is parsed rather than trusted, and
 * one malformed row costs that row, not the whole graph. Pure: the disk and the
 * Graphify command live in `store.ts` and `rebuild.ts`.
 */

export const SUPPORTED_SCHEMA_VERSION = 1;

const MAP_SUBSYSTEMS = 60;
const MAP_MIN_SIZE = 3;
const MAP_LINKS = 400;
const HUBS = 12;
const MEMBERS = 120;
const MEMBER_LINKS = 600;
const SUBSYSTEM_CONNECTIONS = 12;
const SUBSYSTEM_FILES = 12;
const NODE_CONNECTIONS = 200;
const SEARCH_RESULTS = 20;

/** Where a thing lives, rather than how it interacts. Kept out of the map and of degree. */
const STRUCTURAL = new Set(["contains", "method", "declares"]);
const CONFIG_FILE = /\.(json|ya?ml|toml|lock|ini)$/i;

const RawNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullish(),
  community: z.number().int().nullish(),
  community_name: z.string().nullish(),
  file_type: z.string().nullish(),
  source_file: z.string().nullish(),
  source_location: z.string().nullish(),
  type: z.string().nullish(),
  external: z.unknown().optional(),
});

const RawLinkSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.string().nullish(),
  confidence: z.string().nullish(),
  source_file: z.string().nullish(),
  source_location: z.string().nullish(),
});

const RawGraphSchema = z.object({
  graph: z.object({ schema_version: z.number().int().optional(), graphify_version: z.string().optional() }).optional(),
  nodes: z.array(z.unknown()),
  links: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  built_at_commit: z.string().nullish(),
});

export type ParsedGraph =
  | { ok: true; index: StructureIndex }
  | { ok: false; reason: "unsupported" | "unreadable"; problem: string };

interface Node {
  id: string;
  label: string;
  subsystem: number;
  file?: string;
  location?: string;
  fileType: string;
  external: boolean;
  degree: number;
}

interface Link {
  source: string;
  target: string;
  relation: string;
  inferred: boolean;
  file?: string;
  location?: string;
}

/** The folder a file sits in, at most three levels deep: `src/features/mail`. */
function folderOf(file: string | undefined): string | undefined {
  if (!file || !file.includes("/")) return undefined;
  const parts = path.posix.dirname(file).split("/").filter(Boolean);
  // `@tauri-apps/api` and `node:http` name packages, not folders in the project.
  if (parts.length === 0 || parts[0].startsWith("@") || parts[0].includes(":")) return undefined;
  return parts.slice(0, 3).join("/");
}

function mostCommon(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function tally(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/**
 * Graphify names a community after its hub. A hub that is only a reference or
 * an outside package (`react`) says nothing about this project's code, so fall
 * back to where the subsystem lives.
 */
function subsystemName(raw: string | undefined, folder: string, id: number, members: readonly Node[]): string {
  const name = raw?.trim();
  const namedAfterPackage = members.some((member) => member.label === name && (member.external || member.id.startsWith("ref_")));
  if (name && !namedAfterPackage && !name.startsWith("ref_") && !/^Community \d+$/.test(name)) return name;
  return folder === "(project root)" ? `Subsystem ${id}` : folder;
}

function kindOf(members: readonly Node[]): StructureSubsystemKind {
  let docs = 0;
  let config = 0;
  for (const member of members) {
    if (member.fileType !== "code") docs += 1;
    else if (member.file && CONFIG_FILE.test(member.file)) config += 1;
  }
  const half = members.length / 2;
  if (docs > half) return "docs";
  if (config > half) return "config";
  return "code";
}

export class StructureIndex {
  readonly schemaVersion: number;
  readonly graphifyVersion?: string;
  readonly builtAtCommit?: string;
  readonly inferredLinks: number;
  readonly linkCount: number;
  readonly fileCount: number;

  private readonly nodes = new Map<string, Node>();
  private readonly outgoing = new Map<string, Link[]>();
  private readonly incoming = new Map<string, Link[]>();
  private readonly members = new Map<number, Node[]>();
  private readonly subsystems = new Map<number, StructureSubsystem>();
  private readonly subsystemLinks: StructureSubsystemLink[];
  private readonly cross = new Map<number, Map<number, { outgoing: number; incoming: number }>>();

  constructor(input: {
    schemaVersion: number;
    graphifyVersion?: string;
    builtAtCommit?: string;
    nodes: readonly z.infer<typeof RawNodeSchema>[];
    links: readonly z.infer<typeof RawLinkSchema>[];
  }) {
    this.schemaVersion = input.schemaVersion;
    this.graphifyVersion = input.graphifyVersion;
    this.builtAtCommit = input.builtAtCommit;

    const names = new Map<number, string>();
    for (const raw of input.nodes) {
      // A node Graphify did not cluster still has to belong somewhere.
      const subsystem = raw.community ?? -1;
      const node: Node = {
        id: raw.id,
        label: raw.label?.trim() || raw.id,
        subsystem,
        file: raw.source_file?.trim() || undefined,
        location: raw.source_location?.trim() || undefined,
        fileType: raw.file_type ?? "code",
        external: raw.type === "external" || Boolean(raw.external),
        degree: 0,
      };
      this.nodes.set(node.id, node);
      if (raw.community_name && !names.has(subsystem)) names.set(subsystem, raw.community_name);
      const group = this.members.get(subsystem);
      if (group) group.push(node);
      else this.members.set(subsystem, [node]);
    }

    let inferred = 0;
    let linkCount = 0;
    const between = new Map<string, { source: number; target: number; weight: number; relations: Map<string, number> }>();
    const crossBySubsystem = new Map<number, number>();

    for (const raw of input.links) {
      const source = this.nodes.get(raw.source);
      const target = this.nodes.get(raw.target);
      if (!source || !target) continue;

      const link: Link = {
        source: raw.source,
        target: raw.target,
        relation: raw.relation?.trim() || "related",
        inferred: raw.confidence !== "EXTRACTED",
        file: raw.source_file?.trim() || undefined,
        location: raw.source_location?.trim() || undefined,
      };
      linkCount += 1;
      if (link.inferred) inferred += 1;
      this.push(this.outgoing, link.source, link);
      this.push(this.incoming, link.target, link);

      if (STRUCTURAL.has(link.relation)) continue;
      source.degree += 1;
      target.degree += 1;
      if (source.subsystem === target.subsystem) continue;

      crossBySubsystem.set(source.subsystem, (crossBySubsystem.get(source.subsystem) ?? 0) + 1);
      crossBySubsystem.set(target.subsystem, (crossBySubsystem.get(target.subsystem) ?? 0) + 1);
      this.bumpCross(source.subsystem, target.subsystem, "outgoing");
      this.bumpCross(target.subsystem, source.subsystem, "incoming");

      const [low, high] = source.subsystem < target.subsystem ? [source.subsystem, target.subsystem] : [target.subsystem, source.subsystem];
      const key = `${low}:${high}`;
      const entry = between.get(key) ?? { source: low, target: high, weight: 0, relations: new Map<string, number>() };
      entry.weight += 1;
      tally(entry.relations, link.relation);
      between.set(key, entry);
    }

    this.inferredLinks = inferred;
    this.linkCount = linkCount;
    this.fileCount = new Set([...this.nodes.values()].flatMap((node) => (node.file && !node.external ? [node.file] : []))).size;

    const drafts = [...this.members].map(([id, members]) => {
      const folders = new Map<string, number>();
      const files = new Set<string>();
      for (const member of members) {
        if (member.file) files.add(member.file);
        const folder = folderOf(member.file);
        if (folder) tally(folders, folder);
      }
      const folder = mostCommon(folders) ?? "(project root)";
      return {
        id,
        name: subsystemName(names.get(id), folder, id, members),
        folder,
        area: folder === "(project root)" ? folder : folder.split("/")[0],
        kind: kindOf(members),
        size: members.length,
        fileCount: files.size,
        crossLinks: crossBySubsystem.get(id) ?? 0,
      };
    });

    const onMap = new Set(
      drafts
        .filter((draft) => draft.kind === "code" && draft.size >= MAP_MIN_SIZE)
        .sort((a, b) => b.size - a.size || a.id - b.id)
        .slice(0, MAP_SUBSYSTEMS)
        .map((draft) => draft.id),
    );
    for (const draft of drafts) this.subsystems.set(draft.id, { ...draft, onMap: onMap.has(draft.id) });

    this.subsystemLinks = [...between.values()]
      .filter((entry) => onMap.has(entry.source) && onMap.has(entry.target))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAP_LINKS)
      .map((entry) => ({
        source: entry.source,
        target: entry.target,
        weight: entry.weight,
        relation: mostCommon(entry.relations) ?? "related",
      }));
  }

  private push(map: Map<string, Link[]>, key: string, link: Link): void {
    const list = map.get(key);
    if (list) list.push(link);
    else map.set(key, [link]);
  }

  private bumpCross(from: number, to: number, side: "outgoing" | "incoming"): void {
    let row = this.cross.get(from);
    if (!row) {
      row = new Map();
      this.cross.set(from, row);
    }
    const entry = row.get(to) ?? { outgoing: 0, incoming: 0 };
    entry[side] += 1;
    row.set(to, entry);
  }

  private summary(node: Node): StructureNodeSummary {
    return {
      id: node.id,
      label: node.label,
      subsystem: node.subsystem,
      file: node.file,
      location: node.location,
      degree: node.degree,
      external: node.external,
    };
  }

  /** The whole-project view: what the map and the list draw. */
  overview(context: { builtAt: string; headCommit?: string }): StructureGraph {
    const subsystems = [...this.subsystems.values()].sort((a, b) => b.size - a.size || a.id - b.id);
    const hubs = [...this.nodes.values()]
      .filter((node) => !node.external && node.fileType === "code" && node.degree > 0)
      .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
      .slice(0, HUBS)
      .map((node) => this.summary(node));

    return {
      schemaVersion: this.schemaVersion,
      graphifyVersion: this.graphifyVersion,
      builtAt: context.builtAt,
      builtAtCommit: this.builtAtCommit,
      headCommit: context.headCommit,
      stale: Boolean(this.builtAtCommit && context.headCommit && this.builtAtCommit !== context.headCommit),
      counts: {
        components: this.nodes.size,
        links: this.linkCount,
        inferredLinks: this.inferredLinks,
        subsystems: subsystems.length,
        files: this.fileCount,
      },
      subsystems,
      links: this.subsystemLinks,
      hubs,
    };
  }

  subsystem(id: number): StructureSubsystemDetail | undefined {
    const subsystem = this.subsystems.get(id);
    if (!subsystem) return undefined;

    const all = this.members.get(id) ?? [];
    const members = [...all].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)).slice(0, MEMBERS);
    const shown = new Set(members.map((member) => member.id));

    const links: StructureMemberLink[] = [];
    for (const member of members) {
      for (const link of this.outgoing.get(member.id) ?? []) {
        if (!shown.has(link.target)) continue;
        links.push({ source: link.source, target: link.target, relation: link.relation, inferred: link.inferred });
      }
    }
    // Interactions outrank containment when a dense subsystem has to lose some.
    links.sort((a, b) => Number(STRUCTURAL.has(a.relation)) - Number(STRUCTURAL.has(b.relation)));

    const files = new Map<string, number>();
    for (const member of all) if (member.file && !member.external) tally(files, member.file);

    const connections = [...(this.cross.get(id) ?? new Map<number, { outgoing: number; incoming: number }>())]
      .sort(([, a], [, b]) => b.outgoing + b.incoming - (a.outgoing + a.incoming))
      .slice(0, SUBSYSTEM_CONNECTIONS)
      .flatMap(([other, counts]) => {
        const entry = this.subsystems.get(other);
        return entry ? [{ subsystem: entry, ...counts }] : [];
      });

    return {
      subsystem,
      members: members.map((member) => this.summary(member)),
      links: links.slice(0, MEMBER_LINKS),
      connections,
      files: [...files]
        .sort(([pathA, a], [pathB, b]) => b - a || pathA.localeCompare(pathB))
        .slice(0, SUBSYSTEM_FILES)
        .map(([file, count]) => ({ path: file, members: count })),
    };
  }

  node(id: string): StructureNodeDetail | undefined {
    const node = this.nodes.get(id);
    const subsystem = node && this.subsystems.get(node.subsystem);
    if (!node || !subsystem) return undefined;

    const connections: StructureConnection[] = [];
    const add = (links: readonly Link[], direction: "out" | "in") => {
      for (const link of links) {
        const other = this.nodes.get(direction === "out" ? link.target : link.source);
        if (!other) continue;
        connections.push({
          relation: link.relation,
          direction,
          inferred: link.inferred,
          other: this.summary(other),
          file: link.file,
          location: link.location,
        });
      }
    };
    add(this.outgoing.get(id) ?? [], "out");
    add(this.incoming.get(id) ?? [], "in");

    connections.sort(
      (a, b) =>
        Number(STRUCTURAL.has(a.relation)) - Number(STRUCTURAL.has(b.relation)) ||
        a.relation.localeCompare(b.relation) ||
        b.other.degree - a.other.degree,
    );

    return {
      node: this.summary(node),
      subsystem,
      connections: connections.slice(0, NODE_CONNECTIONS),
      totalConnections: connections.length,
    };
  }

  search(query: string): StructureNodeSummary[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const rank = (node: Node): number => {
      const label = node.label.toLowerCase();
      if (label === needle || label === `${needle}()`) return 0;
      if (label.startsWith(needle)) return 1;
      if (label.includes(needle)) return 2;
      if (node.file?.toLowerCase().includes(needle)) return 3;
      return -1;
    };

    return [...this.nodes.values()]
      .map((node) => ({ node, score: rank(node) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || b.node.degree - a.node.degree || a.node.label.localeCompare(b.node.label))
      .slice(0, SEARCH_RESULTS)
      .map((entry) => this.summary(entry.node));
  }
}

/** Parse the text of a `graph.json`. Never throws: a bad file is a state the tab can explain. */
export function parseGraph(text: string): ParsedGraph {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable", problem: "graph.json is not valid JSON. Rebuilding replaces it." };
  }

  const top = RawGraphSchema.safeParse(json);
  if (!top.success) {
    return { ok: false, reason: "unreadable", problem: "graph.json does not have the shape Graphify writes." };
  }

  const version = top.data.graph?.schema_version;
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "unsupported",
      problem: `This graph uses format ${version ?? "unknown"}, and this tab reads format ${SUPPORTED_SCHEMA_VERSION}. AgentOS needs updating to read it.`,
    };
  }

  const nodes = top.data.nodes.flatMap((row) => {
    const parsed = RawNodeSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const links = (top.data.links ?? top.data.edges ?? []).flatMap((row) => {
    const parsed = RawLinkSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });

  return {
    ok: true,
    index: new StructureIndex({
      schemaVersion: version,
      graphifyVersion: top.data.graph?.graphify_version,
      builtAtCommit: top.data.built_at_commit ?? undefined,
      nodes,
      links,
    }),
  };
}

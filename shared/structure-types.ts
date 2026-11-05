import { z } from "zod";

/**
 * A workspace's Structure tab: the project's components and how they interact,
 * read from the `graphify-out/graph.json` Graphify writes into the repository.
 *
 * A real project is tens of thousands of nodes, so the browser never receives
 * the graph itself. It gets subsystems (Graphify's communities) and the links
 * between them, then asks for one subsystem or one component at a time.
 */

export const StructureSubsystemKindSchema = z.enum(["code", "docs", "config"]);
export type StructureSubsystemKind = z.infer<typeof StructureSubsystemKindSchema>;

export const StructureSubsystemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** The folder most of its members live in, e.g. `server/workers`. */
  folder: z.string(),
  /** The top-level folder, which is what the map colours by. */
  area: z.string(),
  kind: StructureSubsystemKindSchema,
  size: z.number().int(),
  fileCount: z.number().int(),
  /** Calls, imports and similar links crossing into other subsystems. */
  crossLinks: z.number().int(),
  /** Whether it is drawn on the map. The rest stay reachable from the list. */
  onMap: z.boolean(),
});
export type StructureSubsystem = z.infer<typeof StructureSubsystemSchema>;

export const StructureSubsystemLinkSchema = z.object({
  source: z.number().int(),
  target: z.number().int(),
  weight: z.number().int(),
  /** The most common kind of link between the two, e.g. `calls`. */
  relation: z.string(),
});
export type StructureSubsystemLink = z.infer<typeof StructureSubsystemLinkSchema>;

export const StructureNodeSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  subsystem: z.number().int(),
  file: z.string().optional(),
  location: z.string().optional(),
  /** Calls, imports and similar links; containment does not count. */
  degree: z.number().int(),
  external: z.boolean(),
});
export type StructureNodeSummary = z.infer<typeof StructureNodeSummarySchema>;

export const StructureGraphSchema = z.object({
  schemaVersion: z.number().int(),
  graphifyVersion: z.string().optional(),
  builtAt: z.string(),
  builtAtCommit: z.string().optional(),
  headCommit: z.string().optional(),
  /** The repository has moved on since this graph was built. */
  stale: z.boolean(),
  counts: z.object({
    components: z.number().int(),
    links: z.number().int(),
    inferredLinks: z.number().int(),
    subsystems: z.number().int(),
    files: z.number().int(),
  }),
  subsystems: z.array(StructureSubsystemSchema),
  links: z.array(StructureSubsystemLinkSchema),
  hubs: z.array(StructureNodeSummarySchema),
});
export type StructureGraph = z.infer<typeof StructureGraphSchema>;

export const StructureRebuildSchema = z.object({
  status: z.enum(["idle", "running", "failed"]),
  startedAt: z.string().optional(),
  error: z.string().optional(),
  /** Graphify would not replace a graph with a smaller one. It can be told to. */
  canForce: z.boolean().optional(),
});
export type StructureRebuild = z.infer<typeof StructureRebuildSchema>;

export const StructureStateSchema = z.object({
  /**
   * `no-repository` and `missing-folder`: nothing to map.
   * `empty`: the repository has not been mapped yet.
   * `unsupported`: a Graphify version wrote a format this tab does not read.
   * `unreadable`: the file exists but cannot be used.
   */
  status: z.enum(["no-repository", "missing-folder", "empty", "unsupported", "unreadable", "ready"]),
  folder: z.string().optional(),
  problem: z.string().optional(),
  /** False when the `graphify` command cannot be found on this machine. */
  cliInstalled: z.boolean(),
  rebuild: StructureRebuildSchema,
  graph: StructureGraphSchema.optional(),
});
export type StructureState = z.infer<typeof StructureStateSchema>;

export const StructureMemberLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.string(),
  inferred: z.boolean(),
});
export type StructureMemberLink = z.infer<typeof StructureMemberLinkSchema>;

export const StructureSubsystemDetailSchema = z.object({
  subsystem: StructureSubsystemSchema,
  /** The most connected members, capped so the canvas stays readable. */
  members: z.array(StructureNodeSummarySchema),
  links: z.array(StructureMemberLinkSchema),
  connections: z.array(
    z.object({
      subsystem: StructureSubsystemSchema,
      outgoing: z.number().int(),
      incoming: z.number().int(),
    }),
  ),
  files: z.array(z.object({ path: z.string(), members: z.number().int() })),
});
export type StructureSubsystemDetail = z.infer<typeof StructureSubsystemDetailSchema>;

export const StructureConnectionSchema = z.object({
  relation: z.string(),
  direction: z.enum(["out", "in"]),
  /** Read straight from the source (`false`), or resolved by Graphify (`true`). */
  inferred: z.boolean(),
  other: StructureNodeSummarySchema,
  file: z.string().optional(),
  location: z.string().optional(),
});
export type StructureConnection = z.infer<typeof StructureConnectionSchema>;

export const StructureNodeDetailSchema = z.object({
  node: StructureNodeSummarySchema,
  subsystem: StructureSubsystemSchema,
  connections: z.array(StructureConnectionSchema),
  /** The real count, which may be more than the connections returned. */
  totalConnections: z.number().int(),
});
export type StructureNodeDetail = z.infer<typeof StructureNodeDetailSchema>;

export const StructureSearchResultsSchema = z.object({ results: z.array(StructureNodeSummarySchema) });
export type StructureSearchResults = z.infer<typeof StructureSearchResultsSchema>;

export const StructureRebuildBodySchema = z.object({ force: z.boolean().optional() }).strict();
export const StructureSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(120) });

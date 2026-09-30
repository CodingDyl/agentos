import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MemoryBacklink,
  MemoryDiagnostics,
  MemoryFacets,
  MemoryGraph,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryLink,
  MemoryNoteDetail,
  MemoryNoteSummary,
  MemoryNotesPage,
} from "../../shared/memory-types";
import { containedRealPath, isExcluded } from "./config";
import { parseNote, type ParsedNote } from "./parser";
import { buildLookup, resolveLink } from "./resolve";

/**
 * The memory index: every note in the vault, its links resolved, and the
 * backlinks and edges that follow from them.
 *
 * Derived, and disposable. The Markdown is the source of truth; this is
 * rebuilt from it, re-reading only files whose size or modified time changed
 * (or that a watcher named), and it is cached outside the vault so a restart —
 * or an unplugged drive — still has something to show, labelled stale.
 */

/** Notes bigger than this are listed as skipped rather than parsed. */
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
/** Note text served to the browser. */
export const MAX_NOTE_CHARS = 256 * 1024;
/** The graph is never sent with more nodes than this; the response says so. */
export const GRAPH_NODE_CAP = 5_000;

export interface NoteRecord {
  id: string;
  mtimeMs: number;
  size: number;
  hash: string;
  parsed: ParsedNote;
}

interface ScannedFile {
  relative: string;
  kind: "note" | "attachment";
  mtimeMs: number;
  size: number;
}

interface CacheFile {
  root: string;
  savedAt: string;
  lastIndexedAt?: string;
  notes: NoteRecord[];
  attachments: string[];
}

const toPosix = (value: string) => value.split(path.sep).join("/");

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class MemoryIndex {
  notes = new Map<string, NoteRecord>();
  attachments = new Set<string>();
  skipped: Array<{ path: string; reason: string }> = [];
  links = new Map<string, MemoryLink[]>();
  backlinks = new Map<string, Map<string, MemoryBacklink>>();
  edges: MemoryGraphEdge[] = [];
  lastIndexedAt?: string;

  constructor(readonly root: string) {}

  /** Walks the vault. Symlinks are followed only when they stay inside it. */
  private async scan(): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];

    const walk = async (relativeDir: string) => {
      const absolute = path.join(this.root, relativeDir);
      const entries = await fs.readdir(absolute, { withFileTypes: true });

      for (const entry of entries) {
        const relative = toPosix(path.join(relativeDir, entry.name));
        if (isExcluded(relative)) continue;

        if (entry.isSymbolicLink()) {
          const real = await containedRealPath(this.root, relative).catch(() => undefined);
          if (!real) {
            skipped.push({ path: relative, reason: "Symlink points outside the vault." });
            continue;
          }
          const stats = await fs.stat(real);
          if (stats.isDirectory()) {
            skipped.push({ path: relative, reason: "Symlinked folders are not followed." });
            continue;
          }
          files.push(describe(relative, stats));
          continue;
        }

        if (entry.isDirectory()) {
          await walk(relative);
        } else if (entry.isFile()) {
          files.push(describe(relative, await fs.stat(path.join(this.root, relative))));
        }
      }
    };

    const describe = (relative: string, stats: { mtimeMs: number; size: number }): ScannedFile => ({
      relative,
      kind: /\.md$/i.test(relative) ? "note" : "attachment",
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });

    await walk("");
    this.skipped = skipped;
    return files;
  }

  /**
   * Brings the index up to date with the vault.
   *
   * `touched` names files a watcher reported, which are re-read even when
   * their size and time look unchanged (a same-size save within the file
   * system's timestamp resolution). Returns whether anything changed.
   */
  async refresh(touched: ReadonlySet<string> = new Set()): Promise<boolean> {
    const scanned = await this.scan();
    let changed = false;

    const present = new Set<string>();
    const attachments = new Set<string>();

    for (const file of scanned) {
      if (file.kind === "attachment") {
        attachments.add(file.relative);
        continue;
      }

      present.add(file.relative);
      const existing = this.notes.get(file.relative);
      const unchanged =
        existing &&
        existing.mtimeMs === file.mtimeMs &&
        existing.size === file.size &&
        !touched.has(file.relative);
      if (unchanged) continue;

      if (file.size > MAX_NOTE_BYTES) {
        this.skipped.push({ path: file.relative, reason: "Larger than 2 MB; not indexed." });
        if (this.notes.delete(file.relative)) changed = true;
        present.delete(file.relative);
        continue;
      }

      const real = await containedRealPath(this.root, file.relative).catch(() => undefined);
      if (!real) continue;

      let source: string;
      try {
        source = await fs.readFile(real, "utf8");
      } catch {
        // Deleted between the walk and the read; the next pass reconciles it.
        present.delete(file.relative);
        continue;
      }

      const hash = sha256(source);
      if (existing && existing.hash === hash) {
        existing.mtimeMs = file.mtimeMs;
        existing.size = file.size;
        continue;
      }

      this.notes.set(file.relative, {
        id: file.relative,
        mtimeMs: file.mtimeMs,
        size: file.size,
        hash,
        parsed: parseNote(file.relative, source),
      });
      changed = true;
    }

    for (const id of [...this.notes.keys()]) {
      if (!present.has(id)) {
        this.notes.delete(id);
        changed = true;
      }
    }

    if (attachments.size !== this.attachments.size || [...attachments].some((file) => !this.attachments.has(file))) {
      changed = true;
    }
    this.attachments = attachments;

    if (changed || this.links.size !== this.notes.size) this.relink();
    this.lastIndexedAt = new Date().toISOString();
    return changed;
  }

  /** Resolves every link and rebuilds backlinks and edges. Linear in links. */
  relink() {
    const lookup = buildLookup(
      [...this.notes.values()].map((note) => ({ id: note.id, aliases: note.parsed.aliases })),
      this.attachments,
    );

    this.links = new Map();
    this.backlinks = new Map();
    const edges = new Map<string, MemoryGraphEdge>();

    for (const note of this.notes.values()) {
      const resolved = note.parsed.links.map((link) => resolveLink(link, note.id, lookup));
      this.links.set(note.id, resolved);

      for (const link of resolved) {
        let target: string | undefined;
        let unresolved = false;

        if (link.resolution === "resolved" && link.targetId && link.targetId !== note.id) {
          target = link.targetId;
          const incoming = this.backlinks.get(target) ?? new Map<string, MemoryBacklink>();
          const entry = incoming.get(note.id) ?? {
            sourceId: note.id,
            sourceTitle: note.parsed.title,
            count: 0,
            raws: [],
          };
          entry.count += 1;
          if (!entry.raws.includes(link.raw)) entry.raws.push(link.raw);
          incoming.set(note.id, entry);
          this.backlinks.set(target, incoming);
        } else if (link.resolution === "unresolved" && link.target) {
          target = `unresolved:${link.target.replace(/\.md$/i, "").toLowerCase()}`;
          unresolved = true;
        }

        if (!target) continue;

        const key = `${note.id}\u0000${target}`;
        const edge = edges.get(key) ?? { source: note.id, target, count: 0, targets: [], unresolved: unresolved || undefined };
        edge.count += 1;
        if (!edge.targets.includes(link.target)) edge.targets.push(link.target);
        edges.set(key, edge);
      }
    }

    this.edges = [...edges.values()];
  }

  summary(note: NoteRecord): MemoryNoteSummary {
    const resolvedOut = new Set(
      (this.links.get(note.id) ?? [])
        .filter((link) => link.resolution === "resolved" && link.targetId !== note.id)
        .map((link) => link.targetId),
    );

    return {
      id: note.id,
      title: note.parsed.title,
      folder: path.posix.dirname(note.id) === "." ? "" : path.posix.dirname(note.id),
      tags: note.parsed.tags,
      aliases: note.parsed.aliases,
      modifiedAt: new Date(note.mtimeMs).toISOString(),
      size: note.size,
      outgoingCount: resolvedOut.size,
      backlinkCount: this.backlinks.get(note.id)?.size ?? 0,
      hasErrors: note.parsed.errors.length > 0,
    };
  }

  counts() {
    let unresolved = 0;
    let ambiguous = 0;
    for (const links of this.links.values()) {
      for (const link of links) {
        if (link.resolution === "unresolved") unresolved += 1;
        if (link.resolution === "ambiguous") ambiguous += 1;
      }
    }

    return {
      notes: this.notes.size,
      links: this.edges.filter((edge) => !edge.unresolved).length,
      unresolved,
      ambiguous,
      attachments: this.attachments.size,
      errors: [...this.notes.values()].filter((note) => note.parsed.errors.length > 0).length,
    };
  }

  private matchesFilter(note: NoteRecord, filter: { folder?: string; tag?: string }): boolean {
    if (filter.folder !== undefined && filter.folder !== "") {
      if (!(note.id.startsWith(`${filter.folder}/`))) return false;
    }
    if (filter.tag && !note.parsed.tags.includes(filter.tag.toLowerCase())) return false;
    return true;
  }

  listNotes(options: {
    folder?: string;
    tag?: string;
    ids?: string[];
    offset?: number;
    limit?: number;
    sort?: "title" | "modified" | "links";
  }): MemoryNotesPage {
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));

    let records = options.ids
      ? options.ids.flatMap((id) => {
          const note = this.notes.get(id);
          return note ? [note] : [];
        })
      : [...this.notes.values()];
    records = records.filter((note) => this.matchesFilter(note, options));

    let summaries = records.map((note) => this.summary(note));
    if (!options.ids) {
      const sort = options.sort ?? "title";
      summaries = summaries.sort((a, b) =>
        sort === "modified"
          ? b.modifiedAt.localeCompare(a.modifiedAt)
          : sort === "links"
            ? b.backlinkCount + b.outgoingCount - (a.backlinkCount + a.outgoingCount)
            : a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
    }

    return {
      notes: summaries.slice(offset, offset + limit),
      total: summaries.length,
      vaultTotal: this.notes.size,
      offset,
      limit,
    };
  }

  facets(): MemoryFacets {
    const folders = new Map<string, number>();
    const tags = new Map<string, number>();

    for (const note of this.notes.values()) {
      const parts = note.id.split("/").slice(0, -1);
      for (let depth = 1; depth <= parts.length; depth += 1) {
        const folder = parts.slice(0, depth).join("/");
        folders.set(folder, (folders.get(folder) ?? 0) + 1);
      }
      for (const tag of note.parsed.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }

    return {
      folders: [...folders.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder)),
      tags: [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    };
  }

  detail(id: string, stale: boolean): MemoryNoteDetail | undefined {
    const note = this.notes.get(id);
    if (!note) return undefined;

    const body = note.parsed.body;
    return {
      ...this.summary(note),
      hash: note.hash,
      headings: note.parsed.headings,
      frontmatter: note.parsed.frontmatter,
      links: this.links.get(id) ?? [],
      backlinks: [...(this.backlinks.get(id)?.values() ?? [])].sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle)),
      errors: note.parsed.errors,
      content: body.length > MAX_NOTE_CHARS ? body.slice(0, MAX_NOTE_CHARS) : body,
      truncated: body.length > MAX_NOTE_CHARS,
      stale,
    };
  }

  graph(options: {
    focus?: string;
    depth?: number;
    folder?: string;
    tag?: string;
    ids?: Set<string>;
    orphans?: boolean;
    unresolved?: boolean;
  }): MemoryGraph {
    const includeUnresolved = options.unresolved ?? false;
    const edges = this.edges.filter((edge) => includeUnresolved || !edge.unresolved);

    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    let keep: Set<string>;
    const depths = new Map<string, number>();

    if (options.focus && this.notes.has(options.focus)) {
      // Local graph: breadth-first in both directions, like Obsidian's.
      const maxDepth = Math.min(3, Math.max(1, options.depth ?? 1));
      const adjacency = new Map<string, Set<string>>();
      for (const edge of edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source)!.add(edge.target);
        adjacency.get(edge.target)!.add(edge.source);
      }

      depths.set(options.focus, 0);
      let frontier = [options.focus];
      for (let hop = 1; hop <= maxDepth; hop += 1) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const neighbour of adjacency.get(id) ?? []) {
            if (depths.has(neighbour)) continue;
            depths.set(neighbour, hop);
            if (!neighbour.startsWith("unresolved:")) next.push(neighbour);
          }
        }
        frontier = next;
      }
      keep = new Set(depths.keys());
    } else {
      keep = new Set(
        [...this.notes.values()]
          .filter((note) => this.matchesFilter(note, options))
          .filter((note) => !options.ids || options.ids.has(note.id))
          .filter((note) => options.orphans !== false || (degree.get(note.id) ?? 0) > 0)
          .map((note) => note.id),
      );
      if (includeUnresolved) {
        for (const edge of edges) if (edge.unresolved && keep.has(edge.source)) keep.add(edge.target);
      }
    }

    let nodes: MemoryGraphNode[] = [...keep].map((id) => {
      const note = this.notes.get(id);
      if (!note) {
        return {
          id,
          title: id.replace(/^unresolved:/, ""),
          folder: "",
          tags: [],
          degree: degree.get(id) ?? 0,
          unresolved: true,
          depth: depths.get(id),
        };
      }
      return {
        id,
        title: note.parsed.title,
        folder: path.posix.dirname(id) === "." ? "" : path.posix.dirname(id),
        tags: note.parsed.tags,
        degree: degree.get(id) ?? 0,
        depth: depths.get(id),
      };
    });

    let capped: MemoryGraph["capped"];
    if (nodes.length > GRAPH_NODE_CAP) {
      nodes = nodes.sort((a, b) => b.degree - a.degree);
      capped = { limit: GRAPH_NODE_CAP, omitted: nodes.length - GRAPH_NODE_CAP };
      nodes = nodes.slice(0, GRAPH_NODE_CAP);
      keep = new Set(nodes.map((node) => node.id));
    }

    return {
      nodes,
      edges: edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
      totalNotes: this.notes.size,
      totalEdges: this.edges.filter((edge) => !edge.unresolved).length,
      capped,
      focus: options.focus,
      depth: options.focus ? Math.min(3, Math.max(1, options.depth ?? 1)) : undefined,
    };
  }

  diagnostics(): MemoryDiagnostics {
    const unresolved: MemoryDiagnostics["unresolved"] = [];
    const ambiguous: MemoryDiagnostics["ambiguous"] = [];

    for (const [sourceId, links] of this.links) {
      for (const link of links) {
        if (link.resolution === "unresolved") unresolved.push({ sourceId, raw: link.raw, line: link.line });
        if (link.resolution === "ambiguous") {
          ambiguous.push({ sourceId, raw: link.raw, line: link.line, candidates: link.candidates ?? [] });
        }
      }
    }

    return {
      unresolved: unresolved.slice(0, 500),
      ambiguous: ambiguous.slice(0, 500),
      errors: [...this.notes.values()]
        .filter((note) => note.parsed.errors.length > 0)
        .map((note) => ({ id: note.id, errors: note.parsed.errors })),
      skipped: this.skipped,
    };
  }

  async saveCache(file: string) {
    const payload: CacheFile = {
      root: this.root,
      savedAt: new Date().toISOString(),
      lastIndexedAt: this.lastIndexedAt,
      notes: [...this.notes.values()],
      attachments: [...this.attachments],
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(payload), "utf8");
    await fs.rename(temporary, file);
  }

  /** Loads a cached index for this root. Returns false when there is none. */
  async loadCache(file: string): Promise<boolean> {
    try {
      const payload = JSON.parse(await fs.readFile(file, "utf8")) as CacheFile;
      if (payload.root !== this.root || !Array.isArray(payload.notes)) return false;
      this.notes = new Map(payload.notes.map((note) => [note.id, note]));
      this.attachments = new Set(payload.attachments ?? []);
      this.lastIndexedAt = payload.lastIndexedAt;
      this.relink();
      return true;
    } catch {
      return false;
    }
  }
}

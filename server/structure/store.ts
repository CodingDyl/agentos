import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructureState } from "../../shared/structure-types";
import { git } from "../agentos/git";
import { repositoryPathFor } from "../agentos/repository";
import { findOnPath } from "../ai-stack/detect";
import { parseGraph, type StructureIndex } from "./graph";
import { GRAPHIFY_OUTPUT, structureRebuilds } from "./rebuild";

/**
 * Finds a workspace's repository and its graph on disk, and keeps the last few
 * parsed graphs in memory: the file can run to tens of megabytes, and the tab
 * asks about it on every click.
 */

const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const CACHED_GRAPHS = 3;

interface Cached {
  mtimeMs: number;
  size: number;
  index: StructureIndex;
}

const cache = new Map<string, Cached>();

export function clearStructureCache(): void {
  cache.clear();
}

export type ResolvedFolder = { folder: string } | { status: "no-repository" | "missing-folder"; folder?: string; problem: string };

/** The workspace's linked repository, with symlinks resolved. */
export async function resolveStructureFolder(slug: string, recorded?: string): Promise<ResolvedFolder> {
  const linked = recorded ?? (await repositoryPathFor(slug));
  if (!linked) {
    return { status: "no-repository", problem: "This workspace has no local repository. Add a `Local repository:` line under Connected Systems in PROJECT.md." };
  }

  let real: string;
  try {
    real = await fs.realpath(linked);
    if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory");
  } catch {
    return { status: "missing-folder", folder: linked, problem: `The folder ${linked} is not available on this machine. If it lives on an external drive, connect the drive.` };
  }

  // A mistaken link should not map a whole home folder or disk.
  if (real === path.parse(real).root || real === (await fs.realpath(os.homedir()))) {
    return { status: "missing-folder", folder: real, problem: `${real} is too broad to map. Link the project's own folder instead.` };
  }

  return { folder: real };
}

export type LoadedGraph =
  | { status: "ready"; index: StructureIndex; builtAt: string }
  | { status: "empty" }
  | { status: "unsupported" | "unreadable"; problem: string };

/** Reads `<folder>/graphify-out/graph.json`, refusing anything that resolves outside the repository. */
export async function loadStructureGraph(folder: string): Promise<LoadedGraph> {
  const file = path.join(folder, GRAPHIFY_OUTPUT, "graph.json");

  let real: string;
  try {
    real = await fs.realpath(file);
  } catch {
    cache.delete(folder);
    return { status: "empty" };
  }
  if (!real.startsWith(`${folder}${path.sep}`)) {
    return { status: "unreadable", problem: `${GRAPHIFY_OUTPUT}/graph.json points outside this repository, so it was not read.` };
  }

  const stat = await fs.stat(real);
  if (stat.size > MAX_GRAPH_BYTES) {
    return { status: "unreadable", problem: `graph.json is ${Math.round(stat.size / 1024 / 1024)} MB, more than this tab will load.` };
  }

  const builtAt = stat.mtime.toISOString();
  const hit = cache.get(folder);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    // Refresh its place in the eviction order.
    cache.delete(folder);
    cache.set(folder, hit);
    return { status: "ready", index: hit.index, builtAt };
  }

  const parsed = parseGraph(await fs.readFile(real, "utf8"));
  if (!parsed.ok) return { status: parsed.reason, problem: parsed.problem };

  cache.set(folder, { mtimeMs: stat.mtimeMs, size: stat.size, index: parsed.index });
  while (cache.size > CACHED_GRAPHS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  return { status: "ready", index: parsed.index, builtAt };
}

export async function findGraphify(): Promise<string | undefined> {
  return findOnPath("graphify");
}

async function headCommit(folder: string): Promise<string | undefined> {
  try {
    return (await git(folder, ["rev-parse", "HEAD"])).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function structureState(slug: string): Promise<StructureState> {
  const cliInstalled = Boolean(await findGraphify());
  const rebuild = structureRebuilds.get(slug);
  const resolved = await resolveStructureFolder(slug);

  if ("status" in resolved) {
    return { status: resolved.status, folder: resolved.folder, problem: resolved.problem, cliInstalled, rebuild };
  }

  const { folder } = resolved;
  const loaded = await loadStructureGraph(folder);
  if (loaded.status === "empty") return { status: "empty", folder, cliInstalled, rebuild };
  if (loaded.status !== "ready") return { status: loaded.status, folder, problem: loaded.problem, cliInstalled, rebuild };

  return {
    status: "ready",
    folder,
    cliInstalled,
    rebuild,
    graph: loaded.index.overview({ builtAt: loaded.builtAt, headCommit: await headCommit(folder) }),
  };
}

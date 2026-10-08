import type { GraphCommit, GraphEdge, GraphRef, RepositoryGraph } from "../../shared/repository-types";
import { git, isRepository } from "./git";

/**
 * The commit graph, drawn the way a git client draws it.
 *
 * `layoutGraph` is pure: commits in, lanes out. Each commit sits in a lane, and
 * each row carries the segments needed to draw it on its own — lines that pass
 * straight through, lines that arrive at the commit from above, and lines that
 * leave it for its parents below. Because every row is self-contained the page
 * can draw rows independently and the lines still join at the row boundaries.
 */

const FIELD = "\x1f";
const RECORD = "\x1e";

export interface RawCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  decoration: string;
}

/** `HEAD -> main, origin/main, tag: v1, agentos-worker/job_x` as typed refs. */
export function parseDecoration(decoration: string): GraphRef[] {
  const refs: GraphRef[] = [];
  for (const raw of decoration.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (raw === "HEAD") continue;
    const current = raw.startsWith("HEAD -> ");
    const name = raw.replace(/^HEAD -> /, "");
    if (name.startsWith("tag: ")) refs.push({ name: name.slice(5), kind: "tag", current: false });
    else if (name.startsWith("agentos-worker/")) refs.push({ name, kind: "worker", current: false });
    else if (/^[^/]+\/.+/.test(name) && /^(origin|upstream)\//.test(name)) refs.push({ name, kind: "remote", current: false });
    else refs.push({ name, kind: "branch", current });
  }
  return refs;
}

/**
 * Assigns lanes. `commits` must be newest first with every parent after its
 * children (git's `--topo-order`).
 */
export function layoutGraph(commits: RawCommit[]): { rows: GraphCommit[]; lanes: number } {
  // lanes[i] is the hash lane i is waiting to reach, or null when free.
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;
  let widest = 1;

  const free = (): number => {
    const open = lanes.indexOf(null);
    if (open >= 0) return open;
    lanes.push(null);
    return lanes.length - 1;
  };
  const colorFor = (lane: number) => {
    if (laneColor[lane] === undefined) laneColor[lane] = nextColor++;
    return laneColor[lane];
  };

  const rows: GraphCommit[] = [];

  for (const commit of commits) {
    const top = [...lanes];
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = free();
      laneColor[lane] = nextColor++;
    }
    const color = colorFor(lane);

    // Every lane that was waiting for this commit ends here.
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null;

    const [first, ...others] = commit.parents;
    const placed: { parent: string; lane: number }[] = [];
    if (first) {
      lanes[lane] = first;
      placed.push({ parent: first, lane });
    }
    for (const parent of others) {
      let target = lanes.indexOf(parent);
      if (target < 0) {
        target = free();
        lanes[target] = parent;
        laneColor[target] = nextColor++;
      }
      placed.push({ parent, lane: target });
    }

    // Trailing free lanes are dropped so the graph narrows again.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const edges: GraphEdge[] = [];
    top.forEach((hash, i) => {
      if (hash === null) return;
      if (hash === commit.hash) {
        edges.push({ kind: "in", from: i, to: lane, color: colorFor(i) });
      } else {
        // A lane that waits for something carries on in the same column.
        edges.push({ kind: "through", from: i, to: i, color: colorFor(i) });
      }
    });
    for (const { lane: target } of placed) {
      edges.push({ kind: "out", from: lane, to: target, color: colorFor(target) });
    }

    widest = Math.max(widest, top.length, lanes.length, lane + 1);
    rows.push({
      hash: commit.hash,
      subject: commit.subject,
      author: commit.author,
      date: commit.date,
      parents: commit.parents,
      refs: parseDecoration(commit.decoration),
      lane,
      color,
      edges,
    });
  }

  return { rows, lanes: widest };
}

export async function readGitGraph(
  repoPath: string,
  options: { limit?: number; includeWorkers?: boolean } = {},
): Promise<RepositoryGraph> {
  const limit = Math.max(10, Math.min(options.limit ?? 150, 400));
  const includeWorkers = options.includeWorkers ?? false;
  const empty = { commits: [], lanes: 1, truncated: false, workersHidden: !includeWorkers };

  if (!(await isRepository(repoPath))) return { ...empty, unavailable: "This folder is not a git repository." };

  try {
    const { stdout } = await git(repoPath, [
      "log",
      "--topo-order",
      "--decorate=short",
      `-${limit + 1}`,
      `--format=%H${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%D${RECORD}`,
      ...(includeWorkers ? [] : ["--exclude=agentos-worker/*"]),
      "--branches",
      "--remotes",
      "--tags",
      "HEAD",
    ]);

    const raw: RawCommit[] = stdout
      .split(RECORD)
      .map((record) => record.replace(/^\s+/, ""))
      .filter(Boolean)
      .flatMap((record) => {
        const [hash, parents, author, date, subject, decoration] = record.split(FIELD);
        return hash ? [{ hash, parents: parents ? parents.split(" ") : [], author: author ?? "", date: date ?? "", subject: subject ?? "", decoration: decoration ?? "" }] : [];
      });

    const truncated = raw.length > limit;
    const { rows, lanes } = layoutGraph(raw.slice(0, limit));
    // Decorations list every ref at a commit, including ones left out of the walk.
    const commits = includeWorkers ? rows : rows.map((row) => ({ ...row, refs: row.refs.filter((ref) => ref.kind !== "worker") }));
    return { commits, lanes, truncated, workersHidden: !includeWorkers };
  } catch {
    // An empty repository has no HEAD to log.
    return empty;
  }
}

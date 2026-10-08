import { Copy, GitBranch, GitMerge, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import type { GraphCommit, GraphRef, RepositoryStatus } from "@shared/repository-types";
import { useRepositoryGraph } from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The repository's history as a lane graph, the way a git client draws it.
 *
 * Each row draws its own slice of the lines, so a tall graph is just a list.
 * Colour is a lane's identity, not a branch's: it tells you which line is
 * which at a glance, and nothing more. The names are the chips on the commit.
 */

const LANE_W = 18;
const ROW_H = 34;
const DOT = 5;
const PALETTE = ["#a3e635", "#38bdf8", "#f472b6", "#fbbf24", "#a78bfa", "#34d399", "#fb7185", "#60a5fa"];
const colour = (index: number) => PALETTE[index % PALETTE.length];

const x = (lane: number) => lane * LANE_W + LANE_W / 2 + 4;

function Lines({ commit, width }: { commit: GraphCommit; width: number }) {
  const mid = ROW_H / 2;
  return (
    <svg width={width} height={ROW_H} className="shrink-0" aria-hidden="true">
      {commit.edges.map((edge, index) => {
        const stroke = colour(edge.color);
        const common = { stroke, strokeWidth: 1.75, fill: "none", strokeLinecap: "round" as const };
        if (edge.kind === "through") {
          return <line key={index} x1={x(edge.from)} y1={0} x2={x(edge.to)} y2={ROW_H} {...common} />;
        }
        if (edge.kind === "in") {
          // From the top of the row down into the commit's dot.
          return <path key={index} d={`M ${x(edge.from)} 0 C ${x(edge.from)} ${mid * 0.8}, ${x(edge.to)} ${mid * 0.4}, ${x(edge.to)} ${mid}`} {...common} />;
        }
        return <path key={index} d={`M ${x(edge.from)} ${mid} C ${x(edge.from)} ${mid * 1.6}, ${x(edge.to)} ${mid * 1.2}, ${x(edge.to)} ${ROW_H}`} {...common} />;
      })}
      <circle
        cx={x(commit.lane)}
        cy={mid}
        r={commit.parents.length > 1 ? DOT + 0.5 : DOT}
        fill={commit.parents.length > 1 ? "#0c0c0c" : colour(commit.color)}
        stroke={colour(commit.color)}
        strokeWidth={2}
      />
    </svg>
  );
}

function RefChip({ item }: { item: GraphRef }) {
  const tone =
    item.kind === "worker"
      ? "border-os-border text-os-subtle"
      : item.kind === "tag"
        ? "border-os-amber/50 text-os-amber"
        : item.kind === "remote"
          ? "border-os-border text-os-muted"
          : item.current
            ? "border-os-amber bg-os-amber/15 text-foreground"
            : "border-os-success/50 text-os-success";
  const Icon = item.kind === "tag" ? Tag : GitBranch;
  return (
    <span className={cn("inline-flex max-w-[16rem] shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono text-[11px] leading-[18px]", tone)} title={item.kind === "worker" ? "A worker's scratch branch" : item.kind === "remote" ? "Where the remote last was" : item.name}>
      <Icon className="size-2.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{item.name}</span>
      {item.current ? <span className="sr-only"> (checked out)</span> : null}
    </span>
  );
}

export function GitGraph({ slug, status }: { slug: string; status: RepositoryStatus }) {
  const [workers, setWorkers] = useState(false);
  const [selected, setSelected] = useState<string>();
  const { data, isLoading, error } = useRepositoryGraph(slug, workers);

  const width = useMemo(() => Math.max(1, data?.lanes ?? 1) * LANE_W + 8, [data?.lanes]);
  const dirty = status.uncommitted.length;

  if (isLoading) return <p className="os-meta mt-6 text-os-subtle">Reading the history…</p>;
  if (error || !data) return <p className="os-meta mt-6 text-os-warning">{error instanceof Error ? error.message : "The history could not be read."}</p>;
  if (data.unavailable) return <p className="os-meta mt-6 text-os-subtle">{data.unavailable}</p>;

  const detail = data.commits.find((commit) => commit.hash === selected);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="os-meta normal-case text-os-subtle">
          Newest first. A hollow dot is a merge. Click a commit for its details.
        </p>
        <label className="os-meta inline-flex cursor-pointer items-center gap-2 normal-case text-os-subtle hover:text-foreground">
          <input type="checkbox" checked={workers} onChange={(event) => setWorkers(event.target.checked)} className="os-focus-ring size-3.5 cursor-pointer accent-[var(--color-os-amber,#fbbf24)]" />
          Show worker branches
        </label>
      </div>

      <ol className="mt-3 border-t border-os-border" aria-label="Commit history">
        {dirty > 0 ? (
          <li className="flex items-center border-b border-os-border/60" style={{ height: ROW_H }}>
            <svg width={width} height={ROW_H} className="shrink-0" aria-hidden="true">
              <line x1={x(0)} y1={ROW_H / 2} x2={x(0)} y2={ROW_H} stroke={colour(0)} strokeWidth={1.75} strokeDasharray="3 3" />
              <circle cx={x(0)} cy={ROW_H / 2} r={DOT} fill="none" stroke={colour(0)} strokeWidth={2} strokeDasharray="2 2" />
            </svg>
            <span className="text-[13px] text-os-warning">
              {dirty} uncommitted {dirty === 1 ? "change" : "changes"}
              {status.metadataFiles ? <span className="text-os-subtle"> · {status.metadataFiles} of them macOS ._ files</span> : null}
            </span>
          </li>
        ) : null}

        {data.commits.map((commit) => {
          const open = selected === commit.hash;
          return (
            <li key={commit.hash} className="border-b border-os-border/60">
              <button
                type="button"
                onClick={() => setSelected(open ? undefined : commit.hash)}
                aria-expanded={open}
                className={cn("os-focus-ring flex w-full cursor-pointer items-center gap-2 text-left transition-colors duration-150 hover:bg-os-border/20", open && "bg-os-border/25")}
                style={{ height: ROW_H }}
              >
                <Lines commit={commit} width={width} />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {commit.refs.map((item) => (
                    <RefChip key={`${item.kind}-${item.name}`} item={item} />
                  ))}
                  <span className="min-w-0 truncate text-[13px] text-foreground/90">{commit.subject}</span>
                </span>
                {commit.parents.length > 1 ? <GitMerge className="size-3 shrink-0 text-os-subtle" strokeWidth={1.5} aria-label="Merge commit" /> : null}
                <span className="os-meta hidden w-28 shrink-0 truncate text-os-subtle md:inline">{commit.author}</span>
                <span className="os-meta w-16 shrink-0 font-mono text-os-subtle">{commit.hash.slice(0, 7)}</span>
                <span className="os-meta hidden w-24 shrink-0 text-right tabular-nums text-os-subtle sm:inline">{formatRelativeTime(commit.date)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {detail ? <CommitDetail commit={detail} /> : null}

      {data.truncated ? <p className="os-meta mt-3 normal-case text-os-subtle">Showing the latest {data.commits.length} commits. Older history is in git log.</p> : null}
    </div>
  );
}

function CommitDetail({ commit }: { commit: GraphCommit }) {
  const [copied, setCopied] = useState<string>();
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(undefined), 1500);
    });
  };
  const commands = [
    { label: "See what changed", command: `git show ${commit.hash.slice(0, 7)}` },
    { label: "Look around at this point", command: `git switch --detach ${commit.hash.slice(0, 7)}` },
    { label: "Start a branch from here", command: `git switch -c my-branch ${commit.hash.slice(0, 7)}` },
  ];

  return (
    <section aria-label="Commit details" className="mt-4 rounded-sm border border-os-border p-4">
      <p className="text-[14px] font-medium text-foreground">{commit.subject}</p>
      <p className="os-meta mt-1 normal-case text-os-subtle">
        {commit.author} · {new Date(commit.date).toLocaleString()} · <span className="font-mono">{commit.hash}</span>
      </p>
      {commit.parents.length > 0 ? (
        <p className="os-meta mt-1 normal-case text-os-subtle">
          {commit.parents.length > 1 ? "Merges" : "Comes after"} <span className="font-mono">{commit.parents.map((parent) => parent.slice(0, 7)).join(" + ")}</span>
        </p>
      ) : (
        <p className="os-meta mt-1 normal-case text-os-subtle">The first commit.</p>
      )}
      <ul className="mt-3 space-y-1.5">
        {commands.map((item) => (
          <li key={item.command} className="flex flex-wrap items-center gap-3">
            <span className="os-meta w-44 normal-case text-os-subtle">{item.label}</span>
            <code className="rounded-sm bg-os-border/30 px-2 py-0.5 font-mono text-[12px] text-os-muted">{item.command}</code>
            <button type="button" onClick={() => copy(item.command)} className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1 rounded-sm normal-case text-os-subtle hover:text-foreground" aria-label={`Copy ${item.command}`}>
              <Copy className="size-3" strokeWidth={1.5} aria-hidden="true" />
              {copied === item.command ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

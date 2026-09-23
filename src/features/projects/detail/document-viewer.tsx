import { ArrowLeft, Check, Copy, FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, FilterBar, Markdown, SectionLabel } from "@/components/os";
import { useProjectDocument } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { formatTokens, SOURCE_LABELS, TYPE_LABELS } from "../documents-model";

type Mode = "preview" | "source";

/**
 * One document, read.
 *
 * Rendered through the same safe Markdown walker as agent replies — raw HTML
 * becomes text, only http(s) links and images resolve — with the source a
 * toggle away, because the person reading these is also the person who
 * maintains them. Provenance sits beside the body: which project, which
 * task, which run wrote it, and the way back to the task.
 *
 * Read-only on purpose. Editing is the next step; viewing, searching and
 * linking are the ones that make agent output stop disappearing.
 */
export function DocumentViewer({
  slug,
  path,
  origin,
  onBack,
}: {
  slug: string;
  path: string;
  origin: "agentos" | "repo";
  onBack: () => void;
}) {
  const { data, isPending, error } = useProjectDocument(slug, path, origin);
  const [mode, setMode] = useState<Mode>("preview");
  const [copied, setCopied] = useState<"content" | "path">();

  const copy = async (what: "content" | "path", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(undefined), 1_500);
    } catch {
      // Clipboard denied: nothing to do that the operator cannot do by hand.
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Documents
      </button>

      {isPending ? (
        <p className="mt-6 text-[15px] leading-6 text-os-muted">Reading…</p>
      ) : error || !data ? (
        <EmptyState
          label="Document unavailable"
          description={error?.message ?? "That document could not be read."}
          className="mt-6"
        />
      ) : (
        <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="min-w-0">
            <header className="border-b border-os-border pb-6">
              <h2 className="text-[clamp(1.5rem,2.5vw,2rem)] leading-[1.15] font-normal tracking-[-0.02em] text-balance">
                {data.artifact.title}
              </h2>
              <p className="os-meta mt-3 text-os-subtle">
                {TYPE_LABELS[data.artifact.type]} · {SOURCE_LABELS[data.artifact.source]}
                {data.artifact.createdAt
                  ? ` · ${new Date(data.artifact.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
                  : ""}
                {data.artifact.origin === "repo" ? " · Repository" : ""}
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <FilterBar<Mode>
                  label="Document view"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "preview", label: "Preview" },
                    { value: "source", label: "Source" },
                  ]}
                />
                <div className="flex items-center gap-1">
                  <ToolbarButton
                    icon={copied === "content" ? Check : Copy}
                    label={copied === "content" ? "Copied" : "Copy"}
                    onClick={() => void copy("content", data.content)}
                  />
                  <ToolbarButton
                    icon={copied === "path" ? Check : FileText}
                    label={copied === "path" ? "Path copied" : "Copy path"}
                    onClick={() => void copy("path", data.artifact.relativePath)}
                  />
                </div>
              </div>
            </header>

            {mode === "preview" ? (
              <Markdown content={data.content} className="mt-8 max-w-[76ch]" />
            ) : (
              <pre className="mt-8 overflow-x-auto rounded-md border border-os-border bg-os-surface-raised p-5">
                <code className="font-mono text-[13px] leading-6 text-foreground whitespace-pre-wrap">{data.content}</code>
              </pre>
            )}
          </article>

          <aside className="space-y-6 lg:pt-1">
            <div>
              <SectionLabel>Project</SectionLabel>
              <Link to={`/projects/${slug}`} className="os-focus-ring mt-2 block cursor-pointer rounded-md text-[14px] leading-5 text-foreground hover:text-os-amber">
                {slug}
              </Link>
            </div>

            {data.artifact.taskId ? (
              <div>
                <SectionLabel>Task</SectionLabel>
                <Link
                  to={`/projects/${slug}?tab=tasks&task=${encodeURIComponent(data.artifact.taskId)}`}
                  className="os-focus-ring mt-2 block cursor-pointer rounded-md text-[14px] leading-5 text-foreground hover:text-os-amber"
                >
                  {data.artifact.taskId} <span className="os-meta text-os-subtle">Open task →</span>
                </Link>
              </div>
            ) : null}

            <div>
              <SectionLabel>Created by</SectionLabel>
              <p className="mt-2 text-[14px] leading-5 text-foreground">{SOURCE_LABELS[data.artifact.source]}</p>
            </div>

            {data.artifact.jobId ? (
              <div>
                <SectionLabel>Worker job</SectionLabel>
                <Link to={`/workers/jobs/${data.artifact.jobId}`} className="os-focus-ring mt-2 block cursor-pointer rounded-md font-mono text-[12px] leading-5 text-os-muted hover:text-foreground">
                  {data.artifact.jobId}
                </Link>
              </div>
            ) : null}

            {data.artifact.runId ? (
              <div>
                <SectionLabel>Run</SectionLabel>
                <p className="mt-2 font-mono text-[12px] leading-5 text-os-muted">{data.artifact.runId}</p>
              </div>
            ) : null}

            <div>
              <SectionLabel>File</SectionLabel>
              <p className="mt-2 break-all font-mono text-[11px] leading-5 tracking-[0.02em] text-os-subtle">
                {data.artifact.origin === "repo" ? `<repo>/${data.artifact.relativePath}` : `~/AgentOS/${data.artifact.relativePath}`}
              </p>
              <p className="os-meta mt-2 text-os-subtle tabular-nums">
                {formatTokens(data.artifact.tokenEstimate)} tokens · {(data.artifact.sizeBytes / 1024).toFixed(1)} KB
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2.5 text-os-muted transition-colors duration-150 hover:border-os-border hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  );
}

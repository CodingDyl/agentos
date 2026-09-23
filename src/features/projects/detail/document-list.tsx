import { ArrowUpRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectArtifact } from "@shared/agentos-types";
import { HairlineCard } from "@/components/os";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { documentHref, formatTokens, SOURCE_LABELS, TYPE_LABELS } from "../documents-model";

/**
 * A list of documents, wherever one is shown: the Documents tab, a task's
 * artifacts, a job's outputs, Mission Control. One row shape, so a document
 * reads the same in each place.
 */
export function DocumentList({
  documents,
  showProject,
  showTokens,
  dense,
  className,
}: {
  documents: readonly (ProjectArtifact & { projectName?: string })[];
  showProject?: boolean;
  showTokens?: boolean;
  dense?: boolean;
  className?: string;
}) {
  if (documents.length === 0) return null;

  return (
    <HairlineCard className={cn("overflow-hidden", className)}>
      <ul className="divide-y divide-os-border">
        {documents.map((document) => (
          <li key={`${document.origin}:${document.id}`}>
            <Link
              to={documentHref(document)}
              className={cn(
                "os-focus-ring group flex cursor-pointer items-start gap-3 transition-colors duration-150 hover:bg-os-surface-raised",
                dense ? "px-3 py-2.5" : "px-4 py-3.5",
              )}
            >
              <FileText className="mt-1 size-4 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />

              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className={cn("min-w-0 truncate text-foreground", dense ? "text-[14px] leading-5" : "text-[15px] leading-6")}>
                    {document.title}
                  </span>
                  {document.origin === "repo" ? (
                    <span className="os-meta shrink-0 rounded-sm border border-os-border px-1.5 text-os-subtle">Repo</span>
                  ) : null}
                  {document.detected ? (
                    <span className="os-meta shrink-0 rounded-sm border border-os-warning/40 px-1.5 text-os-warning">Detected</span>
                  ) : null}
                </span>
                <span className="os-meta mt-1 flex flex-wrap items-center gap-x-2 text-os-subtle">
                  <span>{TYPE_LABELS[document.type]}</span>
                  {document.taskId ? <span>· {document.taskId}</span> : null}
                  {showProject && document.projectName ? <span>· {document.projectName}</span> : null}
                  <span>· {SOURCE_LABELS[document.source]}</span>
                  {document.updatedAt ? <span>· {formatRelativeTime(document.updatedAt)}</span> : null}
                  {showTokens ? <span className="tabular-nums">· {formatTokens(document.tokenEstimate)} tokens</span> : null}
                </span>
              </span>

              <ArrowUpRight
                className="mt-1 size-4 shrink-0 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </HairlineCard>
  );
}

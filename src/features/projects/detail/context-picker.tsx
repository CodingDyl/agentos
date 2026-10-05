import { Square, SquareCheck } from "lucide-react";
import { useMemo } from "react";
import type { ProjectArtifact } from "@shared/agentos-types";
import { SectionLabel } from "@/components/os";
import { useProjectDocuments } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { formatTokens, TYPE_LABELS } from "../documents-model";

/**
 * Which documents go into the worker's packet — and what they cost.
 *
 * Every row is priced in tokens and the total is kept in view, because the
 * quiet way a job's cost triples is a packet that loads every document a
 * project has ever produced. Hermes' own suggestions arrive pre-ticked;
 * everything else is a deliberate choice.
 *
 * The value is the plan's `contextFiles` list. Vault documents are named by
 * their vault-relative path and repository documents by their repo-relative
 * path; the server resolves both to real files before the worker starts.
 */
export function ContextPicker({
  slug,
  value,
  onChange,
  disabled,
  className,
}: {
  slug: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { data } = useProjectDocuments(slug);

  const groups = useMemo(
    () => [
      { label: "Project", items: data?.canonical ?? [] },
      { label: "Documents", items: data?.agentos ?? [] },
      { label: "Repository", items: data?.repo ?? [] },
    ],
    [data],
  );

  const known = groups.flatMap((group) => group.items);

  /**
   * Whether a path the plan names means this document.
   *
   * By exact path, by vault-relative path, or — for the five control files —
   * by name alone: Hermes tends to write `<repo>/PROJECT.md` for a file that
   * lives in the vault, and the server resolves that the same way.
   */
  const names = (entry: string, document: ProjectArtifact) => {
    const bare = entry.replace(/^.*\/AgentOS\//, "");
    if (entry === document.relativePath || bare === document.relativePath) return true;
    return document.id.startsWith("canonical:") && entry.split("/").pop() === document.filename;
  };

  const isSelected = (document: ProjectArtifact) => value.some((entry) => names(entry, document));

  const pickedTokens = known.filter(isSelected).reduce((sum, document) => sum + document.tokenEstimate, 0);
  // Paths the plan names that this picker cannot price (a source file, say).
  const unpriced = value.filter((entry) => !known.some((document) => names(entry, document)));

  const toggle = (document: ProjectArtifact) => {
    if (disabled) return;

    if (isSelected(document)) {
      onChange(value.filter((entry) => !names(entry, document)));
    } else {
      onChange([...value, document.relativePath]);
    }
  };

  if (!data) return null;

  return (
    <div className={cn("mt-4", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel>Context</SectionLabel>
        <span className="os-meta text-os-subtle tabular-nums">
          {formatTokens(pickedTokens)} tokens{unpriced.length > 0 ? ` + ${unpriced.length} unpriced` : ""}
        </span>
      </div>

      <div className="mt-2 space-y-3">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.label}>
              <p className="os-meta text-os-subtle">{group.label}</p>
              <ul className="mt-1">
                {group.items.map((document) => {
                  const selected = isSelected(document);
                  return (
                    <li key={`${document.origin}:${document.id}`}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => toggle(document)}
                        className="os-focus-ring -mx-1 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-left disabled:cursor-default"
                      >
                        {selected ? (
                          <SquareCheck className="size-3.5 shrink-0 text-os-amber" strokeWidth={1.5} aria-hidden="true" />
                        ) : (
                          <Square className="size-3.5 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                        )}
                        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", selected ? "text-foreground" : "text-os-muted")}>
                          {document.title}
                          {document.id.startsWith("canonical:") ? null : (
                            <span className="os-meta ml-2 text-os-subtle">
                              {TYPE_LABELS[document.type]}
                              {document.taskId ? ` · ${document.taskId}` : ""}
                              {document.origin === "repo" ? " · repo" : ""}
                            </span>
                          )}
                        </span>
                        <span className="os-meta shrink-0 text-os-subtle tabular-nums">{formatTokens(document.tokenEstimate)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

        {unpriced.length > 0 ? (
          <div>
            <p className="os-meta text-os-subtle">Also named by Hermes</p>
            <ul className="mt-1 space-y-0.5">
              {unpriced.map((entry) => (
                <li key={entry} className="truncate font-mono text-[12px] leading-5 text-os-subtle">
                  {entry}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { ChevronRight, Crosshair, FileText, Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import { buildTree, flatten, type TreeNote } from "./file-tree-model";

/**
 * The vault as its folders, the way Obsidian's own sidebar shows it.
 *
 * Folders open and close; notes open in the panel beside the graph. A folder
 * can also narrow the graph to itself (the crosshair), which is kept apart
 * from opening it so browsing never changes what the graph shows by accident.
 *
 * A real tree for assistive technology: one tab stop, arrows to move, right
 * and left to open and close, Enter to open. The graph is never the only way
 * to reach a note.
 */

const EXPANDED_KEY = "agentos.memory.expanded";

function readExpanded(): Set<string> {
  try {
    const stored = localStorage.getItem(EXPANDED_KEY);
    if (stored) return new Set(JSON.parse(stored) as string[]);
  } catch {
    // A preference only.
  }
  return new Set(["projects"]);
}

export function FileTree({
  notes,
  selectedId,
  folderFilter,
  searching,
  colorOf,
  onOpen,
  onFilterFolder,
}: {
  notes: readonly TreeNote[];
  selectedId?: string;
  folderFilter?: string;
  /** While searching every match is shown, whatever is folded. */
  searching: boolean;
  colorOf: (id: string) => string | undefined;
  onOpen: (id: string) => void;
  onFilterFolder: (folder: string | undefined) => void;
}) {
  const tree = useMemo(() => buildTree(notes), [notes]);
  const [expanded, setExpanded] = useState(readExpanded);
  const [active, setActive] = useState<string | undefined>(undefined);
  const container = useRef<HTMLUListElement>(null);

  const save = (next: Set<string>) => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // A preference only.
    }
    return next;
  };

  const toggle = useCallback((path: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      const shouldOpen = open ?? !next.has(path);
      if (shouldOpen) next.add(path);
      else next.delete(path);
      return save(next);
    });
  }, []);

  // Opening a note from the graph reveals it here: its folders open once,
  // when it becomes the selection, and can be closed again afterwards.
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  if (selectedId && selectedId !== revealed) {
    setRevealed(selectedId);
    const parts = selectedId.split("/").slice(0, -1);
    const missing = parts.map((_, depth) => parts.slice(0, depth + 1).join("/")).filter((path) => !expanded.has(path));
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]));
    setActive(`note:${selectedId}`);
  }

  const rows = useMemo(() => flatten(tree, expanded, searching), [tree, expanded, searching]);
  const activeKey = rows.some((row) => row.key === active) ? active : rows[0]?.key;

  // Scroll the selected note into view when it changes.
  useEffect(() => {
    if (!selectedId) return;
    container.current
      ?.querySelector<HTMLElement>(`[data-key="note:${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, rows]);

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setActive(key);
    container.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((row) => row.key === activeKey);
    const row = rows[index];
    if (!row) return;
    const move = (to: number) => focusRow(rows[Math.max(0, Math.min(rows.length - 1, to))]?.key);

    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.kind === "folder") {
          if (!searching && !expanded.has(row.folder.path)) toggle(row.folder.path, true);
          else move(index + 1);
        }
        break;
      case "ArrowLeft":
        if (row.kind === "folder" && !searching && expanded.has(row.folder.path)) toggle(row.folder.path, false);
        else focusRow(row.parent);
        break;
      case "Enter":
      case " ":
        if (row.kind === "folder") {
          if (!searching) toggle(row.folder.path);
        } else onOpen(row.note.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  if (rows.length === 0) return null;

  return (
    <ul ref={container} role="tree" aria-label="Vault folders and notes" className="py-1" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        // Notes line up under their folder's icon, past the chevron.
        const pad = 10 + (row.level - 1) * 14;
        const tabIndex = row.key === activeKey ? 0 : -1;

        if (row.kind === "folder") {
          const open = searching || expanded.has(row.folder.path);
          const filtering = folderFilter === row.folder.path;
          const Icon = open ? FolderOpen : Folder;
          return (
            <li
              key={row.key}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={open}
              aria-selected={false}
              data-key={row.key}
              tabIndex={tabIndex}
              onFocus={() => setActive(row.key)}
              onClick={() => !searching && toggle(row.folder.path)}
              style={{ paddingLeft: pad }}
              className={cn(
                "group flex min-h-8 cursor-pointer items-center gap-1.5 pr-1.5 text-[13.5px] text-paper-moss transition-colors duration-100 select-none hover:bg-paper-linen",
                PAPER_FOCUS,
                "focus-visible:outline-offset-[-2px]",
              )}
            >
              <ChevronRight
                className={cn("size-3.5 shrink-0 text-paper-sage transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")}
                strokeWidth={2}
                aria-hidden="true"
              />
              <Icon className="size-4 shrink-0 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium">{row.folder.name}</span>
              <span className="text-[12px] text-paper-sage tabular-nums">{row.folder.count}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-pressed={filtering}
                aria-label={filtering ? `Show the whole vault in the graph` : `Show only ${row.folder.path} in the graph`}
                title={filtering ? "Show the whole vault" : "Show only this folder in the graph"}
                onClick={(event) => {
                  event.stopPropagation();
                  onFilterFolder(filtering ? undefined : row.folder.path);
                }}
                className={cn(
                  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center transition-[opacity,background-color,color] duration-150",
                  filtering
                    ? "bg-paper-blue text-paper-white opacity-100"
                    : "text-paper-sage opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-paper-stone hover:text-paper-moss",
                )}
              >
                <Crosshair className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          );
        }

        const selected = row.note.id === selectedId;
        const color = colorOf(row.note.id);
        return (
          <li
            key={row.key}
            role="treeitem"
            aria-level={row.level}
            aria-selected={selected}
            aria-current={selected ? "page" : undefined}
            data-key={row.key}
            tabIndex={tabIndex}
            title={`${row.note.title} — ${row.note.id}`}
            onFocus={() => setActive(row.key)}
            onClick={() => onOpen(row.note.id)}
            style={{ paddingLeft: pad + 20 }}
            className={cn(
              "flex min-h-8 cursor-pointer items-center gap-2 pr-2 text-[13.5px] transition-colors duration-100 select-none",
              PAPER_FOCUS,
              "focus-visible:outline-offset-[-2px]",
              selected ? "bg-paper-blue text-paper-white" : "text-paper-char hover:bg-paper-linen hover:text-paper-moss",
            )}
          >
            {color ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: color, boxShadow: selected ? `0 0 0 2px var(--paper-white)` : `0 0 6px ${color}` }}
                aria-hidden="true"
              />
            ) : (
              <FileText className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{row.note.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

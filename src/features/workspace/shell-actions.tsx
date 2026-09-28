import { PenLine, Plus, Search } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { projectInContext } from "@/features/agent/command-catalog";
import { useCommandPalette } from "@/features/agent/command-palette-context";
import { useQuickCreate } from "./quick-create-context";

/**
 * The controls in every screen's top bar: capture, search, and create.
 *
 * Capture comes first because it is the one that has to be instant — a
 * thought noticed on the way somewhere is gone by the time a menu opens.
 * Search and `+` open the same palette (search in full, `+` filtered to
 * Create), so there is one surface to learn. The shortcuts are printed on the
 * controls rather than hidden in a help page.
 */
export function ShellActions() {
  const palette = useCommandPalette();
  const quickCreate = useQuickCreate();
  const location = useLocation();
  const project = projectInContext(location.pathname, location.search);

  useEffect(() => {
    // ⌘⇧C from anywhere, including from inside a text field: capturing is
    // exactly what someone halfway through typing something else wants.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "c" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        quickCreate.open("capture", { project });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [project, quickCreate]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => quickCreate.open("capture", { project })}
        className="os-focus-ring inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-os-border px-2.5 text-os-muted transition-colors duration-150 hover:border-os-amber/60 hover:text-os-amber"
        aria-label="Capture a note"
        title="Capture a note (⌘⇧C)"
      >
        <PenLine className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        <span className="os-meta hidden sm:inline">Capture</span>
      </button>

      <button
        type="button"
        onClick={() => palette.open("all")}
        className="os-focus-ring hidden min-h-8 cursor-pointer items-center gap-2 rounded-md border border-os-border px-2.5 text-os-subtle transition-colors duration-150 hover:border-os-border-strong hover:text-foreground sm:inline-flex"
        aria-label="Search AgentOS"
      >
        <Search className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        <span className="os-meta">Search</span>
        <kbd className="os-meta rounded-sm border border-os-border px-1 text-os-subtle">⌘K</kbd>
      </button>

      <button
        type="button"
        onClick={() => palette.open("create")}
        className="os-focus-ring inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-os-border text-os-muted transition-colors duration-150 hover:border-os-amber/60 hover:text-os-amber"
        aria-label="Quick create"
        title="Quick create"
      >
        <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

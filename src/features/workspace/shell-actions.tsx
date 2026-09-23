import { Plus, Search } from "lucide-react";
import { useCommandPalette } from "@/features/agent/command-palette-context";

/**
 * The two controls in every screen's top bar: search, and create.
 *
 * Both open the same palette — search in its full mode, `+` filtered to the
 * Create group — so there is one surface to learn. The keyboard shortcuts are
 * printed on them rather than hidden in a help page.
 */
export function ShellActions() {
  const palette = useCommandPalette();

  return (
    <div className="flex items-center gap-1.5">
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

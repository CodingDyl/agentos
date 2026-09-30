import { Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectDetail, ProjectTask } from "@shared/agentos-types";
import { SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";

/**
 * "Delegate" from anywhere on the project page: which task?
 *
 * A small list of the open, addressable tasks, `Now` first. Choosing one hands
 * off to the Tasks tab with that task's panel open, where the actual scoping,
 * routing (Auto / Local only / Manual) and approval happen — this picker starts
 * nothing itself and decides nothing about where the task runs. Tasks without an id
 * are not offered; the vault cannot name them back to a worker.
 */
export function DelegatePicker({
  project,
  onPick,
  onClose,
}: {
  project: ProjectDetail;
  onPick: (task: ProjectTask & { id: string }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const candidates = [...project.tasks.now, ...project.tasks.next, ...project.tasks.later].filter(
    (task): task is ProjectTask & { id: string } =>
      task.id !== undefined &&
      !task.completed &&
      (!needle || task.title.toLowerCase().includes(needle) || task.id.toLowerCase().includes(needle)),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-os-background/85" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delegate a task"
        className="relative flex max-h-[70vh] w-[min(92vw,34rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="flex items-center justify-between gap-4 border-b border-os-border px-5 py-4">
          <div>
            <SectionLabel>Delegate</SectionLabel>
            <p className="mt-2 text-[13px] leading-5 text-os-muted">
              Pick a task. Hermes scopes it, the router shows where it would run and why (a local model for small text tasks, a capable worker for anything needing a repository), and you approve before anything starts.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        <div className="border-b border-os-border px-5 py-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tasks"
            className="os-focus-ring w-full rounded-md border border-os-border bg-transparent px-3 py-2 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto py-2">
          {candidates.length === 0 ? (
            <li className="px-5 py-4 text-[14px] leading-5 text-os-subtle">
              {project.tasks.now.length + project.tasks.next.length + project.tasks.later.length === 0
                ? "No open tasks. Add one first."
                : "Nothing matches."}
            </li>
          ) : (
            candidates.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onPick(task)}
                  className={cn(
                    "os-focus-ring flex w-full cursor-pointer items-baseline gap-3 px-5 py-2.5 text-left transition-colors duration-150 hover:bg-os-surface-raised",
                  )}
                >
                  <span className="os-meta w-16 shrink-0 text-os-subtle">{task.id}</span>
                  <span className="min-w-0 flex-1 text-[15px] leading-6 text-foreground">{task.title}</span>
                  <span className="os-meta shrink-0 text-os-subtle">{task.section}</span>
                  <Send className="size-3.5 shrink-0 self-center text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

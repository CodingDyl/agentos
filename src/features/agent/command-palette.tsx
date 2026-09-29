import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentSkill, ProjectSummary, SearchHit } from "@shared/agentos-types";
import { useSearch } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  buildCommands,
  groupCommands,
  searchCommands,
  type Command,
  type CommandGroup,
} from "./command-catalog";
import {
  groupActions,
  searchActions,
  SEARCH_GROUP_LABELS,
  type PaletteAction,
} from "./workspace-actions";

export interface CommandPaletteProps {
  onClose: () => void;
  /** Skills discovered from Hermes. The baseline is used when absent. */
  skills?: AgentSkill[];
  /** False when the list is the built-in baseline rather than Hermes'. */
  discovered?: boolean;
  projects: ProjectSummary[];
  /** Project in context, from the route or the console's own selection. */
  project?: string;
  /** Runs the command. The palette never talks to Hermes itself. */
  onRun: (command: string, project?: string) => void;
  /** Everything ⌘K can do that is not a Hermes skill. */
  actions: PaletteAction[];
  /** Opens showing only the Create group — the shell's `+`. */
  mode?: "all" | "create";
  /** Follows a search hit. */
  onOpenHit: (hit: SearchHit) => void;
}

/** What the palette is currently asking for. */
type Stage = { kind: "commands" } | { kind: "project"; command: Command };

/** A row in the list, whichever stage is showing. */
interface Row {
  key: string;
  /** Left-hand text: an action's name, a command, or a hit's title. */
  primary: string;
  /** Right-hand text: what it does, the project's state, a hit's detail. */
  secondary?: string;
  /** Skill commands are mono; everything else reads as prose. */
  mono?: boolean;
  onSelect: () => void;
}

interface RowGroup {
  label: string;
  rows: Row[];
}

function commandRows(groups: CommandGroup[], onChoose: (command: Command) => void): RowGroup[] {
  return groups.map((group) => ({
    label: group.label,
    rows: group.commands.map((command) => ({
      key: `cmd:${command.name}`,
      primary: command.command,
      secondary: command.description ?? (command.needsProject ? "Choose a project" : command.label),
      mono: true,
      onSelect: () => onChoose(command),
    })),
  }));
}

function actionRows(label: string, actions: PaletteAction[], onClose: () => void): RowGroup {
  return {
    label,
    rows: actions.map((action) => ({
      key: action.id,
      primary: action.label,
      secondary: action.hint,
      onSelect: () => {
        onClose();
        action.run();
      },
    })),
  };
}

/**
 * The console's command palette — and the workspace's.
 *
 * Empty, it offers what can be created, where to go, and who to ask, then the
 * Hermes skills. Typing searches all of that *and* the vault: projects, tasks,
 * decisions, designs, jobs and sessions arrive from `/api/search` as their own
 * groups beneath the matching actions. One keystroke, one surface.
 *
 * Choosing anything closes the palette and does exactly one thing — opens a
 * form, changes the route, or hands a command to the console. The palette
 * starts no work of its own.
 *
 * It is mounted only while open, so each opening starts from a clean search
 * rather than resetting itself afterwards.
 */
export function CommandPalette({
  onClose,
  skills,
  discovered = true,
  projects,
  project,
  onRun,
  actions,
  mode = "all",
  onOpenHit,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "commands" });
  const [selected, setSelected] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const rowId = (index: number) => `${listId}-row-${index}`;

  // Where focus was before the palette opened, so closing returns the operator
  // there rather than to the top of the document.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  const commands = useMemo(() => buildCommands(skills, project), [skills, project]);

  // Debounced by the query hook's key: a keystroke that changes the query
  // starts a new request, and the previous result stays on screen until the
  // new one lands, so the list never blinks empty between letters.
  const searching = stage.kind === "commands" && query.trim().length >= 2;
  const search = useSearch(query, searching);

  const groups = useMemo<RowGroup[]>(() => {
    if (stage.kind === "project") {
      const needle = query.trim().toLowerCase();
      const matches = projects.filter(
        (entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.slug.includes(needle),
      );

      return [
        {
          label: `Run ${stage.command.command} on`,
          rows: matches.map((entry) => ({
            key: entry.slug,
            primary: entry.name,
            secondary: entry.state,
            onSelect: () => onRun(`${stage.command.command} ${entry.slug}`, entry.slug),
          })),
        },
      ];
    }

    const choose = (command: Command) => {
      // A project-scoped command with nothing in context asks which project,
      // rather than guessing which one was meant.
      if (command.needsProject) {
        setQuery("");
        setSelected(0);
        setStage({ kind: "project", command });
        return;
      }

      onRun(command.command, project);
    };

    const trimmed = query.trim();

    if (!trimmed) {
      if (mode === "create") {
        return groupActions(actions)
          .filter((group) => group.label === "Create")
          .map((group) => actionRows(group.label, group.actions, onClose));
      }

      return [
        ...groupActions(actions).map((group) => actionRows(group.label, group.actions, onClose)),
        ...commandRows(groupCommands(commands, { project }), choose),
      ];
    }

    const matchedActions = searchActions(actions, trimmed);
    const matchedCommands = searchCommands(commands, trimmed, { project });

    const hitGroups: RowGroup[] = (search.data?.groups ?? []).map((group) => ({
      label: SEARCH_GROUP_LABELS[group.kind],
      rows: group.hits.map((hit) => ({
        key: `${hit.kind}:${hit.id}`,
        primary: hit.title,
        secondary: hit.detail,
        onSelect: () => {
          onClose();
          onOpenHit(hit);
        },
      })),
    }));

    return [
      ...(matchedActions.length > 0 ? [actionRows("Actions", matchedActions, onClose)] : []),
      ...(matchedCommands.length > 0 ? commandRows([{ label: "Commands", commands: matchedCommands }], choose) : []),
      ...hitGroups,
    ];
  }, [actions, commands, mode, onClose, onOpenHit, onRun, project, projects, query, search.data, stage]);

  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  // Rows are rendered by group but navigated as one list, so each keeps its
  // position in the flat order.
  const indexOfRow = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);

  // Clamped as it is read: a shorter list must never leave the cursor past its
  // end, and deriving it avoids a render spent correcting the selection.
  const active = rows.length === 0 ? 0 : Math.min(selected, rows.length - 1);

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(`${listId}-row-${active}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function move(delta: number) {
    if (rows.length === 0) return;
    setSelected((current) => {
      const from = Math.min(current, rows.length - 1);
      return (from + delta + rows.length) % rows.length;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      rows[active]?.onSelect();
      return;
    }

    // Escape, or backspace on an empty query, steps back one stage before it
    // closes — an accidental project prompt is one key away from undone.
    const stepsBack = event.key === "Escape" || (event.key === "Backspace" && query.length === 0);

    if (stepsBack && stage.kind === "project") {
      event.preventDefault();
      setStage({ kind: "commands" });
      setSelected(0);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const contextProject = projects.find((entry) => entry.slug === project);
  const isSearching = searching && (search.isPending || search.isFetching);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] pb-8">
      <button type="button" aria-label="Close command palette" onClick={onClose} className="absolute inset-0 cursor-default bg-paper-moss/45" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "Quick create" : "Commands and search"}
        className="relative flex max-h-full w-[min(92vw,42rem)] flex-col overflow-hidden rounded-[6px] border border-paper-moss bg-paper-white font-paper-ui text-paper-moss"
      >
        <div className="flex items-center gap-3 border-b border-paper-mist px-4 py-3">
          <Search className={cn("size-4 shrink-0 text-paper-char", isSearching && "motion-safe:animate-pulse")} strokeWidth={1.75} aria-hidden="true" />
          <input
            // The palette mounts when it opens, so this is the one moment focus
            // should move on its own.
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              stage.kind === "project"
                ? "Which project?"
                : mode === "create"
                  ? "What do you want to create?"
                  : "Search AgentOS, or type a command…"
            }
            aria-label={stage.kind === "project" ? "Search projects" : "Search AgentOS"}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? rowId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-paper-moss outline-none placeholder:text-paper-ash"
          />
          <kbd className="hidden shrink-0 rounded-[3px] border border-paper-mist px-1.5 font-mono text-[11.5px] text-paper-sage sm:inline">Esc</kbd>
        </div>

        {contextProject && stage.kind === "commands" ? (
          <div className="border-b border-paper-mist px-4 py-2 text-[12.5px] text-paper-sage">
            Context: <span className="font-medium text-paper-char">{contextProject.name}</span>
          </div>
        ) : null}

        <div ref={listRef} id={listId} role="listbox" aria-label={stage.kind === "project" ? "Projects" : "Results"} className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-[14px] leading-6 text-paper-sage">
              {stage.kind === "project"
                ? "No projects match."
                : isSearching
                  ? "Searching…"
                  : query.trim().length === 1
                    ? "Keep typing."
                    : "Nothing matches."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <div className="px-3 py-2 text-[12px] font-semibold text-paper-sage">{group.label}</div>
                {group.rows.map((row) => {
                  const index = indexOfRow.get(row) ?? 0;
                  const isSelected = index === active;

                  return (
                    <div
                      key={row.key}
                      id={rowId(index)}
                      role="option"
                      aria-selected={isSelected}
                      onClick={row.onSelect}
                      onMouseMove={() => setSelected(index)}
                      className={cn(
                        "relative flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded-[3px] px-3 transition-colors duration-150",
                        isSelected && "bg-paper-linen",
                      )}
                    >
                      {isSelected ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-paper-blue" aria-hidden="true" /> : null}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          row.mono ? "font-mono text-[12.5px]" : "text-[14px]",
                          isSelected ? "font-medium text-paper-moss" : "text-paper-char",
                        )}
                      >
                        {row.primary}
                      </span>
                      {row.secondary ? (
                        <span className="max-w-[45%] shrink-0 truncate text-right text-[12.5px] text-paper-sage">{row.secondary}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-mist px-4 py-2 text-[12.5px] text-paper-sage">
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="size-3" aria-hidden="true" />
            {stage.kind === "project" ? "Run on workspace" : "Open"}
            <span className="mx-1.5 text-paper-mist">·</span>
            ↑↓ Move
          </span>
          {!discovered && stage.kind === "commands" ? (
            <span>Built-in commands (Hermes skills not read)</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

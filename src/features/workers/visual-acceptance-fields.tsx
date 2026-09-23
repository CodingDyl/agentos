import { Plus, X } from "lucide-react";
import type {
  VisualAcceptanceContext,
  VisualRoute,
  VisualViewport,
} from "@shared/visual-verification-types";
import { SectionLabel } from "@/components/os";
import { useDesignLibrary } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { visualAcceptanceProblem } from "./workers-model";

/**
 * Saying what a piece of work is supposed to look like, before it is handed over.
 *
 * This is asked here rather than at review time for the reason the whole step
 * exists: by the time an implementation is finished, the brief and the board it
 * came from are two lookups and a guess away, and a reviewer made to
 * reconstruct them reconstructs them wrong.
 *
 * It is off by default, and stays off unless someone says otherwise. Most work
 * has no screen — a backend ticket driven through a browser would cost minutes
 * to conclude nothing.
 *
 * A route is two facts, not one: where to go, and which screen must come back.
 * They are entered as two fields rather than parsed out of one line, because
 * the second is the part that makes the capture deterministic and it should be
 * as visible as the first.
 */

/** The two sizes worth checking by default. Others can be typed in later. */
const PRESETS: readonly VisualViewport[] = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const INPUT =
  "os-focus-ring w-full rounded-md border border-os-border bg-transparent px-3 py-2 font-mono text-[12px] leading-6 text-foreground placeholder:text-os-subtle";

export interface VisualAcceptanceFieldsProps {
  value: VisualAcceptanceContext | undefined;
  onChange: (next: VisualAcceptanceContext | undefined) => void;
  /** Narrows the board list to one project's boards, when there is one. */
  project?: string;
  className?: string;
}

/** An empty contract, so turning this on never starts from a half-filled one. */
function blank(): VisualAcceptanceContext {
  return { enabled: true, routes: [] };
}

/** The viewports a new route gets: whichever the existing ones already use. */
function viewportsFrom(routes: readonly VisualRoute[]): VisualViewport[] {
  return routes[0]?.viewports.length ? [...routes[0].viewports] : [...PRESETS];
}

export function VisualAcceptanceFields({
  value,
  onChange,
  project,
  className,
}: VisualAcceptanceFieldsProps) {
  const library = useDesignLibrary();

  const boards = (library.data?.boards ?? []).filter(
    (board) => !project || !board.project || board.project === project,
  );

  const enabled = value?.enabled === true;
  const routes = value?.routes ?? [];

  // Viewports are chosen once and apply to every route. A per-route viewport
  // editor is more expressive than anyone needs and slower than everyone
  // wants: in practice the answer is "these screens, at these sizes".
  const viewports = viewportsFrom(routes).map((viewport) => viewport.name);

  const problem = visualAcceptanceProblem(value);

  const put = (next: Partial<VisualAcceptanceContext>) =>
    onChange({ ...(value ?? blank()), enabled: true, ...next });

  const editRoute = (index: number, patch: Partial<VisualRoute>) =>
    put({
      routes: routes.map((route, position) =>
        position === index ? { ...route, ...patch } : route,
      ),
    });

  const addRoute = () =>
    put({
      routes: [
        ...routes,
        { path: "", expectedPageId: "", viewports: viewportsFrom(routes) },
      ],
    });

  const removeRoute = (index: number) =>
    put({ routes: routes.filter((_, position) => position !== index) });

  const toggleViewport = (name: string) => {
    const next = viewports.includes(name)
      ? viewports.filter((entry) => entry !== name)
      : [...viewports, name];

    const chosen = PRESETS.filter((preset) => next.includes(preset.name));

    put({
      routes: routes.map((route) => ({
        ...route,
        // A route with no viewport cannot be captured, so an empty selection
        // falls back rather than silently producing nothing.
        viewports: chosen.length > 0 ? chosen : [PRESETS[0]],
      })),
    });
  };

  return (
    <div className={className}>
      <SectionLabel>Visual acceptance</SectionLabel>

      <label className="mt-3 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { ...(value ?? blank()), enabled: true }
                : value
                  ? { ...value, enabled: false }
                  : undefined,
            )
          }
          className="os-focus-ring mt-0.5 size-3.5 shrink-0 cursor-pointer accent-os-amber"
        />
        <span className="max-w-[62ch] text-[13px] leading-5 text-os-muted">
          Run this implementation and photograph it, then have Hermes compare it
          against the approved design direction. Leave this off for work with no
          screen.
        </span>
      </label>

      {enabled ? (
        <div className="mt-5 space-y-5 border-l border-os-border pl-5">
          <div>
            <SectionLabel>Routes</SectionLabel>
            {/* Said before the fields, because the second column is the one
                nobody expects and the one that does the work. */}
            <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
              Each route says where to go and which screen must come back. An
              unknown path in this app redirects to the dashboard rather than
              failing, so the page id is what catches a mistyped route.
            </p>

            {routes.length > 0 ? (
              <>
                <div className="os-meta mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-x-3 text-os-subtle">
                  <span>Path</span>
                  <span>Must render</span>
                  <span className="sr-only">Remove</span>
                </div>

                <ul className="mt-2 space-y-2">
                  {routes.map((route, index) => (
                    <li
                      key={index}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-x-3"
                    >
                      <input
                        type="text"
                        value={route.path}
                        onChange={(event) =>
                          editRoute(index, { path: event.target.value })
                        }
                        placeholder="/designs"
                        aria-label={`Route ${index + 1} path`}
                        className={INPUT}
                      />
                      <input
                        type="text"
                        value={route.expectedPageId}
                        onChange={(event) =>
                          editRoute(index, {
                            expectedPageId: event.target.value,
                          })
                        }
                        placeholder="designs"
                        aria-label={`Route ${index + 1} expected page`}
                        className={INPUT}
                      />
                      <button
                        type="button"
                        onClick={() => removeRoute(index)}
                        aria-label={`Remove route ${index + 1}`}
                        className="os-focus-ring inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-os-subtle transition-colors duration-150 hover:bg-os-surface-raised hover:text-foreground"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <button
              type="button"
              onClick={addRoute}
              className="os-focus-ring os-meta -mx-2 mt-3 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add route
            </button>

            {/* Said now rather than discovered at review time, where it comes
                back as an unverifiable verdict twenty minutes later. */}
            {problem ? (
              <p className="mt-3 max-w-[62ch] text-[13px] leading-5 text-os-warning">
                {problem}
              </p>
            ) : null}
          </div>

          <div>
            <SectionLabel>Viewports</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const on = viewports.includes(preset.name);

                return (
                  <button
                    key={preset.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleViewport(preset.name)}
                    className={cn(
                      "os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-sm border px-2.5 transition-colors duration-150",
                      on
                        ? "border-os-border-strong text-foreground"
                        : "border-os-border text-os-subtle hover:text-os-muted",
                    )}
                  >
                    {preset.name}
                    <span className="font-mono normal-case tracking-normal opacity-60">
                      {preset.width}×{preset.height}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <SectionLabel>Approved board</SectionLabel>
            <select
              value={value?.boardId ?? ""}
              onChange={(event) =>
                put({ boardId: event.target.value || undefined })
              }
              className={cn(INPUT, "mt-2 cursor-pointer")}
            >
              <option value="">None</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <SectionLabel>Design brief</SectionLabel>
            <input
              type="text"
              value={value?.designBriefPath ?? ""}
              onChange={(event) =>
                put({ designBriefPath: event.target.value.trim() || undefined })
              }
              placeholder="projects/agentos/design/BRIEF.md"
              className={cn(INPUT, "mt-2")}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

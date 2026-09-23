import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SearchHit } from "@shared/agentos-types";
import { useQuickCreate } from "@/features/workspace/quick-create-context";
import { useAgentSkills, useProjects } from "@/lib/agentos/queries";
import { projectInContext } from "./command-catalog";
import { buildActions } from "./workspace-actions";
import {
  CommandPaletteContext,
  type CommandPaletteControls,
} from "./command-palette-context";
import { CommandPalette } from "./command-palette";

/**
 * Makes the command palette available on every screen.
 *
 * The palette knows which commands exist, but not how to run them: choosing one
 * opens the agent console with the command handed over, so everything still
 * goes through the one run system rather than a second path to Hermes.
 */

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "create">("all");
  // Skills are read from Hermes, so they are not fetched until the palette is
  // actually wanted. Opening a screen still costs no Hermes request.
  const [hasOpened, setHasOpened] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const { data: projectsData } = useProjects();
  const { data: skillsData, isError: skillsUnavailable } = useAgentSkills(hasOpened);

  const open = useCallback((nextMode: "all" | "create" = "all") => {
    setHasOpened(true);
    setMode(nextMode);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      setHasOpened(true);
      setMode("all");
      setIsOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const project = projectInContext(location.pathname, location.search);

  /**
   * Hands the command to the console, which runs it through Hermes.
   *
   * The command travels as a search parameter so this works from any screen,
   * and the console consumes it once.
   */
  const run = useCallback(
    (command: string, forProject?: string) => {
      setIsOpen(false);

      const params = new URLSearchParams();
      const scope = forProject ?? project;
      if (scope) params.set("project", scope);
      params.set("run", command);

      void navigate(`/agent?${params.toString()}`);
    },
    [navigate, project],
  );

  const quickCreate = useQuickCreate();

  // Actions are rebuilt when the route or the portfolio changes, which is
  // what keeps "New task" scoped to the project on screen.
  const actions = useMemo(
    () =>
      buildActions({
        projects: projectsData?.projects ?? [],
        project,
        navigate: (to) => void navigate(to),
        quickCreate: (kind, forProject) => quickCreate.open(kind, { project: forProject }),
      }),
    [navigate, project, projectsData, quickCreate],
  );

  const openHit = useCallback((hit: SearchHit) => void navigate(hit.href), [navigate]);

  const controls = useMemo<CommandPaletteControls>(
    () => ({ open, close, isOpen }),
    [close, isOpen, open],
  );

  return (
    <CommandPaletteContext.Provider value={controls}>
      {children}
      {isOpen ? (
        <CommandPalette
          onClose={close}
          skills={skillsData?.skills}
          discovered={skillsData?.discovered ?? !skillsUnavailable}
          projects={projectsData?.projects ?? []}
          project={project}
          onRun={run}
          actions={actions}
          mode={mode}
          onOpenHit={openHit}
        />
      ) : null}
    </CommandPaletteContext.Provider>
  );
}

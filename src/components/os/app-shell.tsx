import { Menu, X, type LucideIcon } from "lucide-react";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppShellActionsContext } from "./app-shell-actions-context";
import { SystemIndicator, type SystemState } from "./system-indicator";

export interface AppShellNavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * A count worth seeing from anywhere, e.g. decisions waiting on the operator.
   *
   * Not a notification count. Absent or zero renders nothing at all — a badge
   * showing `0` is a badge people learn to ignore, and this one has to keep
   * meaning something on the day it says 3.
   */
  badge?: number;
}

export interface AppShellProps {
  children: ReactNode;
  navigationItems: AppShellNavigationItem[];
  /**
   * Which screen this is, stamped into the DOM as `data-agentos-page`.
   *
   * Deliberately not `activeHref`, and deliberately required. Four screens
   * share `/designs` in the sidebar, so the nav highlight cannot say which page
   * a person is on — and visual verification needs exactly that: it navigates
   * to a route and checks the page that came back is the one it asked for. An
   * unknown path in this app redirects to the dashboard rather than 404ing, so
   * without this a mistyped route photographs the wrong screen in silence.
   *
   * Required so that a screen added later cannot quietly be unidentifiable.
   */
  pageId: string;
  activeHref?: string;
  /** Connectivity. The shell's single connection indicator, shown in the top bar. */
  systemState?: SystemState;
  systemLabel?: string;
  /** What the agent is doing right now. Shown bottom-left. */
  agentState?: SystemState;
  agentLabel?: string;
  /** The project the workspace is currently pointed at. Shown bottom-right. */
  contextLabel?: string;
  modelLabel?: string;
  className?: string;
}

export function AppShell({
  children,
  navigationItems,
  pageId,
  activeHref,
  systemState = "online",
  systemLabel = "Hermes online",
  agentState = "idle",
  agentLabel = "Agent / idle",
  contextLabel,
  modelLabel = "Local workspace",
  className,
}: AppShellProps) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const desktopMediaQuery = window.matchMedia("(min-width: 768px)");
    const updateViewportMode = () => setIsDesktop(desktopMediaQuery.matches);
    desktopMediaQuery.addEventListener("change", updateViewportMode);
    return () => desktopMediaQuery.removeEventListener("change", updateViewportMode);
  }, []);

  useEffect(() => {
    if (!isNavigationOpen) return;
    const closeNavigationOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsNavigationOpen(false);
    };
    document.addEventListener("keydown", closeNavigationOnEscape);
    return () => document.removeEventListener("keydown", closeNavigationOnEscape);
  }, [isNavigationOpen]);

  const navigationIsAvailable = isDesktop || isNavigationOpen;
  const shellActions = useContext(AppShellActionsContext);

  return (
    <div
      className={cn(
        "os-environment grid h-dvh grid-rows-[48px_minmax(0,1fr)_40px] overflow-hidden text-foreground",
        className,
      )}
    >
      <header className="z-30 flex items-center justify-between border-b border-os-border bg-os-background/95 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsNavigationOpen((isOpen) => !isOpen)}
            className="os-focus-ring -ml-2 inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-os-muted transition-colors hover:bg-os-surface-raised hover:text-foreground md:hidden"
            aria-label={isNavigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={isNavigationOpen}
          >
            {isNavigationOpen ? (
              <X className="size-4" aria-hidden="true" />
            ) : (
              <Menu className="size-4" aria-hidden="true" />
            )}
          </button>
          <Link
            to="/"
            className="os-focus-ring inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md font-mono text-xs tracking-[0.12em] uppercase"
          >
            <span className="text-os-muted">Agent</span>
            <span className="text-os-subtle">/</span>
            <span>OS</span>
          </Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {shellActions}
          <SystemIndicator state={systemState} label={systemLabel} />
        </div>
      </header>

      <div className="relative grid min-h-0 md:grid-cols-[232px_minmax(0,1fr)]">
        {isNavigationOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-10 cursor-default bg-os-background/80 md:hidden"
            onClick={() => setIsNavigationOpen(false)}
            aria-label="Close navigation overlay"
          />
        ) : null}
        <aside
          className={cn(
            "os-navigation-drawer absolute inset-y-0 left-0 z-20 flex w-[min(82vw,232px)] flex-col border-r border-os-border bg-os-surface transition-transform duration-150 md:bg-os-surface/70",
          )}
          data-open={isNavigationOpen}
          inert={!navigationIsAvailable}
          aria-hidden={!navigationIsAvailable}
          aria-label="Primary navigation"
        >
          <nav className="flex flex-1 flex-col gap-1 p-3 pt-5">
            <span className="os-meta mb-3 px-3 text-os-subtle">Workspace</span>
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setIsNavigationOpen(false)}
                  className={cn(
                    "os-focus-ring group relative flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 font-mono text-xs tracking-[0.06em] uppercase transition-colors duration-150",
                    isActive
                      ? "bg-os-surface-raised text-foreground"
                      : "text-os-muted hover:bg-os-surface-raised/70 hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {isActive ? (
                    <span
                      className="absolute inset-y-3 left-0 w-px bg-os-amber"
                      aria-hidden="true"
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "size-4 text-os-subtle transition-colors",
                      isActive && "text-os-amber",
                    )}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span
                      className="shrink-0 rounded-sm bg-os-warning/15 px-1.5 py-0.5 text-[10px] leading-4 text-os-warning tabular-nums"
                      aria-label={`${item.badge} waiting on you`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-os-border p-4">
            <p className="os-meta text-os-subtle">System foundation</p>
            <p className="mt-2 text-xs leading-5 text-os-muted">
              V1 visual language
            </p>
          </div>
        </aside>

        <main data-agentos-page={pageId} className="min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>

      <footer className="z-30 flex items-center justify-between gap-4 border-t border-os-border bg-os-background/95 px-4 sm:px-6">
        <SystemIndicator state={agentState} label={agentLabel} />
        <div className="flex min-w-0 items-center gap-3">
          {contextLabel ? (
            <>
              <span className="os-meta hidden truncate text-os-muted sm:inline">
                {contextLabel}
              </span>
              <span
                className="hidden h-3 w-px shrink-0 bg-os-border sm:inline-block"
                aria-hidden="true"
              />
            </>
          ) : null}
          <span className="os-meta truncate text-right text-os-subtle">
            {modelLabel}
          </span>
        </div>
      </footer>
    </div>
  );
}

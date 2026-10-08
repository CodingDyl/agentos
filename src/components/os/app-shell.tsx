import { useMissionControl } from "@/lib/agentos/queries";
import { CollectiveArtwork, DecorativeTape } from "@/components/collective/collective-identity";
import { Menu, X, type LucideIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppShellActionsContext } from "./app-shell-actions-context";
import { AppShellMediaContext } from "./app-shell-media-context";
import { AppShellVoiceContext } from "./app-shell-voice-context";
import { ActiveWorkIndicator } from "./active-work-indicator";
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
  /**
   * Where the item sits. `primary` is ungrouped at the top; `work` and
   * `system` carry a label; `footer` is the quiet row of power-user links.
   * Absent reads as `primary`, so an old item list still renders.
   */
  section?: AppShellNavigationSection;
  /** Nested links shown under the item — pinned workspaces under Workspaces. */
  children?: readonly { label: string; href: string }[];
}

export type AppShellNavigationSection = "primary" | "work" | "system" | "footer";

const SECTION_LABELS: Partial<Record<AppShellNavigationSection, string>> = {
  work: "Work",
  system: "System",
};

const SECTION_ORDER: readonly AppShellNavigationSection[] = ["primary", "work", "system"];

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
  systemState,
  systemLabel,
  agentState = "idle",
  agentLabel = "Agent / idle",
  contextLabel,
  modelLabel = "Local workspace",
  className,
}: AppShellProps) {
  const connection = useMissionControl();
  const hermes = connection.data?.system.find((item) => item.id === "hermes");
  const connectionState: SystemState = connection.isError ? "offline" : !hermes ? "idle" :
    hermes.status === "offline" || hermes.status === "failed" ? "offline" :
    hermes.status === "unknown" ? "idle" : hermes.status === "attention" ? "degraded" : "online";
  const connectionLabel = connection.isError ? "Hermes unavailable" : !hermes ? "Hermes checking" :
    hermes.status === "unknown" ? "Hermes unknown" : `Hermes ${connectionState}`;
  const activeWork = connection.data?.activeWork ?? [];
  const liveCount = activeWork.filter((item) => !item.uncertain).length;
  // Most screens pass a fixed "idle"; that must not outvote work that is
  // demonstrably running. A screen with a more specific state keeps it.
  const footerAgentState: SystemState = agentState === "idle" && liveCount > 0 ? "running" : agentState;
  const footerAgentLabel = agentState === "idle" && liveCount > 0 ? `Agents / ${liveCount} running` : agentLabel;
  const navigationRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
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
    if (!isNavigationOpen || isDesktop) return;
    const drawer = navigationRef.current;
    drawer?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setIsNavigationOpen(false); }
      if (event.key !== "Tab" || !drawer) return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); navigationTriggerRef.current?.focus(); };
  }, [isNavigationOpen, isDesktop]);

  const navigationIsAvailable = isDesktop || isNavigationOpen;
  const location = useLocation();
  const shellActions = useContext(AppShellActionsContext);
  const voiceLauncher = useContext(AppShellVoiceContext);
  const media = useContext(AppShellMediaContext);

  return (
    <div
      className={cn(
        "os-environment grid grid-cols-[minmax(0,1fr)] h-dvh grid-rows-[56px_minmax(0,1fr)_32px] overflow-hidden text-foreground",
        className,
      )}
    >
      {/* The sidebar is a dozen stops long; keyboard users skip it. */}
      <a
        href="#agentos-main"
        className="os-focus-ring sr-only z-50 rounded-md bg-os-surface-raised px-3 py-2 text-[13px] text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="os-stage z-30 flex items-center justify-between border-b border-os-border bg-os-background px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            ref={navigationTriggerRef}
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
            aria-label="AgentOS home"
            className="collective-brand os-focus-ring inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-none font-paper-utility text-[15px] font-medium tracking-[0.14em] uppercase"
          >
            <span className="text-os-muted">Agent</span>
            <span className="text-os-subtle">/</span>
            <span>OS</span>
          </Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {shellActions}
          <ActiveWorkIndicator items={activeWork} />
          <SystemIndicator state={systemState ?? connectionState} label={systemLabel ?? connectionLabel} title={hermes?.detail} />
        </div>
      </header>

      {/* One row the height of the stage, so a sidebar longer than the window
          scrolls inside itself instead of running under the status bar. */}
      <div className="relative grid min-h-0 grid-rows-[minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)]">
        {isNavigationOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-10 cursor-default bg-os-background/80 md:hidden"
            onClick={() => setIsNavigationOpen(false)}
            aria-label="Close navigation overlay"
          />
        ) : null}
        <aside
          ref={navigationRef}
          role={!isDesktop && isNavigationOpen ? "dialog" : undefined}
          aria-modal={!isDesktop && isNavigationOpen ? true : undefined}
          className={cn(
            "os-stage os-navigation-drawer absolute inset-y-0 left-0 z-20 flex min-h-0 w-[min(82vw,224px)] flex-col border-r border-os-border bg-os-surface transition-transform duration-150",
          )}
          data-open={isNavigationOpen}
          inert={!navigationIsAvailable}
          aria-hidden={!navigationIsAvailable}
          aria-label="Primary navigation"
        >
          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pt-4" aria-label="Sections">
            {SECTION_ORDER.map((section) => {
              const items = navigationItems.filter((item) => (item.section ?? "primary") === section);
              if (items.length === 0) return null;

              return (
                <div key={section} className={cn("flex flex-col gap-0.5", section !== "primary" && "mt-6")}>
                  {SECTION_LABELS[section] ? (
                    <span className="os-meta mb-2 px-3 text-os-subtle">{SECTION_LABELS[section]}</span>
                  ) : null}
                  {items.map((item) => (
                    <NavigationLink
                      key={item.href}
                      item={item}
                      isActive={item.href === activeHref}
                      pathname={location.pathname}
                      onNavigate={() => setIsNavigationOpen(false)}
                    />
                  ))}
                </div>
              );
            })}
            <div className="collective-sidebar-art" aria-hidden="true"><CollectiveArtwork /><DecorativeTape /></div>
          </nav>
          {media}
          {voiceLauncher ? <div className="border-t border-os-border p-3">{voiceLauncher}</div> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-os-border px-6 py-3">
            {navigationItems
              .filter((item) => item.section === "footer")
              .map((item) => {
                const Icon = item.icon;
                const isActive = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setIsNavigationOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-none transition-colors duration-150",
                      isActive ? "text-foreground" : "text-os-subtle hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
          </div>
        </aside>

        <main inert={!isDesktop && isNavigationOpen} id="agentos-main" tabIndex={-1} data-agentos-page={pageId} className="min-w-0 overflow-y-auto outline-none">
          {children}
        </main>
      </div>

      <footer className="os-stage z-30 flex items-center justify-between gap-4 border-t border-os-border bg-os-background px-4 sm:px-6">
        <SystemIndicator state={footerAgentState} label={footerAgentLabel} />
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

function NavigationLink({
  item,
  isActive,
  pathname,
  onNavigate,
}: {
  item: AppShellNavigationItem;
  isActive: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const children = item.children ?? [];

  return (
    <>
      <Link
        to={item.href}
        onClick={onNavigate}
        className={cn(
          "os-focus-ring group relative flex min-h-10 cursor-pointer items-center gap-3 rounded-none px-3 font-paper-ui text-[14px] font-medium transition-colors duration-150",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-os-muted hover:bg-os-surface-raised/70 hover:text-foreground",
        )}
        aria-current={isActive ? "page" : undefined}
      >
        {isActive ? (
          <span className="absolute inset-y-2 left-0 w-[3px] bg-os-amber" aria-hidden="true" />
        ) : null}
        <Icon
          className={cn("size-4 transition-colors", isActive ? "text-primary-foreground" : "text-os-subtle")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge ? (
          <span
            className="shrink-0 rounded-none bg-os-warning px-1.5 py-0.5 text-[12px] leading-4 font-medium text-primary-foreground tabular-nums"
            aria-label={`${item.badge} waiting on you`}
          >
            {item.badge}
          </span>
        ) : null}
      </Link>

      {children.length > 0 ? (
        <ul className="mb-1 flex flex-col gap-px" aria-label={`Pinned ${item.label.toLowerCase()}`}>
          {children.map((child) => {
            const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <li key={child.href}>
                <Link
                  to={child.href}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "os-focus-ring flex min-h-8 cursor-pointer items-center gap-2.5 rounded-none py-1 pr-3 pl-10 text-[13.5px] leading-5 transition-colors duration-150",
                    childActive
                      ? "bg-os-surface-raised/70 text-foreground"
                      : "text-os-muted hover:bg-os-surface-raised/50 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-none", childActive ? "bg-os-amber" : "bg-os-subtle")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

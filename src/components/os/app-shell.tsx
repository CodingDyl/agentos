import { useMissionControl } from "@/lib/agentos/queries";
import { ChevronDown, Menu, X, type LucideIcon } from "lucide-react";
import { Fragment, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppShellActionsContext } from "./app-shell-actions-context";
import { AppShellMediaContext } from "./app-shell-media-context";
import { AppShellVoiceContext } from "./app-shell-voice-context";
import { ActiveWorkIndicator } from "./active-work-indicator";
import {
  COLLAPSIBLE_SECTIONS,
  SECTION_LABELS,
  breadcrumbForPath,
  expandActiveSection,
  isCollapsibleSection,
  readCollapsedSections,
  toggleCollapsedSection,
  writeCollapsedSections,
  type CollapsibleSection,
} from "./sidebar-sections";
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
   * Where the item sits. `primary` is ungrouped at the top; `business`,
   * `work`, `memory` and `operations` are collapsible labelled groups;
   * `footer` is the quiet row of power-user links. Absent reads as `primary`.
   */
  section?: AppShellNavigationSection;
  /** Nested links shown under the item — pinned workspaces under Workspaces. */
  children?: readonly { label: string; href: string }[];
}

export type AppShellNavigationSection = "primary" | "business" | "work" | "memory" | "operations" | "footer";

const SECTION_ORDER: readonly AppShellNavigationSection[] = ["primary", ...COLLAPSIBLE_SECTIONS];

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
  /** The model actually in use, when a screen knows it. Absent shows nothing. */
  modelLabel?: string;
  className?: string;
}

type ShellMode = "drawer" | "rail" | "full";

const DRAWER_QUERY = "(max-width: 639px)";
const FULL_QUERY = "(min-width: 1280px)";

function readShellMode(): ShellMode {
  if (typeof window === "undefined") return "full";
  if (window.matchMedia(DRAWER_QUERY).matches) return "drawer";
  return window.matchMedia(FULL_QUERY).matches ? "full" : "rail";
}

/** The same three widths as `.qt-shell` in agentos.css. */
function useShellMode(): ShellMode {
  const [mode, setMode] = useState<ShellMode>(readShellMode);

  useEffect(() => {
    const queries = [window.matchMedia(DRAWER_QUERY), window.matchMedia(FULL_QUERY)];
    const update = () => setMode(readShellMode());
    for (const query of queries) query.addEventListener("change", update);
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);

  return mode;
}

/** The brand: a small `>_` prompt and the wordmark. */
function BrandMark() {
  return (
    <span aria-hidden="true" className="os-mono flex size-7 shrink-0 items-center justify-center rounded-md bg-selected font-medium text-primary">
      {">_"}
    </span>
  );
}

export function AppShell({
  children,
  navigationItems,
  pageId,
  activeHref,
  systemState,
  systemLabel,
  agentState = "idle",
  agentLabel = "Agents idle",
  contextLabel,
  modelLabel,
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
  const footerAgentLabel = agentState === "idle" && liveCount > 0 ? `${liveCount} ${liveCount === 1 ? "agent" : "agents"} running` : agentLabel;
  const navigationRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const mode = useShellMode();
  const isDrawer = mode === "drawer";

  useEffect(() => {
    if (!isNavigationOpen || !isDrawer) return;
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
    const trigger = navigationTriggerRef.current;
    return () => { document.removeEventListener("keydown", onKeyDown); trigger?.focus(); };
  }, [isNavigationOpen, isDrawer]);

  const navigationIsAvailable = !isDrawer || isNavigationOpen;
  const location = useLocation();
  const shellActions = useContext(AppShellActionsContext);
  const voiceStatus = useContext(AppShellVoiceContext);
  const media = useContext(AppShellMediaContext);
  const activePath = activeHref ?? location.pathname;
  const crumbs = breadcrumbForPath(location.pathname, navigationItems);
  const [collapsedSections, setCollapsedSections] = useState<Set<CollapsibleSection>>(() =>
    typeof window === "undefined" ? new Set() : readCollapsedSections(),
  );
  const [expandedForPath, setExpandedForPath] = useState<string | undefined>(undefined);
  if (expandedForPath !== activePath) {
    setExpandedForPath(activePath);
    const next = expandActiveSection(collapsedSections, activePath, navigationItems);
    if (next !== collapsedSections) {
      setCollapsedSections(next);
      writeCollapsedSections(next);
    }
  }

  const toggleSection = (section: CollapsibleSection) => {
    setCollapsedSections((current) => {
      const next = toggleCollapsedSection(current, section);
      writeCollapsedSections(next);
      return next;
    });
  };

  const isRail = mode === "rail";
  const footerItems = navigationItems.filter((item) => item.section === "footer");

  return (
    <div className={cn("os-environment qt-shell text-foreground", className)}>
      {/* The sidebar is two dozen stops long; keyboard users skip it. */}
      <a
        href="#agentos-main"
        className="os-focus-ring sr-only z-50 rounded-md bg-os-surface-raised px-3 py-2 text-[14px] text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {isDrawer && isNavigationOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 cursor-default bg-[var(--scrim)]"
          onClick={() => setIsNavigationOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}

      <aside
        ref={navigationRef}
        role={isDrawer && isNavigationOpen ? "dialog" : undefined}
        aria-modal={isDrawer && isNavigationOpen ? true : undefined}
        data-surface="sidebar"
        className="os-stage qt-sidebar flex min-h-0 flex-col border-r border-os-border"
        data-open={isNavigationOpen}
        inert={!navigationIsAvailable}
        aria-hidden={!navigationIsAvailable}
        aria-label="Primary navigation"
      >
        <div className={cn("flex h-14 shrink-0 items-center", isRail ? "justify-center" : "px-4")}>
          {isDrawer ? (
            <span className="inline-flex items-center gap-2 text-[14px] leading-5 font-semibold">
              <BrandMark />
              AgentOS
            </span>
          ) : (
            <Link
              to="/"
              aria-label="AgentOS home"
              className="os-focus-ring inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md text-[14px] leading-5 font-semibold"
            >
              <BrandMark />
              {isRail ? null : "AgentOS"}
            </Link>
          )}
        </div>

        <nav className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto pb-3", isRail ? "items-stretch px-3" : "px-3")} aria-label="Sections">
          {SECTION_ORDER.map((section, index) => {
            const items = navigationItems.filter((item) => (item.section ?? "primary") === section);
            if (items.length === 0) return null;
            const collapsible = isCollapsibleSection(section);

            return (
              <Fragment key={section}>
                {isRail && index > 0 ? <span className="my-2 block h-px shrink-0 bg-os-border" aria-hidden="true" /> : null}
                <NavSection
                  label={collapsible && !isRail ? SECTION_LABELS[section] : undefined}
                  groupLabel={collapsible ? SECTION_LABELS[section] : undefined}
                  collapsed={collapsible ? collapsedSections.has(section) : false}
                  onToggle={collapsible && !isRail ? () => toggleSection(section) : undefined}
                  items={items}
                  activeHref={activeHref}
                  pathname={location.pathname}
                  rail={isRail}
                  onNavigate={() => setIsNavigationOpen(false)}
                />
              </Fragment>
            );
          })}
        </nav>

        {isRail ? null : media}

        <div className={cn("flex shrink-0 flex-col gap-0.5 border-t border-os-border py-2", isRail ? "px-3" : "px-3")}>
          {footerItems.map((item) => (
            <NavigationLink
              key={item.href}
              item={item}
              isActive={item.href === activeHref}
              pathname={location.pathname}
              rail={isRail}
              onNavigate={() => setIsNavigationOpen(false)}
            />
          ))}
        </div>
      </aside>

      {/* The rail has no room for a focus timer or a player, so what is playing
          floats beside it, and only while something is. */}
      {isRail ? (
        <div className="fixed bottom-9 left-[72px] z-30 w-64 rounded-lg bg-os-surface-raised shadow-[var(--shadow-overlay)] empty:hidden [&>div]:border-t-0">
          {media}
        </div>
      ) : null}

      <header className="os-stage qt-topbar z-20 flex items-center justify-between gap-3 border-b border-os-border px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            ref={navigationTriggerRef}
            onClick={() => setIsNavigationOpen((isOpen) => !isOpen)}
            className="qt-drawer-control os-focus-ring -ml-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-os-muted transition-colors duration-150 hover:bg-os-surface-raised hover:text-foreground"
            aria-label={isNavigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={isNavigationOpen}
          >
            {isNavigationOpen ? (
              <X className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-1.5 text-[14px] leading-5">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`} className={cn("flex min-w-0 items-center gap-1.5", !last && "hidden sm:flex")}>
                    {index > 0 ? <span aria-hidden="true" className="hidden text-os-subtle sm:inline">/</span> : null}
                    {last ? (
                      <span aria-current="page" className="truncate font-medium text-foreground">{crumb.label}</span>
                    ) : crumb.href ? (
                      <Link to={crumb.href} className="os-focus-ring truncate rounded-sm text-os-muted transition-colors duration-150 hover:text-foreground">{crumb.label}</Link>
                    ) : (
                      <span className="truncate text-os-muted">{crumb.label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {voiceStatus}
          <ActiveWorkIndicator items={activeWork} />
          <SystemIndicator
            state={systemState ?? connectionState}
            label={systemLabel ?? connectionLabel}
            title={hermes?.detail}
            className="max-lg:hidden"
          />
          {shellActions}
        </div>
      </header>

      <main inert={isDrawer && isNavigationOpen} id="agentos-main" tabIndex={-1} data-agentos-page={pageId} className="qt-main overflow-y-auto outline-none">
        {children}
      </main>

      <footer className="os-stage qt-statusbar z-20 flex items-center justify-between gap-4 border-t border-os-border px-4 sm:px-6">
        <span className="flex min-w-0 items-center gap-4">
          <SystemIndicator state={footerAgentState} label={footerAgentLabel} />
          {/* Below the top bar's room for it, Hermes' state moves here rather than going unsaid. */}
          <SystemIndicator
            state={systemState ?? connectionState}
            label={systemLabel ?? connectionLabel}
            title={hermes?.detail}
            className="lg:hidden"
          />
        </span>
        <span className="flex min-w-0 items-center gap-3 max-sm:hidden">
          {contextLabel ? <span className="os-mono truncate text-os-subtle">{contextLabel}</span> : null}
          {contextLabel && modelLabel ? <span className="h-3 w-px shrink-0 bg-os-border" aria-hidden="true" /> : null}
          {modelLabel ? <span className="os-mono truncate text-right text-os-subtle">{modelLabel}</span> : null}
        </span>
      </footer>
    </div>
  );
}

function NavSection({
  label,
  groupLabel,
  collapsed,
  onToggle,
  items,
  activeHref,
  pathname,
  rail,
  onNavigate,
}: {
  /** The visible, foldable heading. Absent on the rail and for the top group. */
  label?: string;
  /** The group's name for assistive tech when no heading is drawn. */
  groupLabel?: string;
  collapsed: boolean;
  onToggle?: () => void;
  items: AppShellNavigationItem[];
  activeHref?: string;
  pathname: string;
  rail: boolean;
  onNavigate: () => void;
}) {
  const panelId = useId();
  const headerId = useId();
  const open = !collapsed;
  const links = items.map((item) => (
    <NavigationLink
      key={item.href}
      item={item}
      isActive={item.href === activeHref}
      pathname={pathname}
      rail={rail}
      onNavigate={onNavigate}
    />
  ));

  if (!label || !onToggle) {
    return <div role={groupLabel ? "group" : undefined} aria-label={groupLabel} className="flex flex-col gap-0.5">{links}</div>;
  }

  return (
    <div className="mt-4 flex flex-col">
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="os-focus-ring mb-0.5 flex min-h-8 w-full cursor-pointer items-center justify-between rounded-md px-3 text-[13px] leading-5 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        <span>{label}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform duration-150", open ? "rotate-0" : "-rotate-90")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className="flex-col gap-0.5"
        style={{ display: open ? "flex" : "none" }}
      >
        {links}
      </div>
    </div>
  );
}

function NavigationLink({
  item,
  isActive,
  pathname,
  rail,
  onNavigate,
}: {
  item: AppShellNavigationItem;
  isActive: boolean;
  pathname: string;
  rail: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const children = item.children ?? [];
  // Fixed, because the sidebar's own scroll would clip anything absolute.
  const [tip, setTip] = useState<{ top: number; left: number }>();
  const showTip = (element: HTMLElement) => {
    if (!rail) return;
    const box = element.getBoundingClientRect();
    setTip({ top: box.top + box.height / 2, left: box.right + 8 });
  };
  const hideTip = () => setTip(undefined);

  return (
    <>
      <Link
        to={item.href}
        onClick={() => {
          hideTip();
          onNavigate();
        }}
        onMouseEnter={(event) => showTip(event.currentTarget)}
        onMouseLeave={hideTip}
        onFocus={(event) => showTip(event.currentTarget)}
        onBlur={hideTip}
        className={cn(
          "os-focus-ring relative flex min-h-10 shrink-0 cursor-pointer items-center rounded-md text-[14px] leading-5 font-medium transition-colors duration-150",
          rail ? "justify-center" : "gap-3 px-3",
          isActive ? "bg-selected text-foreground" : "text-os-muted hover:bg-os-surface-raised hover:text-foreground",
        )}
        aria-current={isActive ? "page" : undefined}
      >
        {isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-sm bg-primary" aria-hidden="true" /> : null}
        <Icon className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className={rail ? "sr-only" : "min-w-0 flex-1 truncate"}>{item.label}</span>
        {item.badge ? (
          rail ? (
            <span className="absolute top-1 right-1 rounded-sm bg-os-surface-active px-1 text-[12px] leading-4 font-medium text-os-warning tabular-nums" aria-label={`${item.badge} waiting on you`}>
              {item.badge}
            </span>
          ) : (
            <span className="shrink-0 rounded-sm bg-os-surface-active px-1.5 text-[13px] leading-5 font-medium text-os-warning tabular-nums" aria-label={`${item.badge} waiting on you`}>
              {item.badge}
            </span>
          )
        ) : null}
        {tip ? (
          <span
            aria-hidden="true"
            style={{ top: tip.top, left: tip.left }}
            className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md border border-os-border bg-os-surface-raised px-2 py-1 text-[13px] leading-5 whitespace-nowrap text-foreground shadow-[var(--shadow-overlay)]"
          >
            {item.label}
          </span>
        ) : null}
      </Link>

      {children.length > 0 && !rail ? (
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
                    "os-focus-ring flex min-h-8 cursor-pointer items-center rounded-md py-1 pr-3 pl-10 text-[13px] leading-5 transition-colors duration-150",
                    childActive ? "bg-os-surface-raised text-foreground" : "text-os-muted hover:bg-os-surface-raised hover:text-foreground",
                  )}
                >
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

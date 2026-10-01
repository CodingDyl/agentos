import {
  Activity,
  BookOpen,
  GraduationCap,
  Bot,
  CalendarClock,
  Gauge,
  Images,
  Inbox,
  LayoutGrid,
  Network,
  Plug,
  Sun,
  SwatchBook,
  Target,
  Wallet,
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/**
 * Primary navigation, shared by every AgentOS screen.
 *
 * Organised around the operator's work, not around the agents doing it:
 *
 * ```text
 * Today · Inbox · Traction · Finance  where the day starts, what arrived,
 *                                     the customers to go and get, and the money
 * WORK    Workspaces · Knowledge · Memory · Creative
 * SYSTEM  Automations · Connectors · Operations · Activity
 * ```
 *
 * The agent console and worker jobs are still here — under Operations, and
 * inside the workspace a job belongs to — but they are no longer the first
 * thing a person reads. They are the machinery, not the work.
 */
export const navigationItems: AppShellNavigationItem[] = [
  // `/` is where the day starts. The screen is still Mission Control
  // underneath; what it answers first is "what does today look like?".
  { label: "Today", href: "/", icon: Sun, section: "primary" },
  // An attention source, the same layer as Today — not a project tool.
  { label: "Inbox", href: "/inbox", icon: Inbox, section: "primary" },
  // Customer acquisition, at the same level as the day itself. In the work
  // list it would sit below the build and lose to it every time.
  { label: "Traction", href: "/traction", icon: Target, section: "primary" },
  // Money as its own pillar: read-only from Investec, so it can sit at the
  // same level as the day without ever being able to act on it.
  { label: "Finance", href: "/finance", icon: Wallet, section: "primary" },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid, section: "work" },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, section: "work" },
  // The Obsidian vault as a graph: notes, links, backlinks, and what agents are told.
  { label: "Memory", href: "/memory", icon: Network, section: "work" },
  // Watch, listen, research — and capture what was learned into Knowledge.
  { label: "Learning", href: "/learning", icon: GraduationCap, section: "work" },
  // Still `/designs` underneath. Creative, because product imagery, brand
  // references and client visuals are not "designs" in the interface sense.
  { label: "Creative", href: "/designs", icon: Images, section: "work" },
  { label: "Automations", href: "/automations", icon: CalendarClock, section: "system" },
  // The capability registry: which services AgentOS can reach, whether each
  // is switched on for it, and what it may do in each.
  { label: "Connectors", href: "/connectors", icon: Plug, section: "system" },
  // The infrastructure control centre: agents, usage, models, cost, system.
  { label: "Operations", href: "/operations", icon: Gauge, section: "system" },
  { label: "Activity", href: "/activity", icon: Activity, section: "system" },
  // The workers and the jobs they are busy with — kept one click away, in the
  // footer, rather than leading the main list.
  { label: "Agents", href: "/workers", icon: Bot, section: "footer" },
  { label: "Design system", href: "/design-system", icon: SwatchBook, section: "footer" },
];

import {
  Activity,
  BookOpen,
  Bot,
  CalendarClock,
  Gauge,
  Images,
  Inbox,
  LayoutGrid,
  Sun,
  SwatchBook,
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/**
 * Primary navigation, shared by every AgentOS screen.
 *
 * Organised around the operator's work, not around the agents doing it:
 *
 * ```text
 * Today · Inbox                       where the day starts, what arrived
 * WORK    Workspaces · Knowledge · Creative
 * SYSTEM  Automations · Operations · Activity
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
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid, section: "work" },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, section: "work" },
  // Still `/designs` underneath. Creative, because product imagery, brand
  // references and client visuals are not "designs" in the interface sense.
  { label: "Creative", href: "/designs", icon: Images, section: "work" },
  { label: "Automations", href: "/automations", icon: CalendarClock, section: "system" },
  // The infrastructure control centre: agents, usage, models, cost, system.
  { label: "Operations", href: "/operations", icon: Gauge, section: "system" },
  { label: "Activity", href: "/activity", icon: Activity, section: "system" },
  // The workers and the jobs they are busy with — kept one click away, in the
  // footer, rather than leading the main list.
  { label: "Agents", href: "/workers", icon: Bot, section: "footer" },
  { label: "Design system", href: "/design-system", icon: SwatchBook, section: "footer" },
];

import {
  Activity,
  BookOpen,
  Briefcase,
  BriefcaseBusiness,
  GraduationCap,
  Bot,
  CalendarClock,
  Code,
  Compass,
  Gauge,
  Images,
  Inbox,
  LayoutGrid,
  Network,
  Plug,
  Sun,
  SquareTerminal,
  Target,
  Wallet,
  Rocket,
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/**
 * Primary navigation, shared by every AgentOS screen.
 *
 * ```text
 * Dashboard · Inbox
 * BUSINESS    Business · Traction · Finance
 * WORK        Workspaces · Coder · Creative · Operator
 * MEMORY      HUB · Memory · Knowledge
 * OPERATIONS  Operations · Agents · Career · Automations · Connectors · Activity
 *             Compass stays in the quiet footer
 * ```
 *
 * Dashboard is the old Today label: same `/` route, same screen. HUB is the
 * old Learning tab: same `/learning` route. Career sits with Operations
 * because employment admin is machinery beside the agent network, not a
 * workspace.
 */
export const navigationItems: AppShellNavigationItem[] = [
  { label: "Dashboard", href: "/", icon: Sun, section: "primary" },
  { label: "Inbox", href: "/inbox", icon: Inbox, section: "primary" },
  { label: "Business", href: "/business", icon: Briefcase, section: "business" },
  { label: "Traction", href: "/traction", icon: Target, section: "business" },
  { label: "Finance", href: "/finance", icon: Wallet, section: "business" },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid, section: "work" },
  { label: "Startups", href: "/startups", icon: Rocket, section: "work" },
  { label: "Coder", href: "/coder", icon: Code, section: "work" },
  { label: "Creative", href: "/designs", icon: Images, section: "work" },
  { label: "Operator", href: "/operator", icon: SquareTerminal, section: "work" },
  { label: "HUB", href: "/learning", icon: GraduationCap, section: "memory" },
  { label: "Memory", href: "/memory", icon: Network, section: "memory" },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, section: "memory" },
  { label: "Operations", href: "/operations", icon: Gauge, section: "operations" },
  { label: "Agents", href: "/agents", icon: Bot, section: "operations" },
  { label: "Career", href: "/career", icon: BriefcaseBusiness, section: "operations" },
  { label: "Automations", href: "/automations", icon: CalendarClock, section: "operations" },
  { label: "Connectors", href: "/connectors", icon: Plug, section: "operations" },
  { label: "Activity", href: "/activity", icon: Activity, section: "operations" },
  { label: "Compass", href: "/compass", icon: Compass, section: "footer" },
];

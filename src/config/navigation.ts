import {
  Bookmark,
  BookOpen,
  Briefcase,
  GraduationCap,
  Code,
  Compass,
  Gauge,
  Images,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Music,
  PackageCheck,
  Network,
  Plug,
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
 * WORK        Workspaces · Delivery · Coder · Creative · Taste Vault · Operator
 * MEMORY      HUB · Memory · Knowledge
 * OPERATIONS  Operations · Automations · Connectors · Activity
 *             Music and Compass stay in the quiet footer
 * ```
 *
 * The structure is specified in DESIGN.md, Navigation. Dashboard is the old
 * Today label: same `/` route, same screen. HUB is the
 * old Learning tab: same `/learning` route.
 */
export const navigationItems: AppShellNavigationItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, section: "primary" },
  { label: "Inbox", href: "/inbox", icon: Inbox, section: "primary" },
  { label: "Business", href: "/business", icon: Briefcase, section: "business" },
  { label: "Traction", href: "/traction", icon: Target, section: "business" },
  { label: "Finance", href: "/finance", icon: Wallet, section: "business" },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid, section: "work" },
  { label: "Delivery", href: "/delivery", icon: PackageCheck, section: "work" },
  { label: "Startups", href: "/startups", icon: Rocket, section: "work" },
  { label: "Coder", href: "/coder", icon: Code, section: "work" },
  { label: "Creative", href: "/designs", icon: Images, section: "work" },
  { label: "Taste Vault", href: "/taste", icon: Bookmark, section: "work" },
  { label: "Operator", href: "/operator", icon: SquareTerminal, section: "work" },
  { label: "HUB", href: "/learning", icon: GraduationCap, section: "memory" },
  { label: "Memory", href: "/memory", icon: Network, section: "memory" },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, section: "memory" },
  { label: "Operations", href: "/operations", icon: Gauge, section: "operations" },
  { label: "Connectors", href: "/connectors", icon: Plug, section: "operations" },
  { label: "Music", href: "/music", icon: Music, section: "footer" },
  { label: "Compass", href: "/compass", icon: Compass, section: "footer" },
];

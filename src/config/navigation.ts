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
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/**
 * Primary navigation, shared by every AgentOS screen.
 *
 * Organised around the operator's work, not around the agents doing it:
 *
 * ```text
 * Today · Inbox · Traction · Business · Finance
 *                                     where the day starts, what arrived, the
 *                                     customers to go and get, the companies
 *                                     and clients being served, and the money
 * WORK    Operator · Workspaces · Career · Knowledge · Memory · Creative
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
  // The companies being run (Virtec, Pantry Pilot, Voxmachine) and the
  // clients each one serves; the CRM's successor.
  { label: "Business", href: "/business", icon: Briefcase, section: "primary" },
  // Money as its own pillar: read-only from Investec, so it can sit at the
  // same level as the day without ever being able to act on it.
  { label: "Finance", href: "/finance", icon: Wallet, section: "primary" },
  // The execution surface: say what you want done; it is planned against
  // Connectors, approved where it writes, run, and recorded. First in Work
  // because it is where work starts.
  { label: "Operator", href: "/operator", icon: SquareTerminal, section: "work" },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid, section: "work" },
  { label: "Coder", href: "/coder", icon: Code, section: "work" },
  // The day job: employment admin, the work log, growth and LinkedIn. Beside
  // Workspaces rather than inside them — it is not one of the businesses.
  { label: "Career", href: "/career", icon: BriefcaseBusiness, section: "work" },
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
  // Direction, goals and which project serves which: what Today plans against.
  { label: "Compass", href: "/compass", icon: Compass, section: "footer" },
  // The `/design-system` route still exists as a reference page; it is
  // deliberately not linked from the navigation.
];

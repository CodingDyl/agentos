import {
  Activity,
  Bot,
  Cpu,
  Gauge,
  CalendarClock,
  FolderKanban,
  Home,
  Images,
  Mail as MailIcon,
  SwatchBook,
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/** Primary workspace navigation, shared by every AgentOS screen. */
export const navigationItems: AppShellNavigationItem[] = [
  // The name of the screen, not of the route. `/` is where the day starts,
  // and what is there is Mission Control.
  { label: "Mission control", href: "/", icon: Home },
  // Positioned right after Mission Control: mail is an attention source, the
  // same layer as "what needs me", not a project-management tool.
  { label: "Mail", href: "/mail", icon: MailIcon },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Designs", href: "/designs", icon: Images },
  { label: "Agent", href: "/agent", icon: Bot },
  { label: "Automations", href: "/automations", icon: CalendarClock },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Workers", href: "/workers", icon: Cpu },
  // The third management layer: Mission Control asks what needs attention,
  // Projects asks what work there is, Operations asks what the workforce is
  // costing and how well it is doing.
  { label: "Operations", href: "/operations", icon: Gauge },
  { label: "Design system", href: "/design-system", icon: SwatchBook },
];

import { navigationItems } from "@/config/navigation";

/** The screen's name: the navigation entry whose address it sits under. */
export function screenTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const match = navigationItems
    .filter((item) => item.href !== "/" && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "AgentOS";
}

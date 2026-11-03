import type { ChatAgent, ChatMode } from "@shared/chat-types";
import { navigationItems } from "@/config/navigation";

/** The screen's name: the navigation entry whose address it sits under. */
export function screenTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const match = navigationItems
    .filter((item) => item.href !== "/" && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "AgentOS";
}

/**
 * Where something said to Jarvis goes when no page has taken Jarvis over.
 *
 * The ⌘J chat with Claude, which has AgentOS's own tools (mail, agenda,
 * invoices, tasks, jobs, and sending only after you confirm), whenever
 * Claude can be used. Hermes otherwise, as before.
 */
export type JarvisChatRoute = { to: "chat" } | { to: "hermes"; reason: string };

export function jarvisChatRoute({ agents, panelAvailable }: { agents: readonly ChatAgent[] | undefined; panelAvailable: boolean }): JarvisChatRoute {
  if (!panelAvailable) return { to: "hermes", reason: "The chat panel isn't available on this screen." };
  if (!agents) return { to: "hermes", reason: "The chat agents haven't loaded yet." };
  const claude = agents.find((agent) => agent.id === "claude");
  if (!claude?.available) return { to: "hermes", reason: claude?.unavailableReason ?? "Claude isn't set up for chats." };
  return { to: "chat" };
}

/**
 * The chat a request from Jarvis goes into: the panel's chat when it is a
 * Claude chat (it has the tools), otherwise a new Claude assistant chat.
 */
export function jarvisChatTarget(
  agents: readonly ChatAgent[],
  current: { agent: ChatAgent["id"] } | undefined,
): { continueCurrent: true } | { continueCurrent: false; choice: { agent: ChatAgent["id"]; model: string }; mode: ChatMode } {
  if (current?.agent === "claude") return { continueCurrent: true };
  const claude = agents.find((agent) => agent.id === "claude");
  return { continueCurrent: false, choice: { agent: "claude", model: claude?.defaultModel ?? "default" }, mode: "assistant" };
}

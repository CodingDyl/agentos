import { useMemo } from "react";
import type { AppShellNavigationItem } from "@/components/os";
import { sidebarWorkspaces, usePinnedWorkspaces } from "@/features/workspaces/workspace-preferences";
import { useAttentionCount, useMail, useProjects } from "@/lib/agentos/queries";
import { useFinance } from "@/lib/agentos/finance";
import { useTraction } from "@/lib/agentos/traction";
import { navigationItems } from "./navigation";

/**
 * The sidebar, carrying what is worth seeing from anywhere.
 *
 * A hook rather than a constant because the badges and the pinned workspaces
 * are the point: wherever you are in AgentOS, you should be able to see that
 * three decisions are waiting, or jump to the workspace you live in, without
 * navigating anywhere first. Traction's is the acquisition work still queued
 * for today; Finance's is the number of warnings about real money.
 *
 * Today's count is **decisions requiring the operator** — never a notification
 * count. Inbox's is the mail sorted into Needs you. Neither goes up because a
 * machine did some work.
 *
 * Every screen shares the same query cache entries, so the whole app costs a
 * single poll between them.
 */
export function useNavigationItems(): AppShellNavigationItem[] {
  const attention = useAttentionCount();
  const { data: mail } = useMail();
  const { data: projects } = useProjects();
  const { pinned } = usePinnedWorkspaces();
  const { data: traction } = useTraction();
  const { data: finance } = useFinance();

  const needsReply = mail?.needsYou.length ?? 0;
  const tractionQueued = traction?.queue.length ?? 0;
  // Only alerts about real money: a sample ledger never raises a badge.
  const financeWarnings = finance?.source.kind === "investec" ? finance.attention.filter((item) => item.tone === "warn").length : 0;

  const pinnedWorkspaces = useMemo(
    () =>
      sidebarWorkspaces(projects?.projects ?? [], pinned).map((project) => ({
        label: project.name,
        href: `/workspaces/${project.slug}`,
      })),
    [pinned, projects],
  );

  return useMemo(
    () =>
      navigationItems.map((item) => {
        if (item.href === "/" && attention > 0) return { ...item, badge: attention };
        if (item.href === "/inbox" && needsReply > 0) return { ...item, badge: needsReply };
        if (item.href === "/traction" && tractionQueued > 0) return { ...item, badge: tractionQueued };
        if (item.href === "/finance" && financeWarnings > 0) return { ...item, badge: financeWarnings };
        if (item.href === "/workspaces") return { ...item, children: pinnedWorkspaces };
        return item;
      }),
    [attention, needsReply, tractionQueued, financeWarnings, pinnedWorkspaces],
  );
}

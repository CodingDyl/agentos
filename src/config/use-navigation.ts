import { useMemo } from "react";
import type { AppShellNavigationItem } from "@/components/os";
import { useAttentionCount } from "@/lib/agentos/queries";
import { navigationItems } from "./navigation";

/**
 * The sidebar, carrying the count of things waiting on a person.
 *
 * A hook rather than a constant because the badge is the point: wherever you
 * are in AgentOS, you should be able to see that three decisions are waiting
 * without navigating anywhere to find out. A static nav could not do that.
 *
 * The count is **decisions requiring the operator** — never a notification
 * count. It does not go up because a machine did some work, and it goes down
 * only when somebody actually decides something. That is what makes it worth
 * looking at rather than worth dismissing.
 *
 * Every screen shares one query cache entry, so the whole app costs a single
 * poll between them.
 */
export function useNavigationItems(): AppShellNavigationItem[] {
  const attention = useAttentionCount();

  return useMemo(
    () =>
      navigationItems.map((item) =>
        item.href === "/" && attention > 0 ? { ...item, badge: attention } : item,
      ),
    [attention],
  );
}

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposioAppsResponseSchema,
  ComposioCategoriesSchema,
  ComposioConnectResponseSchema,
  ComposioToolkitPageSchema,
  type ComposioAppPatch,
  type ComposioAppsResponse,
} from "@shared/composio-types";
import { isTauri, openSiteInWindow } from "@/lib/tauri-utils";
import { AgentOSRequestError } from "./client";
import { connectorsKey } from "./connectors";

/**
 * Composio's client and queries: apps connected through one key, and the
 * catalog to connect more from. Unlike the rest of Connectors, reading these
 * does reach a service, because Composio is what knows the answer. Nothing is
 * sent until a key is set, and only the server ever holds it.
 */

export const composioAppsKey = () => [...connectorsKey(), "composio", "apps"] as const;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Composio could not be reached.", response.status);
  }
  return payload;
}

const json = (method: string, body: unknown = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function parseApps(payload: unknown): ComposioAppsResponse {
  const parsed = ComposioAppsResponseSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The apps came back in an unexpected shape.");
  return parsed.data;
}

/** Re-read on focus: a sign-in finishes on another page, and coming back is the signal that it's done. */
export function useComposioApps() {
  return useQuery({
    queryKey: composioAppsKey(),
    queryFn: async () => parseApps(await request("/api/composio/apps")),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
    networkMode: "always",
  });
}

export function useComposioToolkits(input: { search: string; category: string; enabled: boolean }) {
  return useInfiniteQuery({
    queryKey: [...connectorsKey(), "composio", "toolkits", input.search, input.category],
    enabled: input.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams();
      if (input.search) query.set("search", input.search);
      if (input.category) query.set("category", input.category);
      if (pageParam) query.set("cursor", pageParam);
      const parsed = ComposioToolkitPageSchema.safeParse(await request(`/api/composio/toolkits?${query.toString()}`));
      if (!parsed.success) throw new AgentOSRequestError("The app catalog came back in an unexpected shape.");
      return parsed.data;
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useComposioCategories(enabled: boolean) {
  return useQuery({
    queryKey: [...connectorsKey(), "composio", "categories"],
    enabled,
    queryFn: async () => {
      const parsed = ComposioCategoriesSchema.safeParse(await request("/api/composio/categories"));
      if (!parsed.success) throw new AgentOSRequestError("The categories came back in an unexpected shape.");
      return parsed.data.categories;
    },
    staleTime: 60 * 60_000,
    retry: 1,
    networkMode: "always",
  });
}

function useAppsMutation<V>(fn: (variables: V) => Promise<ComposioAppsResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (apps) => queryClient.setQueryData(composioAppsKey(), apps),
  });
}

export function useUpdateComposioApp() {
  return useAppsMutation(async ({ slug, patch }: { slug: string; patch: ComposioAppPatch }) =>
    parseApps(await request(`/api/composio/apps/${encodeURIComponent(slug)}`, json("PATCH", patch))),
  );
}

export function useDisconnectComposioAccount() {
  return useAppsMutation(async (id: string) => parseApps(await request(`/api/composio/accounts/${encodeURIComponent(id)}/disconnect`, json("POST"))));
}

/**
 * Opens Composio's sign-in page. The tab is opened before the request so the
 * browser counts it as the click's popup. Returns the address when it couldn't
 * be opened, so the screen can offer it as a link.
 */
async function openSignIn(toolkit: string, label: string | undefined): Promise<string | undefined> {
  const opened = isTauri() ? null : window.open("about:blank", "_blank");
  try {
    const parsed = ComposioConnectResponseSchema.safeParse(await request("/api/composio/connect", json("POST", { toolkit, ...(label ? { label } : {}) })));
    // Only https: this address is about to be navigated to.
    if (!parsed.success || !parsed.data.redirectUrl.startsWith("https://")) throw new AgentOSRequestError("Composio sent back an address AgentOS won't open.");
    const url = parsed.data.redirectUrl;

    if (isTauri()) {
      await openSiteInWindow(url, "Connect an app", `composio-${toolkit}`);
      return undefined;
    }
    if (!opened) return url;
    opened.opener = null;
    opened.location.href = url;
    return undefined;
  } catch (error) {
    opened?.close();
    throw error;
  }
}

export function useConnectComposioApp() {
  return useMutation({
    mutationFn: ({ toolkit, label }: { toolkit: string; label?: string }) => openSignIn(toolkit, label),
  });
}

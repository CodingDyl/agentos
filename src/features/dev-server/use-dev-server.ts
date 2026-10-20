import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actOnDevServer, getDevServer } from "@/lib/agentos/client";

const key = (slug: string) => ["agentos", "dev-server", slug] as const;

/** Polls fast while something is happening, and not at all while the server is stopped. */
export function useDevServer(slug: string) {
  return useQuery({
    queryKey: key(slug),
    queryFn: () => getDevServer(slug),
    networkMode: "always",
    retry: 0,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "installing" || status === "starting") return 800;
      if (status === "running") return 2_000;
      return false;
    },
  });
}

export function useDevServerAction(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: "start" | "stop" | "restart") => actOnDevServer(slug, action),
    onSuccess: (state) => queryClient.setQueryData(key(slug), state),
    networkMode: "always",
    retry: 0,
  });
}

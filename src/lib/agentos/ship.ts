import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DevServerStateSchema } from "@shared/dev-server-types";
import {
  ShipChangeItemSchema,
  ShipDeployStateSchema,
  ShipGitStateSchema,
  ShipSnapshotSchema,
  type ShipAddChangeRequest,
  type ShipChangeItem,
  type ShipDeployRequest,
} from "@shared/ship-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

const base = (slug: string) => `/api/projects/${encodeURIComponent(slug)}/ship`;

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS server is not responding.");
  }
  if (response.status === 204) return undefined as T;
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "Ship could not do that.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentOSRequestError("Ship returned data in an unexpected shape.");
  return parsed.data;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export const shipKeys = {
  all: () => [...agentosKeys.all, "ship"] as const,
  snapshot: (slug: string) => [...shipKeys.all(), slug] as const,
};

/** Polls only while something is moving: a dev server, an unsettled deploy, or a change with a coding agent. */
export function useShip(slug: string) {
  return useQuery({
    queryKey: shipKeys.snapshot(slug),
    queryFn: () => call(base(slug), ShipSnapshotSchema),
    enabled: Boolean(slug),
    networkMode: "always",
    retry: 0,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.dev.status === "installing" || data?.dev.status === "starting") return 1_000;
      if (data?.deploy.state && !["READY", "ERROR", "CANCELED"].includes(data.deploy.state)) return 5_000;
      if (data?.dev.status === "running") return 3_000;
      if (data?.changes.some((item) => item.status === "in_progress")) return 5_000;
      return false;
    },
  });
}

function useShipAction<TInput, TResult>(slug: string, run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    networkMode: "always",
    retry: 0,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: shipKeys.snapshot(slug) });
      await client.invalidateQueries({ queryKey: agentosKeys.project(slug) });
      await client.invalidateQueries({ queryKey: ["agentos", "dev-server", slug] });
    },
  });
}

const GitResult = z.object({ git: ShipGitStateSchema });
const GitMessageResult = z.object({ git: ShipGitStateSchema, message: z.string() });
const DevResult = z.object({ dev: DevServerStateSchema });
const DeployResult = z.object({ deploy: ShipDeployStateSchema });
const ChangeResult = z.object({ change: ShipChangeItemSchema });

export function useInitShipRepo(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/git/init`, GitResult, post()));
}

export function useLinkShipRepo(slug: string) {
  return useShipAction(slug, (repo: string) => call(`${base(slug)}/git/link`, GitResult, post({ repo })));
}

export function useCreateShipRepo(slug: string) {
  return useShipAction(slug, (input: { name?: string; confirmProduction?: string }) => call(`${base(slug)}/git/create`, GitResult, post(input)));
}

export function usePullShipRepo(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/git/pull`, GitMessageResult, post()));
}

export function usePushShipRepo(slug: string) {
  return useShipAction(slug, (input: { confirmProduction?: string }) => call(`${base(slug)}/git/push`, GitMessageResult, post(input)));
}

export function useStartShipDev(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/dev/start`, DevResult, post()));
}

export function useStopShipDev(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/dev/stop`, DevResult, post()));
}

export function useLinkShipVercel(slug: string) {
  return useShipAction(slug, (projectId: string) => call(`${base(slug)}/deploy/link`, DeployResult, post({ projectId })));
}

export function useCreateShipVercel(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/deploy/create`, DeployResult, post()));
}

export function useShipDeploy(slug: string) {
  return useShipAction(slug, (request: ShipDeployRequest) => call(`${base(slug)}/deploy`, DeployResult, post(request)));
}

export function useAddShipChange(slug: string) {
  return useShipAction(slug, (input: ShipAddChangeRequest) => call(`${base(slug)}/changes`, ChangeResult, post(input)));
}

export function usePatchShipChange(slug: string) {
  return useShipAction(slug, ({ id, ...patch }: { id: string } & Partial<Pick<ShipChangeItem, "selected" | "status" | "priority" | "text">>) =>
    call(`${base(slug)}/changes/${encodeURIComponent(id)}`, ChangeResult, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export function useDeleteShipChange(slug: string) {
  return useShipAction(slug, (id: string) => call(`${base(slug)}/changes/${encodeURIComponent(id)}`, z.undefined(), { method: "DELETE" }));
}

export function useSendShipChanges(slug: string) {
  return useShipAction(slug, (ids: string[]) =>
    call(`${base(slug)}/changes/send`, z.object({ jobId: z.string(), href: z.string(), objective: z.string(), changes: z.array(ShipChangeItemSchema) }), post({ ids })),
  );
}

export function shipScreenshotUrl(slug: string, id: string): string {
  return `${base(slug)}/changes/${encodeURIComponent(id)}/screenshot`;
}

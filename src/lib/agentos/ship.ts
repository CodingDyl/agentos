import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ShipChangeItemSchema,
  ShipDeployStateSchema,
  ShipDevStateSchema,
  ShipGitStateSchema,
  ShipSnapshotSchema,
  type ShipAddChangeRequest,
  type ShipChangeItem,
  type ShipDeployTarget,
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

const json = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export const shipKeys = {
  all: () => [...agentosKeys.all, "ship"] as const,
  snapshot: (slug: string) => [...shipKeys.all(), slug] as const,
};

export function useShip(slug: string) {
  return useQuery({
    queryKey: shipKeys.snapshot(slug),
    queryFn: () => call(base(slug), ShipSnapshotSchema),
    enabled: Boolean(slug),
    networkMode: "always",
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.dev.status === "installing" || data?.dev.status === "starting" || data?.dev.status === "running") return 1_500;
      if (data?.deploy.state && !["READY", "ERROR", "CANCELED"].includes(data.deploy.state)) return 5_000;
      if (data?.changes.some((item) => item.status === "in_progress")) return 4_000;
      return false;
    },
  });
}

function useShipAction<TInput>(slug: string, run: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: shipKeys.snapshot(slug) });
      await client.invalidateQueries({ queryKey: agentosKeys.project(slug) });
    },
  });
}

export function useInitShipRepo(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/git/init`, z.object({ git: ShipGitStateSchema }), json()));
}

export function useLinkShipRepo(slug: string) {
  return useShipAction(slug, (repo: string) => call(`${base(slug)}/git/link`, z.object({ git: ShipGitStateSchema }), json({ repo })));
}

export function useCreateShipRepo(slug: string) {
  return useShipAction(slug, (input: { name?: string }) => call(`${base(slug)}/git/create`, z.object({ git: ShipGitStateSchema }), json(input)));
}

export function usePullShipRepo(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/git/pull`, z.object({ git: ShipGitStateSchema, message: z.string() }), json()));
}

export function usePushShipRepo(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/git/push`, z.object({ git: ShipGitStateSchema, message: z.string() }), json()));
}

export function useStartShipDev(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/dev/start`, z.object({ dev: ShipDevStateSchema }), json()));
}

export function useStopShipDev(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/dev/stop`, z.object({ dev: ShipDevStateSchema }), json()));
}

export function useLinkShipVercel(slug: string) {
  return useShipAction(slug, (input: { projectId: string; projectName?: string }) =>
    call(`${base(slug)}/deploy/link`, z.object({ deploy: ShipDeployStateSchema }), json(input)),
  );
}

export function useCreateShipVercel(slug: string) {
  return useShipAction(slug, () => call(`${base(slug)}/deploy/create`, z.object({ deploy: ShipDeployStateSchema }), json()));
}

export function useShipDeploy(slug: string) {
  return useShipAction(slug, (target: ShipDeployTarget) => call(`${base(slug)}/deploy`, z.object({ deploy: ShipDeployStateSchema }), json({ target })));
}

export function useAddShipChange(slug: string) {
  return useShipAction(slug, (input: ShipAddChangeRequest) => call(`${base(slug)}/changes`, z.object({ change: ShipChangeItemSchema }), json(input)));
}

export function usePatchShipChange(slug: string) {
  return useShipAction(slug, (input: { id: string } & Partial<ShipChangeItem>) =>
    call(`${base(slug)}/changes/${encodeURIComponent(input.id)}`, z.object({ change: ShipChangeItemSchema }), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export function useDeleteShipChange(slug: string) {
  return useShipAction(slug, (id: string) =>
    call(`${base(slug)}/changes/${encodeURIComponent(id)}`, z.undefined(), { method: "DELETE" }),
  );
}

export function useSendShipChanges(slug: string) {
  return useShipAction(slug, (ids?: string[]) =>
    call(
      `${base(slug)}/changes/send`,
      z.object({ jobId: z.string(), href: z.string(), objective: z.string(), changes: z.array(ShipChangeItemSchema) }),
      json({ ids }),
    ),
  );
}

export function shipScreenshotUrl(slug: string, id: string): string {
  return `${base(slug)}/changes/${encodeURIComponent(id)}/screenshot`;
}

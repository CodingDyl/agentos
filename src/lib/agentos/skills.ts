import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  MarketplaceInstallResultSchema,
  MarketplacePreviewSchema,
  MarketplaceUpdateResultSchema,
  SkillParseResultSchema,
  SkillSummarySchema,
  SkillsResponseSchema,
  type MarketplaceInstallInput,
  type SkillDraftInput,
  type SkillSummary,
} from "@shared/skill-types";
import { AgentOSRequestError } from "./client";

const key = ["agentos-skills"] as const;

async function call<T>(
  url: string,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
  body?: unknown,
  method: "POST" | "PUT" | "DELETE" = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      url,
      body === undefined && method === "POST"
        ? undefined
        : { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) },
    );
  } catch {
    throw new AgentOSRequestError("The AgentOS server is not responding.");
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The skills request failed.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = parse(value);
  if (!parsed.success) throw new AgentOSRequestError("The skills answer was not what AgentOS expected.");
  return parsed.data;
}

export function useSkills() {
  return useQuery({
    queryKey: key,
    queryFn: () => call("/api/skills", (value) => SkillsResponseSchema.safeParse(value)),
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useSetSkillEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      call(`/api/skills/${encodeURIComponent(id)}/enabled`, (value) => SkillSummarySchema.safeParse(value), { enabled }),
    onSuccess: (skill: SkillSummary) => {
      client.setQueryData(key, (current: { skills: SkillSummary[] } | undefined) =>
        current ? { skills: current.skills.map((entry) => (entry.id === skill.id ? { ...entry, enabled: skill.enabled } : entry)) } : current,
      );
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Adds a skill, or saves an edit to one added here (`id` set). */
export function useSaveSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id?: string; draft: SkillDraftInput }) =>
      id
        ? call(`/api/skills/${encodeURIComponent(id)}`, (value) => SkillSummarySchema.safeParse(value), draft, "PUT")
        : call("/api/skills", (value) => SkillSummarySchema.safeParse(value), draft),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(`/api/skills/${encodeURIComponent(id)}`, (value) => z.object({ ok: z.literal(true) }).safeParse(value), undefined, "DELETE"),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    networkMode: "always",
    retry: 0,
  });
}

/** Reads an uploaded SKILL.md into the form. Saves nothing. */
export function useParseSkill() {
  return useMutation({
    mutationFn: (markdown: string) => call("/api/skills/parse", (value) => SkillParseResultSchema.safeParse(value), { markdown }),
    networkMode: "always",
    retry: 0,
  });
}

/** Reads a GitHub repo's skills for review. Installs nothing. */
export function usePreviewMarketplaceRepo() {
  return useMutation({
    mutationFn: (repo: string) => call("/api/skills/marketplace/preview", (value) => MarketplacePreviewSchema.safeParse(value), { repo }),
    networkMode: "always",
    retry: 0,
  });
}

/** Installs the picked skills from the commit that was reviewed. */
export function useInstallMarketplaceSkills() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MarketplaceInstallInput) =>
      call("/api/skills/marketplace/install", (value) => MarketplaceInstallResultSchema.safeParse(value), input),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    networkMode: "always",
    retry: 0,
  });
}

/** Pulls a marketplace skill's branch again; replaces it only if the branch moved. */
export function useUpdateMarketplaceSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(`/api/skills/${encodeURIComponent(id)}/update`, (value) => MarketplaceUpdateResultSchema.safeParse(value), {}),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    networkMode: "always",
    retry: 0,
  });
}

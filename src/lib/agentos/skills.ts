import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SkillSummarySchema, SkillsResponseSchema, type SkillSummary } from "@shared/skill-types";
import { AgentOSRequestError } from "./client";

const key = ["agentos-skills"] as const;

async function call<T>(url: string, parse: (value: unknown) => { success: true; data: T } | { success: false }, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

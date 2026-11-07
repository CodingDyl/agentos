import { useQuery } from "@tanstack/react-query";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** How the evals have scored. Read only: nothing here starts one. */

export interface EvalRunView {
  at: string;
  suite: string;
  commit: string;
  passed: number;
  total: number;
}

export interface EvalHistoryView {
  runs: EvalRunView[];
  latest: EvalRunView | null;
  comparison: { verdict: "better" | "worse" | "same" | "first"; line: string };
}

export function useEvalHistory(suite = "mail") {
  return useQuery({
    queryKey: [...agentosKeys.all, "evals", suite] as const,
    queryFn: async (): Promise<EvalHistoryView> => {
      let response: Response;
      try {
        response = await fetch(`/api/evals/history?suite=${encodeURIComponent(suite)}`);
      } catch {
        throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
      }
      if (!response.ok) throw new AgentOSRequestError("The eval history could not be read.", response.status);
      return (await response.json()) as EvalHistoryView;
    },
    networkMode: "always",
    retry: 0,
  });
}

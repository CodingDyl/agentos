import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { CalendarRangeSchema, CalendarTasksResponseSchema, type CalendarEventInput, type CalendarTaskInput } from "@shared/calendar-types";
import { CalendarEventSchema } from "@shared/today-types";
import { agentosKeys } from "./queries";

async function calendarCall<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/calendar${path}`, init);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error((payload as { error?: string })?.error ?? "Calendar request failed. Try refreshing.");
  return schema.parse(payload);
}
const body = (method: string, input: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
const calendarKey = [...agentosKeys.all, "calendar"] as const;
export function useCalendarRange(from: string, to: string) {
  return useQuery({ queryKey: [...calendarKey, from, to], queryFn: () => calendarCall(`/events?${new URLSearchParams({ from, to })}`, CalendarRangeSchema), staleTime: 30_000, refetchInterval: 60_000, retry: 0 });
}
export function useCalendarTasks() {
  return useQuery({ queryKey: [...calendarKey, "tasks"], queryFn: () => calendarCall("/tasks", CalendarTasksResponseSchema), staleTime: 15_000, refetchInterval: 60_000, retry: 0 });
}
export function useCalendarSuggestions(id: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: [...calendarKey, "suggestions", id], queryFn: () => calendarCall(`/events/${encodeURIComponent(id!)}/suggestions`, z.object({ suggestions: z.array(z.string()) })), enabled: Boolean(id) && enabled, retry: 0 });
}
function useCalendarMutation<V, R>(mutationFn: (input: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, retry: 0, onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: agentosKeys.all });
  } });
}
export function useSaveCalendarEvent() {
  return useCalendarMutation(({ id, etag, input }: { id?: string; etag?: string; input: CalendarEventInput }) => calendarCall(id ? `/events/${encodeURIComponent(id)}` : "/events", CalendarEventSchema, body(id ? "PATCH" : "POST", { ...input, etag })));
}
export function useSaveCalendarTask() {
  return useCalendarMutation((input: CalendarTaskInput) => calendarCall("/tasks", z.object({ taskId: z.string() }), body("POST", input)));
}

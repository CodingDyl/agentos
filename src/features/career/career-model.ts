import { PAPER_INPUT } from "@/components/paper";
import { cn } from "@/lib/utils";
import type { CareerTab } from "./career-types-ui";

export const CAREER_TAB_OPTIONS: readonly { value: CareerTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "tasks", label: "Tasks" },
  { value: "routines", label: "Routines" },
  { value: "work-log", label: "Work log" },
  { value: "growth", label: "Growth" },
  { value: "linkedin", label: "LinkedIn" },
];

export function isCareerTab(value: string | null): value is CareerTab {
  return CAREER_TAB_OPTIONS.some((tab) => tab.value === value);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** `5 Oct`, from a local `YYYY-MM-DD`. */
export function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One non-empty trimmed line per item. */
export function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
}

/** Local `YYYY-MM-DD`. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export const TEXTAREA = cn(PAPER_INPUT, "min-h-24 w-full py-2 leading-6");

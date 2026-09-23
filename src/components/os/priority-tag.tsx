import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type Priority = "high" | "medium" | "low";

/**
 * Priority is carried by its own word, never by tone alone. Tone only
 * reinforces the ranking that the label already states.
 */
const priorityTone: Record<Priority, string> = {
  high: "text-foreground",
  medium: "text-os-muted",
  low: "text-os-subtle",
};

export interface PriorityTagProps extends HTMLAttributes<HTMLSpanElement> {
  priority: Priority;
}

export function PriorityTag({
  priority,
  className,
  ...props
}: PriorityTagProps) {
  return (
    <span
      className={cn("os-meta", priorityTone[priority], className)}
      data-priority={priority}
      {...props}
    >
      <span className="sr-only">Priority: </span>
      {priority}
    </span>
  );
}

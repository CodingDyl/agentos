import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";

/** A small label above a group, in the paper world: sage, sentence case, never mono. */
export function TodayLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12.5px] font-medium text-paper-sage", className)}>{children}</p>;
}

/** A section's "go to the full page" link: quiet until hovered. */
export function TodayLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "-mx-1 inline-flex min-h-8 items-center gap-1 rounded-none px-1.5 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
        PAPER_FOCUS,
      )}
    >
      {children}
    </Link>
  );
}

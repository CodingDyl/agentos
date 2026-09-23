import { ArrowUpRight } from "lucide-react";
import type { HTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { HairlineCard } from "./hairline-card";
import { SectionLabel } from "./section-label";
import { StatusPill, type AgentStatus } from "./status-pill";

export interface ProjectCardProps extends HTMLAttributes<HTMLElement> {
  name: string;
  status: AgentStatus;
  priority?: "High" | "Medium" | "Low";
  summary: string;
  lastActivity?: string;
  to?: string;
}

export function ProjectCard({
  name,
  status,
  priority,
  summary,
  lastActivity,
  to,
  className,
  ...props
}: ProjectCardProps) {
  return (
    <article className={cn("group", className)} {...props}>
      <HairlineCard interactive className="h-full p-5 md:p-6">
        <SectionLabel action={priority ? `${priority} priority` : undefined}>
          Project
        </SectionLabel>
        <div className="mt-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-base leading-5 font-medium">{name}</h3>
            <p className="mt-2 text-[13px] leading-5 text-os-muted">{summary}</p>
          </div>
          <StatusPill status={status} />
        </div>
        <div className="mt-8 flex min-h-6 items-center justify-between gap-4 border-t border-os-border pt-4">
          <span className="os-meta text-os-subtle">
            {lastActivity ?? "No recent activity"}
          </span>
          {to ? (
            <Link
              to={to}
              className="os-focus-ring -m-2 inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md text-os-muted transition-colors duration-150 hover:text-foreground"
              aria-label={`Open ${name}`}
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </HairlineCard>
    </article>
  );
}

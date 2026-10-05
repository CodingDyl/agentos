import type { RebuildStageStatus } from "@shared/website-rebuild-types";
import { Tag } from "@/components/paper";

const LABEL: Record<RebuildStageStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_approval: "Needs your review",
  blocked: "Blocked",
  complete: "Complete",
};

const TONE: Record<RebuildStageStatus, "muted" | "blue" | "marigold" | "flame" | "green"> = {
  not_started: "muted",
  in_progress: "blue",
  awaiting_approval: "marigold",
  blocked: "flame",
  complete: "green",
};

export function StageStatusTag({ status }: { status: RebuildStageStatus }) {
  return <Tag tone={TONE[status]}>{LABEL[status]}</Tag>;
}

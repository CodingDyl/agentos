import { Link } from "react-router-dom";
import { PAPER_FOCUS, PaperIndicator, PaperSection, Tag } from "@/components/paper";
import { ideaHref, ideaStatus } from "@/features/video-ideas/idea-model";
import { useVideoIdeas } from "@/lib/agentos/video-ideas";
import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type VideoIdea } from "@shared/video-ideas-types";
import { TodayLink } from "./today-kit";

const VERDICT_TAG = { adopt: "green", adapt: "marigold", skip: "muted" } as const;

/** Ideas waiting on Approve or Decline first, then the ones being planned, built or stopped. */
export function selectIdeas(ideas: readonly VideoIdea[]): { deciding: VideoIdea[]; moving: VideoIdea[] } {
  const assessed = ideas.filter((idea) => idea.mode === "assess");
  return {
    deciding: assessed.filter((idea) => idea.stage === "awaiting_decision"),
    moving: assessed.filter((idea) => idea.stage === "planning" || idea.stage === "building" || (idea.stage === "failed" && Boolean(idea.verdict))),
  };
}

/**
 * Videos checked against AgentOS. Hidden on a day with nothing to decide and
 * nothing being built.
 */
export function IdeasToDecide({ className }: { className?: string }) {
  const ideas = useVideoIdeas();
  const { deciding, moving } = selectIdeas(ideas.data ?? []);
  if (deciding.length === 0 && moving.length === 0) return null;

  return (
    <PaperSection label="Ideas to decide" count={deciding.length || undefined} className={className} action={<TodayLink to="/learning?tab=youtube">Learning</TodayLink>}>
      <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
        {deciding.map((idea) => (
          <li key={idea.id}>
            <Link to={ideaHref(idea)} className={cn("block px-4 py-3 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}>
              <span className="flex min-w-0 items-center gap-2">
                {idea.verdict ? <Tag tone={VERDICT_TAG[idea.verdict]}>{VERDICT_LABELS[idea.verdict]}</Tag> : null}
                <span className="min-w-0 truncate text-[14px] font-medium text-paper-moss">{idea.title}</span>
              </span>
              {idea.verdictWhy ? <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-paper-char">{idea.verdictWhy}</span> : null}
              {idea.size ? <span className="mt-0.5 block text-[12px] text-paper-sage">{idea.size} change</span> : null}
            </Link>
          </li>
        ))}
        {moving.map((idea) => (
          <li key={idea.id}>
            <Link to={ideaHref(idea)} className={cn("flex min-w-0 flex-col gap-0.5 px-4 py-2.5 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}>
              <span className="truncate text-[14px] text-paper-moss">{idea.title}</span>
              <PaperIndicator {...ideaStatus(idea)} />
            </Link>
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}

import { X } from "lucide-react";
import { PaperButton } from "@/components/paper";
import { IdeaProgress } from "@/features/video-ideas/idea-progress";
import { useStartIdea, useVideoIdeaReadiness } from "@/lib/agentos/video-ideas";
import type { LearningSource } from "@shared/learning-types";
import type { IdeaMode, VideoIdea } from "@shared/video-ideas-types";

/**
 * Asked once, right after a video is saved: just a note, or a note and a
 * check against AgentOS. "Not now" keeps it a saved video and nothing more.
 */
export function LearnChoice({ source, idea, onDone }: { source: LearningSource; idea?: VideoIdea; onDone: () => void }) {
  const start = useStartIdea();
  const readiness = useVideoIdeaReadiness();
  const missing = readiness.data?.missing ?? [];
  // The started idea shows at once, before the list refetches it.
  const current = idea ?? start.data?.idea;
  // Only offered for a note that was already done when this opened, never for one just made here.
  const upgrading = !start.isSuccess && current?.mode === "learn" && current.stage === "noted";

  if (current && !upgrading) {
    return (
      <div className="relative mt-3">
        <IdeaProgress idea={current} />
        <div className="absolute top-2 right-2">
          <DismissButton onClick={onDone} />
        </div>
      </div>
    );
  }

  const choose = (mode: IdeaMode) => start.mutate({ sourceId: source.id, mode });

  return (
    <div role="group" aria-label={`What to do with ${source.title}`} className="mt-3 border border-paper-mist bg-paper-cream px-4 py-3">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[13.5px] leading-6 text-paper-char">
          {upgrading ? (
            <>
              <span className="font-medium text-paper-moss">You have a note for this one.</span> Check it against AgentOS too?
            </>
          ) : (
            <>
              <span className="font-medium text-paper-moss">Learn from “{source.title}”?</span> A note with the brief, the 20% that explains the rest, and a
              plain-words version, tagged learning.
            </>
          )}
        </p>
        <DismissButton onClick={onDone} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {upgrading ? null : (
          <PaperButton variant="ghost" disabled={start.isPending || missing.length > 0} onClick={() => choose("learn")}>
            Just learn it
          </PaperButton>
        )}
        <PaperButton variant="amber" disabled={start.isPending || missing.length > 0} onClick={() => choose("assess")}>
          {upgrading ? "Check it against AgentOS" : "Learn it and check it against AgentOS"}
        </PaperButton>
        <PaperButton variant="quiet" onClick={onDone}>
          Not now
        </PaperButton>
      </div>
      {missing.length > 0 ? <p className="mt-2 text-[12.5px] text-paper-flame-deep">{missing.join(" ")}</p> : null}
      {start.error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">
          {start.error.message}
        </p>
      ) : null}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-linen hover:text-paper-moss"
    >
      <X className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

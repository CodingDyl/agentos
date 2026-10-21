import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { STARTUP_STAGES } from "@shared/startup-types";
import { DedsecLoader } from "@/components/os";
import { PAPER_FOCUS, PaperCard, PaperEmpty, PaperError, Tag } from "@/components/paper";
import { useVenture, useVentureForWorkspace } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";

/**
 * A workspace that graduated from a venture: where it is on the road, the
 * MVP contract it must stick to, and what was parked. The venture page is
 * where stages are worked; this tab keeps the contract in view while building.
 */
export function StartupTab({ workspace }: { workspace: string }) {
  const linked = useVentureForWorkspace(workspace);
  const detail = useVenture(linked.data?.slug ?? "");

  if (linked.isPending || (linked.data && detail.isPending)) return <DedsecLoader variant="compact" />;
  if (linked.error || detail.error) {
    return <PaperError headingLevel="h2" title="The venture could not be read." detail={(linked.error ?? detail.error)?.message ?? ""} onRetry={() => void linked.refetch()} isRetrying={linked.isFetching} />;
  }
  if (!linked.data || !detail.data) return <PaperEmpty title="This workspace did not start as a venture." description="Ventures from the Startups page become workspaces once their MVP is agreed." />;

  const { venture, stages, later, scores } = detail.data;
  const mvp = stages.mvp;
  const stageIndex = STARTUP_STAGES.findIndex((stage) => stage.id === venture.stage);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-paper-mist pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tag tone="blue">Stage {stageIndex + 1}: {STARTUP_STAGES[stageIndex]?.label}</Tag>
          {scores.at(-1) ? <Tag tone="green">Validity {scores.at(-1)!.total}/10</Tag> : null}
        </div>
        <Link to={`/startups/${venture.slug}`} className={cn("inline-flex min-h-8 items-center gap-1.5 px-2 text-[13.5px] font-medium text-paper-blue hover:bg-paper-stone", PAPER_FOCUS)}>
          Open the venture
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {mvp ? (
        <PaperCard className="p-6">
          <h3 className="font-paper-display text-[17px] font-bold text-paper-moss">The MVP contract</h3>
          <dl className="mt-4 grid gap-4 text-[14px] leading-6 text-paper-char sm:grid-cols-2">
            <div>
              <dt className="text-[12.5px] font-medium text-paper-sage">Target user</dt>
              <dd>{mvp.targetUser}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] font-medium text-paper-sage">Success metric</dt>
              <dd>{mvp.successMetric}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[12.5px] font-medium text-paper-sage">Core workflow</dt>
              <dd>
                <ol className="list-decimal pl-5">
                  {mvp.coreWorkflow.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </dd>
            </div>
            <div>
              <dt className="text-[12.5px] font-medium text-paper-sage">Kill criteria</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {mvp.killCriteria.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="text-[12.5px] font-medium text-paper-sage">Parked for later</dt>
              <dd>{later.length + mvp.outOfScope.length} items. Check new ideas with the scope guard on the venture page.</dd>
            </div>
          </dl>
        </PaperCard>
      ) : null}
    </div>
  );
}

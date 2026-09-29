import { Link } from "react-router-dom";
import type { DesignGeneration } from "@shared/design-generation-types";
import type { DesignAsset } from "@shared/agentos-types";
import { AppShell } from "@/components/os";
import {
  PAPER_FOCUS,
  PaperBackLink,
  PaperCard,
  PaperEmpty,
  PaperError,
  PaperLoading,
  PaperPageHeader,
  PaperSection,
  PaperStage,
  Tag,
} from "@/components/paper";
import { cn } from "@/lib/utils";
import { useNavigationItems } from "@/config/use-navigation";
import { useDesignGenerations, useDesignLibrary } from "@/lib/agentos/queries";

/**
 * Every generation, and what it made.
 *
 * The library shows concepts; this shows the *asking*. Which is the half worth
 * keeping: an image you like is only useful if you can find the prompt and the
 * references that produced it, and go round again from there.
 *
 * Grouped by day rather than listed flat, because design exploration happens in
 * sittings — what you want to find is "the afternoon I was working on Chef",
 * not the four hundredth item in a list.
 */

/** Day headings a person would actually use. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Undated";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function groupByDay(
  generations: DesignGeneration[],
): { day: string; entries: DesignGeneration[] }[] {
  const days = new Map<string, DesignGeneration[]>();

  for (const generation of generations) {
    const label = dayLabel(generation.createdAt);
    days.set(label, [...(days.get(label) ?? []), generation]);
  }

  return [...days.entries()].map(([day, entries]) => ({ day, entries }));
}

export function GenerationsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useDesignGenerations();
  const { data: library } = useDesignLibrary();

  const generations = data?.generations ?? [];

  const assets = new Map<string, DesignAsset>(
    (library?.assets ?? []).map((asset) => [asset.id, asset]),
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="design-generations"
      activeHref="/designs"
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        <PaperBackLink to="/designs">Creative</PaperBackLink>

        <PaperPageHeader
          className="mt-3"
          title="Generations"
          description="What was asked for, and what came back."
        />

        {isPending ? (
          <PaperLoading title="Generations" message="Reading what has been generated…" className="mt-8" />
        ) : error ? (
          <PaperError
            headingLevel="h2"
            title="The generation history could not be read."
            detail={error.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
            className="mt-8"
          />
        ) : generations.length === 0 ? (
          <PaperEmpty
            title="No generations yet"
            description="Concepts you generate from the library will be recorded here, with the prompt and references that made them."
            className="mt-8"
          />
        ) : (
          <div className="mt-8 space-y-10">
            {groupByDay(generations).map(({ day, entries }) => (
              <PaperSection key={day} label={day} count={entries.length}>
                <div className="space-y-4">
                  {entries.map((generation) => (
                    <GenerationRow
                      key={generation.id}
                      generation={generation}
                      assets={assets}
                    />
                  ))}
                </div>
              </PaperSection>
            ))}
          </div>
        )}
      </PaperStage>
    </AppShell>
  );
}

function GenerationRow({
  generation,
  assets,
}: {
  generation: DesignGeneration;
  assets: Map<string, DesignAsset>;
}) {
  const failed = generation.status === "failed";

  const results = generation.results
    .map((result) => assets.get(result.assetId))
    .filter((asset): asset is DesignAsset => asset !== undefined);

  return (
    <PaperCard className="p-5">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="max-w-[62ch] text-[15px] leading-6 text-paper-moss">
              {generation.request.prompt}
            </p>
            <p className="mt-1.5 text-[12.5px] text-paper-sage">
              {generation.request.project ?? "No project"}
              {generation.request.aspectRatio
                ? ` · ${generation.request.aspectRatio}`
                : ""}
              {generation.promptBy === "hermes" ? " · prompt by Hermes" : ""}
            </p>
          </div>
          <Tag tone={failed ? "flame" : "green"}>
            {failed
              ? "Failed"
              : `${generation.results.length} output${
                  generation.results.length === 1 ? "" : "s"
                }`}
          </Tag>
        </div>

        {/* Why it failed, kept where the attempt is. A history that recorded
            only successes would lose the reason the same thing keeps failing. */}
        {generation.error ? (
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
            {generation.error}
          </p>
        ) : null}

        {results.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {results.map((asset) => (
              <Link
                key={asset.id}
                to={`/designs?asset=${encodeURIComponent(asset.id)}`}
                className={cn("rounded-[4px]", PAPER_FOCUS)}
                aria-label={`Open ${asset.filename}`}
              >
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.filename}
                  className="size-20 rounded-[4px] object-cover ring-1 ring-paper-mist transition-[box-shadow] duration-150 hover:ring-paper-sage"
                />
              </Link>
            ))}
          </div>
        ) : null}

        {/* The rendered prompt, when it differs from what was typed. */}
        {generation.finalPrompt &&
        generation.finalPrompt !== generation.request.prompt ? (
          <div className="mt-4 border-t border-paper-mist pt-4">
            <h3 className="text-[13px] font-semibold text-paper-moss">Rendered prompt</h3>
            <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
              {generation.finalPrompt}
            </p>
          </div>
        ) : null}
      </div>
    </PaperCard>
  );
}

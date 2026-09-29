import { ExternalLink, MessageSquare, Star } from "lucide-react";
import type { NewsItem, TrendingRepo } from "@shared/today-types";
import { PAPER_FOCUS, PaperSection } from "@/components/paper";
import { formatRelativeTime } from "@/lib/format";
import { useTodayNews, useTodayTrending } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * Today's outside world: what the AI and tech press is running, and which new
 * repositories GitHub is talking about. Both are read on their own, so a slow
 * feed never holds up the day, and both say quietly what they couldn't read.
 */

const LINK = cn("rounded-[2px] hover:underline decoration-paper-gold underline-offset-4", PAPER_FOCUS);

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function NewsRow({ item }: { item: NewsItem }) {
  const when = formatRelativeTime(item.publishedAt);
  return (
    <li className="min-w-0 px-4 py-2.5">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className={cn("block text-[14px] leading-5 font-medium text-paper-moss", LINK)}>
        {item.title}
      </a>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-paper-sage">
        <span>{item.source}</span>
        {when ? <span>{when}</span> : null}
        {item.points !== undefined ? <span className="tabular-nums">{item.points} points</span> : null}
        {item.discussionUrl ? (
          <a
            href={item.discussionUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Discussion of ${item.title} on Hacker News`}
            className={cn("inline-flex items-center gap-1 hover:text-paper-moss", PAPER_FOCUS)}
          >
            <MessageSquare className="size-3" aria-hidden="true" />
            <span className="tabular-nums">{item.comments ?? 0}</span>
          </a>
        ) : null}
      </p>
    </li>
  );
}

/** AI and tech headlines from Hacker News and a few trusted outlets, newest first. */
export function TodayNews({ className }: { className?: string }) {
  const { data, isPending, isError } = useTodayNews();
  const items = data?.items ?? [];

  return (
    <PaperSection label="Tech & AI news" count={items.length > 0 ? items.length : undefined} className={className}>
      {isPending ? (
        <p className="text-[14px] text-paper-sage">Reading the news…</p>
      ) : isError || !data || items.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">
          The news couldn't be read{data && data.failed.length > 0 ? ` (${data.failed.join(", ")})` : ""}. It will try again shortly.
        </p>
      ) : (
        <>
          <ul className="max-h-[34rem] divide-y divide-paper-stone overflow-y-auto rounded-none border border-paper-mist">
            {items.map((item) => (
              <NewsRow key={item.id} item={item} />
            ))}
          </ul>
          {data.failed.length > 0 ? (
            <p className="mt-2 text-[12px] text-paper-sage">Couldn't reach {data.failed.join(", ")}.</p>
          ) : null}
        </>
      )}
    </PaperSection>
  );
}

function RepoRow({ repo, rank }: { repo: TrendingRepo; rank: number }) {
  return (
    <li className="flex min-w-0 gap-3 px-4 py-2.5">
      <span className="mt-0.5 w-4 shrink-0 text-[12px] text-paper-sage tabular-nums">{rank}</span>
      <span className="min-w-0 flex-1">
        <a href={repo.url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex max-w-full items-center gap-1.5 text-[14px] font-medium text-paper-moss", LINK)}>
          <span className="truncate">{repo.fullName}</span>
          <ExternalLink className="size-3 shrink-0 text-paper-sage" aria-hidden="true" />
        </a>
        {repo.description ? <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-paper-char">{repo.description}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-paper-sage">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3" aria-hidden="true" />
            {compact(repo.stars)}
          </span>
          {repo.language ? <span>{repo.language}</span> : null}
          <span>{formatRelativeTime(repo.createdAt)}</span>
          {repo.starsGained !== undefined ? (
            <span className="font-semibold text-paper-moss tabular-nums">
              +{compact(repo.starsGained)}
              {repo.isNew ? " · new" : ""}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/** New GitHub repositories taking off this week, by stars. */
export function TodayTrending({ className }: { className?: string }) {
  const { data, isPending, isError } = useTodayTrending();
  const repos = data?.repos ?? [];

  return (
    <PaperSection label="Trending on GitHub" count={repos.length > 0 ? repos.length : undefined} className={className}>
      {isPending ? (
        <p className="text-[14px] text-paper-sage">Reading GitHub…</p>
      ) : isError || !data || data.status !== "ready" ? (
        <p className="text-[14px] leading-6 text-paper-char">{data?.detail ?? "GitHub trending couldn't be read."}</p>
      ) : (
        <>
          <ol className="divide-y divide-paper-stone rounded-none border border-paper-mist">
            {repos.map((repo, index) => (
              <RepoRow key={repo.fullName} repo={repo} rank={index + 1} />
            ))}
          </ol>
          <p className="mt-2 text-[12px] leading-5 text-paper-sage">
            {data.tracking?.baselineDate
              ? `Stars gained ${data.tracking.sinceDays === 1 ? "since yesterday" : `in ${data.tracking.sinceDays} days`}, among the year's most-starred young repos and this week's new ones.`
              : "Tracking started today: star gains appear tomorrow. For now, ordered by total stars."}
          </p>
        </>
      )}
    </PaperSection>
  );
}

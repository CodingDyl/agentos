import { useState } from "react";
import { Link } from "react-router-dom";
import type { CareerData, LinkedInPost } from "@shared/career-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useAddPostIdea, useDeletePost, useDraftPost, usePatchPost, usePublishPost } from "@/lib/agentos/career";
import { cn } from "@/lib/utils";
import { ErrorLine } from "./career-kit";
import { formatTimestamp, TEXTAREA } from "./career-model";

const LIMIT = 3000;

/**
 * Idea → Hermes draft → edit → approve → publish. Every step is a person's
 * press; editing an approved draft withdraws the approval. Messages open on
 * linkedin.com: the messaging API is not available to AgentOS.
 */
export function CareerLinkedInTab({ data }: { data: CareerData }) {
  const { linkedin } = data;
  const [idea, setIdea] = useState("");
  const add = useAddPostIdea();
  const learned = data.workLog.flatMap((entry) => entry.learned.map((line) => ({ line, id: entry.id }))).slice(0, 5);

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-10">
        <PaperSection label="New post idea">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (idea.trim()) add.mutate({ idea }, { onSuccess: () => setIdea("") });
            }}
          >
            <input
              aria-label="Post idea"
              className={cn(PAPER_INPUT, "min-w-0 flex-1")}
              placeholder="Turn what I learned about distributed caching this week into a post"
              value={idea}
              maxLength={1000}
              onChange={(event) => setIdea(event.target.value)}
            />
            <PaperButton type="submit" variant="amber" disabled={add.isPending}>
              Save idea
            </PaperButton>
          </form>
          <ErrorLine error={add.error} />
          {learned.length > 0 ? (
            <div className="mt-4">
              <p className="text-[12.5px] text-paper-sage">From your work log</p>
              <ul className="mt-1 space-y-1">
                {learned.map((item, index) => (
                  <li key={`${item.id}-${index}`}>
                    <button
                      type="button"
                      className="cursor-pointer text-left text-[14px] text-paper-blue underline-offset-4 hover:underline"
                      onClick={() => add.mutate({ idea: `Turn what I learned into a post: ${item.line}`, source: `worklog:${item.id}` })}
                    >
                      + {item.line}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </PaperSection>

        <PaperSection label="Posts" count={linkedin.posts.length}>
          {linkedin.posts.length === 0 ? (
            <p className="text-[15px] text-paper-char">No ideas yet.</p>
          ) : (
            <ul className="space-y-4">
              {linkedin.posts.map((post) => (
                <PostCard key={post.id} post={post} canPublish={linkedin.canPublish} />
              ))}
            </ul>
          )}
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-10">
        <PaperSection label="LinkedIn">
          <div className="flex flex-col gap-2">
            <a href={linkedin.profileUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] text-paper-blue underline-offset-4 hover:underline">
              Open profile ↗
            </a>
            <a href={linkedin.messagesUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] text-paper-blue underline-offset-4 hover:underline">
              Open messages ↗
            </a>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-paper-sage">
            Messages open on LinkedIn: its messaging API is limited to approved partners, and AgentOS does not scrape it.
          </p>
          {!linkedin.canPublish ? (
            <p className="mt-3 text-[13.5px] leading-6 text-paper-flame-deep">
              {linkedin.publishDetail}{" "}
              <Link to="/connectors/linkedin" className="underline underline-offset-4">
                Set up
              </Link>
            </p>
          ) : null}
        </PaperSection>
      </div>
    </div>
  );
}

const STATUS_TONE = { idea: "muted", draft: "marigold", approved: "blue", published: "green" } as const;

function PostCard({ post, canPublish }: { post: LinkedInPost; canPublish: boolean }) {
  const [draft, setDraft] = useState(post.draft);
  const [syncedFrom, setSyncedFrom] = useState(post.draft);
  const patch = usePatchPost();
  const draftWithHermes = useDraftPost();
  const publish = usePublishPost();
  const remove = useDeletePost();

  // A Hermes draft (or another tab's edit) replaces the local text only while it is unedited.
  if (post.draft !== syncedFrom) {
    setSyncedFrom(post.draft);
    setDraft(post.draft);
  }

  const dirty = draft !== post.draft;
  const published = post.status === "published";

  return (
    <li>
      <PaperCard>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 text-[15px] font-medium">{post.idea}</p>
          <Tag tone={STATUS_TONE[post.status]}>{post.status}</Tag>
        </div>

        {published ? (
          <>
            <p className="mt-3 text-[14.5px] leading-6 whitespace-pre-line text-paper-char">{post.draft}</p>
            <p className="mt-3 text-[13px] text-paper-green">
              Published {post.publishedAt ? formatTimestamp(post.publishedAt) : ""}
              {post.url ? (
                <>
                  {" · "}
                  <a href={post.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    View ↗
                  </a>
                </>
              ) : null}
            </p>
          </>
        ) : (
          <>
            <label className="mt-3 block">
              <span className="sr-only">Draft</span>
              <textarea
                className={cn(TEXTAREA, "min-h-36")}
                value={draft}
                maxLength={LIMIT}
                placeholder="Write it yourself, or ask Hermes for a draft."
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <p className="text-right text-[12px] text-paper-sage tabular-nums">
              {draft.length} / {LIMIT}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <PaperButton variant="ghost" disabled={draftWithHermes.isPending || dirty} title={dirty ? "Save your edits first" : undefined} onClick={() => draftWithHermes.mutate(post.id)}>
                {draftWithHermes.isPending ? "Drafting…" : post.draft ? "Redraft with Hermes" : "Draft with Hermes"}
              </PaperButton>
              {dirty ? (
                <PaperButton variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ postId: post.id, patch: { draft, status: draft.trim() ? "draft" : "idea" } })}>
                  Save draft
                </PaperButton>
              ) : null}
              {post.status === "draft" && !dirty ? (
                <PaperButton variant="amber" disabled={patch.isPending} onClick={() => patch.mutate({ postId: post.id, patch: { status: "approved" } })}>
                  Approve
                </PaperButton>
              ) : null}
              {post.status === "approved" && !dirty ? (
                <>
                  <PaperButton
                    variant="amber"
                    disabled={!canPublish || publish.isPending}
                    title={canPublish ? undefined : "Connect LinkedIn first"}
                    onClick={() => {
                      if (window.confirm("Publish this post publicly on LinkedIn now?")) publish.mutate(post.id);
                    }}
                  >
                    {publish.isPending ? "Publishing…" : "Publish to LinkedIn"}
                  </PaperButton>
                  <PaperButton onClick={() => patch.mutate({ postId: post.id, patch: { status: "draft" } })}>Withdraw approval</PaperButton>
                </>
              ) : null}
              <PaperButton disabled={remove.isPending} onClick={() => window.confirm("Delete this post?") && remove.mutate(post.id)}>
                Delete
              </PaperButton>
            </div>
          </>
        )}
        <ErrorLine error={patch.error ?? draftWithHermes.error ?? publish.error ?? remove.error} />
      </PaperCard>
    </li>
  );
}

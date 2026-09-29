import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DesignAsset, DesignBoard } from "@shared/agentos-types";
import { AppShell } from "@/components/os";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperCard,
  PaperEmpty,
  PaperError,
  PaperLoading,
  PaperPageHeader,
  PaperStage,
} from "@/components/paper";
import { cn } from "@/lib/utils";
import { useNavigationItems } from "@/config/use-navigation";
import { useCreateDesignBoard, useDesignLibrary } from "@/lib/agentos/queries";

/**
 * Boards: moodboards, assembled from the library.
 *
 * A board holds ids, never copies — so the same reference can sit on a project
 * board and a general one at once, and deleting a board never loses an image.
 */
export function BoardsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useDesignLibrary();
  const createBoard = useCreateDesignBoard();
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");

  const boards = data?.boards ?? [];
  const assets = data?.assets ?? [];

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    createBoard.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          setIsNaming(false);
        },
      },
    );
  };

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="design-boards"
      activeHref="/designs"
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        {isPending ? (
          <PaperLoading title="Boards" message="Opening your boards…" />
        ) : !data ? (
          <PaperError
            title="The creative library could not be read."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <PaperBackLink to="/designs">Creative</PaperBackLink>

            <PaperPageHeader
              className="mt-3"
              title="Boards"
              description="Collections of references, gathered by intent rather than by workspace."
              actions={
                <PaperButton variant="amber" onClick={() => setIsNaming(true)}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  New board
                </PaperButton>
              }
            />

            {isNaming ? (
              <PaperCard className="mt-8 max-w-lg p-5">
                <label htmlFor="board-name">
                  <FieldLabel>Board name</FieldLabel>
                </label>
                <input
                  id="board-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                    if (event.key === "Escape") setIsNaming(false);
                  }}
                  placeholder="Pantry Pilot: Chef Inspiration"
                  className={cn(PAPER_INPUT, "w-full")}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <PaperButton
                    variant="amber"
                    onClick={submit}
                    disabled={createBoard.isPending || name.trim().length === 0}
                  >
                    {createBoard.isPending ? "Creating…" : "Create"}
                  </PaperButton>
                  <PaperButton variant="quiet" onClick={() => setIsNaming(false)}>
                    Cancel
                  </PaperButton>
                </div>
              </PaperCard>
            ) : null}

            {boards.length === 0 ? (
              <PaperEmpty
                title="No boards"
                description="A board is a set of references gathered for one purpose: a redesign, a direction, a feeling."
                className="mt-10"
              />
            ) : (
              <div className="mt-10 grid gap-5 pb-4 sm:grid-cols-2 xl:grid-cols-3">
                {boards.map((board) => (
                  <BoardCard key={board.id} board={board} assets={assets} />
                ))}
              </div>
            )}
          </>
        )}
      </PaperStage>
    </AppShell>
  );
}

/** Up to four assets, as the board's own cover. */
function BoardCard({
  board,
  assets,
}: {
  board: DesignBoard;
  assets: DesignAsset[];
}) {
  const cover = board.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is DesignAsset => asset !== undefined)
    .slice(0, 4);

  return (
    <Link
      to={`/designs/boards/${board.id}`}
      className={cn("group block cursor-pointer rounded-none border border-paper-mist p-3 transition-colors duration-150 hover:bg-paper-cream", PAPER_FOCUS)}
    >
      <div className="grid aspect-[4/3] grid-cols-2 gap-1.5 overflow-hidden rounded-none bg-paper-linen">
        {cover.length === 0 ? (
          <span className="col-span-2 flex items-center justify-center text-[13px] text-paper-sage">
            Empty board
          </span>
        ) : (
          cover.map((asset, index) => (
            <img
              key={asset.id}
              src={asset.thumbnailUrl}
              alt=""
              loading="lazy"
              className={
                // A single image fills the cover rather than sitting in a quarter.
                cover.length === 1
                  ? "col-span-2 size-full object-cover"
                  : cover.length === 3 && index === 0
                    ? "col-span-2 size-full object-cover"
                    : "size-full object-cover"
              }
            />
          ))
        )}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-4">
        <h2 className="truncate font-paper-display text-[16px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">
          {board.name}
        </h2>
        <span className="shrink-0 text-[13px] text-paper-sage tabular-nums">
          {board.assetIds.length}
        </span>
      </div>
      {board.project ? (
        <p className="mt-1 text-[12.5px] text-paper-sage">{board.project}</p>
      ) : null}
    </Link>
  );
}

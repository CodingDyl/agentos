import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DesignAsset, DesignBoard } from "@shared/agentos-types";
import {
  AppShell,
  CommandButton,
  EmptyState,
  ErrorState,
  HairlineCard,
  LoadingState,
  PageHeader,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useCreateDesignBoard, useDesignLibrary } from "@/lib/agentos/queries";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

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
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Boards"
            message="Opening your boards…"
            detail="Media / reading"
          />
        ) : !data ? (
          <ErrorState
            label="Boards unavailable"
            title="Could not read the creative library."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <Link
              to="/designs"
              className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Creative
            </Link>

            <PageHeader
              className="mt-5"
              title="Boards"
              description="Collections of references, gathered by intent rather than by project."
              actions={
                <CommandButton
                  variant="primary"
                  icon={Plus}
                  iconPosition="start"
                  onClick={() => setIsNaming(true)}
                >
                  New board
                </CommandButton>
              }
            />

            {isNaming ? (
              <HairlineCard className="mt-8 max-w-lg p-5 md:p-6">
                <label className="os-meta block text-os-subtle" htmlFor="board-name">
                  Board name
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
                  placeholder="Pantry Pilot — Chef Inspiration"
                  className="os-focus-ring mt-3 min-h-10 w-full rounded-md border border-os-border bg-transparent px-3 text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
                />
                <div className="mt-5 flex flex-wrap gap-2">
                  <CommandButton
                    variant="primary"
                    onClick={submit}
                    loading={createBoard.isPending}
                    loadingLabel="Creating"
                    disabled={name.trim().length === 0}
                  >
                    Create
                  </CommandButton>
                  <CommandButton
                    variant="quiet"
                    onClick={() => setIsNaming(false)}
                  >
                    Cancel
                  </CommandButton>
                </div>
              </HairlineCard>
            ) : null}

            {boards.length === 0 ? (
              <EmptyState
                label="No boards"
                description="A board is a set of references gathered for one purpose — a redesign, a direction, a feeling."
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
      </div>
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
      className="os-focus-ring group block cursor-pointer rounded-lg border border-os-border p-3 transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised"
    >
      <div className="grid aspect-[4/3] grid-cols-2 gap-1.5 overflow-hidden rounded-md bg-os-surface">
        {cover.length === 0 ? (
          <span className="os-meta col-span-2 flex items-center justify-center text-os-subtle">
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
        <h2 className="truncate text-[15px] leading-6 font-medium">
          {board.name}
        </h2>
        <span className="os-meta shrink-0 text-os-subtle">
          {board.assetIds.length}
        </span>
      </div>
      {board.project ? (
        <p className="os-meta mt-1.5 text-os-subtle">{board.project}</p>
      ) : null}
    </Link>
  );
}

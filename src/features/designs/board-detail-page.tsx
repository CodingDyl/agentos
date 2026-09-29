import { Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { DesignAsset } from "@shared/agentos-types";
import { AppShell } from "@/components/os";
import {
  PAPER_FOCUS,
  PaperBackLink,
  PaperButton,
  PaperEmpty,
  PAPER_INPUT,
  PaperError,
  PaperLoading,
  PaperStage,
} from "@/components/paper";
import { cn } from "@/lib/utils";
import { useNavigationItems } from "@/config/use-navigation";
import {
  useDeleteDesignAsset,
  useDeleteDesignBoard,
  useDesignLibrary,
  useProjects,
  useSetBoardMembership,
  useUpdateDesignAsset,
  useUpdateDesignBoard,
} from "@/lib/agentos/queries";
import { AssetLightbox } from "./asset-lightbox";
import { DesignGrid } from "./design-grid";

/**
 * One board: its references, and what it is for.
 *
 * The notes are the point as much as the images — a moodboard without a stated
 * intent is just a folder.
 */
export function BoardDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isPending, isFetching, error, refetch } = useDesignLibrary();
  const { data: projectsData } = useProjects();

  const updateBoard = useUpdateDesignBoard();
  const deleteBoard = useDeleteDesignBoard();
  const updateAsset = useUpdateDesignAsset();
  const deleteAsset = useDeleteDesignAsset();
  const setMembership = useSetBoardMembership();

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const board = data?.boards.find((entry) => entry.id === id);
  const boards = useMemo(() => data?.boards ?? [], [data]);
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);

  // The notes draft follows whichever board is loaded. Adjusted during render
  // rather than in an effect, so the field is never briefly empty or showing
  // another board's text.
  const [notes, setNotes] = useState(board?.notes ?? "");
  const [shownBoardId, setShownBoardId] = useState(board?.id);

  if (board && shownBoardId !== board.id) {
    setShownBoardId(board.id);
    setNotes(board.notes ?? "");
  }

  const assets = useMemo(() => {
    if (!board || !data) return [];

    // Board order, not library order: a board is arranged, not just filtered.
    return board.assetIds
      .map((assetId) => data.assets.find((asset) => asset.id === assetId))
      .filter((asset): asset is DesignAsset => asset !== undefined);
  }, [board, data]);

  const openAssetId = searchParams.get("asset");
  const openAsset = assets.find((asset) => asset.id === openAssetId);

  const setParam = useCallback(
    (key: string, value: string | undefined) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="design-board"
      activeHref="/designs"
      contextLabel={board ? `Board / ${board.name}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      <PaperStage>
        {isPending ? (
          <PaperLoading title="Board" message="Opening the board…" />
        ) : !data ? (
          <PaperError
            title="The creative library could not be read."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : !board ? (
          <PaperError
            title="That board is not in the library."
            hint="It may have been deleted. The images it collected are still there."
          />
        ) : (
          <>
            <PaperBackLink to="/designs/boards">All boards</PaperBackLink>

            <header className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-paper-mist pb-6">
              <div className="min-w-0">
                {board.project ? (
                  <p className="text-[13px] font-medium text-paper-sage">{board.project}</p>
                ) : null}
                <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">
                  {board.name}
                </h1>
                <p className="mt-1 text-[13.5px] text-paper-sage">
                  {assets.length}{" "}
                  {assets.length === 1 ? "reference" : "references"}
                </p>
              </div>

              {confirmingDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <PaperButton
                    variant="danger"
                    onClick={() =>
                      deleteBoard.mutate(board.id, {
                        onSuccess: () => navigate("/designs/boards"),
                      })
                    }
                  >
                    Delete board
                  </PaperButton>
                  <PaperButton variant="quiet" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </PaperButton>
                </div>
              ) : (
                <PaperButton variant="quiet" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Delete board
                </PaperButton>
              )}
            </header>

            {/* Deleting a board never deletes what it collected. */}
            {confirmingDelete ? (
              <p className="mt-4 text-[13.5px] leading-5 text-paper-char">
                The {assets.length} images on this board stay in the library.
              </p>
            ) : null}

            <div className="mt-8">
              {assets.length === 0 ? (
                <PaperEmpty
                  title="Empty board"
                  description="Open an image in the library and add it to this board."
                  action={
                    <Link
                      to="/designs"
                      className={cn("inline-flex min-h-8 cursor-pointer items-center rounded-none border-[1.5px] border-paper-gold px-3 text-[13.5px] font-semibold text-paper-moss transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
                    >
                      Browse the library
                    </Link>
                  }
                />
              ) : (
                <DesignGrid
                  assets={assets}
                  onOpen={(asset) => setParam("asset", asset.id)}
                  onToggleFavorite={(asset) =>
                    updateAsset.mutate({
                      id: asset.id,
                      patch: { favorite: !asset.favorite },
                    })
                  }
                  onAddToBoard={(asset) => setParam("asset", asset.id)}
                  onRemoveFromBoard={(asset) =>
                    setMembership.mutate({
                      boardId: board.id,
                      assetId: asset.id,
                      member: false,
                    })
                  }
                />
              )}
            </div>

            <section aria-label="Notes" className="mt-12 max-w-[72ch] border-t border-paper-mist pt-8 pb-4">
              <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Notes</h2>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => {
                  const trimmed = notes.trim();
                  if (trimmed !== (board.notes ?? "")) {
                    updateBoard.mutate({
                      id: board.id,
                      patch: { notes: trimmed || null },
                    });
                  }
                }}
                rows={3}
                placeholder="What this board is reaching for."
                className={cn(PAPER_INPUT, "mt-3 w-full resize-y py-2.5 leading-6")}
              />
            </section>
          </>
        )}
      </PaperStage>

      {openAsset && board ? (
        <AssetLightbox
          asset={openAsset}
          boards={boards}
          projects={projects}
          onClose={() => setParam("asset", undefined)}
          onPatch={(patch) => updateAsset.mutate({ id: openAsset.id, patch })}
          onToggleBoard={(boardId, member) =>
            setMembership.mutate({ boardId, assetId: openAsset.id, member })
          }
          onDelete={() => {
            deleteAsset.mutate(openAsset.id);
            setParam("asset", undefined);
          }}
        />
      ) : null}
    </AppShell>
  );
}

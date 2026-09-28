import { ArrowLeft, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { DesignAsset } from "@shared/agentos-types";
import {
  AppShell,
  CommandButton,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionLabel,
} from "@/components/os";
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

const PAGE_PADDING =
  "mx-auto w-full max-w-[1600px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10";

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
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Board"
            message="Opening the board…"
            detail="Media / reading"
          />
        ) : !data ? (
          <ErrorState
            label="Board unavailable"
            title="Could not read the creative library."
            detail={error?.message}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : !board ? (
          <ErrorState
            label="Unknown board"
            title="That board is not in the library."
            hint="It may have been deleted. The images it collected are still there."
          />
        ) : (
          <>
            <Link
              to="/designs/boards"
              className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              All boards
            </Link>

            <header className="mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-os-border pb-8">
              <div className="min-w-0">
                {board.project ? (
                  <p className="os-meta text-os-subtle">{board.project}</p>
                ) : null}
                <h1 className="mt-2 text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-normal tracking-[-0.03em]">
                  {board.name}
                </h1>
                <p className="os-meta mt-4 text-os-subtle">
                  {assets.length}{" "}
                  {assets.length === 1 ? "reference" : "references"}
                </p>
              </div>

              {confirmingDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CommandButton
                    variant="danger"
                    onClick={() =>
                      deleteBoard.mutate(board.id, {
                        onSuccess: () => navigate("/designs/boards"),
                      })
                    }
                  >
                    Delete board
                  </CommandButton>
                  <CommandButton
                    variant="quiet"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep
                  </CommandButton>
                </div>
              ) : (
                <CommandButton
                  variant="quiet"
                  icon={Trash2}
                  iconPosition="start"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete board
                </CommandButton>
              )}
            </header>

            {/* Deleting a board never deletes what it collected. */}
            {confirmingDelete ? (
              <p className="mt-4 text-[13px] leading-5 text-os-muted">
                The {assets.length} images on this board stay in the library.
              </p>
            ) : null}

            <div className="mt-8">
              {assets.length === 0 ? (
                <EmptyState
                  label="Empty board"
                  description="Open an image in the library and add it to this board."
                  action={
                    <Link
                      to="/designs"
                      className="os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center rounded-md border border-os-border px-3 text-os-muted transition-colors duration-150 hover:border-os-border-strong hover:text-foreground"
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

            <section className="mt-12 max-w-[72ch] border-t border-os-border pt-8 pb-4">
              <SectionLabel>Notes</SectionLabel>
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
                className="os-focus-ring mt-4 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
              />
            </section>
          </>
        )}
      </div>

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

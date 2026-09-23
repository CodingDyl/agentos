import { ImagePlus, Search, Sparkles, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DesignAsset } from "@shared/agentos-types";
import {
  AppShell,
  CommandButton,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  SectionLabel,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import {
  useDeleteDesignAsset,
  useDesignLibrary,
  useProjects,
  useSetBoardMembership,
  useUpdateDesignAsset,
  useUploadDesignAsset,
} from "@/lib/agentos/queries";
import { AssetLightbox } from "./asset-lightbox";
import { MAX_REVIEW_ASSETS } from "@shared/design-intelligence-types";
import { DesignGrid } from "./design-grid";
import { DesignReviewPanel } from "./design-review-panel";
import { GeneratePanel } from "./generate-panel";
import {
  collectProducts,
  collectSources,
  filterAssets,
  UNASSIGNED,
  LIBRARY_FILTERS,
  type LibraryFilter,
} from "./designs-model";
import { UploadDropzone } from "./upload-dropzone";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1600px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10";

/**
 * The visual workspace.
 *
 * Deliberately the least framed screen in AgentOS: the imagery is the
 * interface, so the chrome is a search field, a few filters, and nothing else
 * until you hover something. Everything a tile can do lives on the tile or in
 * the asset itself.
 */
export function DesignsPage() {
  const navigationItems = useNavigationItems();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");

  /**
   * References chosen for a visual review.
   *
   * Empty means the library behaves as it always has. The moment anything is
   * selected the grid switches to choosing rather than browsing, which is why
   * this is one piece of state rather than a separate mode flag.
   */
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The project filter and the open asset both live in the URL, so a project's
  // own screen can link straight to its visuals and an asset can be shared.
  const project = searchParams.get("project") ?? "all";
  const openAssetId = searchParams.get("asset");

  const { data, isPending, isFetching, error, refetch } = useDesignLibrary();
  const { data: projectsData } = useProjects();

  const upload = useUploadDesignAsset();
  const updateAsset = useUpdateDesignAsset();
  const deleteAsset = useDeleteDesignAsset();
  const setMembership = useSetBoardMembership();

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const boards = useMemo(() => data?.boards ?? [], [data]);
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);

  const product = searchParams.get("product") ?? "all";
  const source = searchParams.get("source") ?? "all";

  const visible = useMemo(
    () => filterAssets(assets, { search, filter, project, product, source }),
    [assets, search, filter, project, product, source],
  );

  // Offered only where they would narrow something: a product filter listing
  // products that exist in another project is noise.
  const products = useMemo(
    () =>
      collectProducts(
        project === "all" || project === UNASSIGNED
          ? assets
          : assets.filter((asset) => asset.project === project),
      ),
    [assets, project],
  );

  const sources = useMemo(() => collectSources(assets), [assets]);

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

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        upload.mutate({
          file,
          // An upload lands in the project being browsed, which is almost
          // always the one it belongs to.
          options: { project: project === "all" || project === UNASSIGNED ? undefined : project },
        });
      }
    },
    [project, upload],
  );

  const isEmptyLibrary = assets.length === 0;

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="designs"
      activeHref="/designs"
      contextLabel={
        project === UNASSIGNED
          ? "Context / unassigned"
          : project !== "all"
            ? `Context / ${project}`
            : undefined
      }
      modelLabel="Model / AgentOS V1"
    >
      <UploadDropzone onFiles={uploadFiles}>
        <div className={PAGE_PADDING}>
          {isPending ? (
            <LoadingState
              label="Designs"
              message="Opening the visual library…"
              detail="Media / reading"
            />
          ) : !data ? (
            <ErrorState
              label="Library unavailable"
              title="Could not read the design library."
              detail={error?.message}
              hint="Images live outside the vault, in AgentOS-Media. Check that the adapter is running."
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          ) : (
            <>
              <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
                <div>
                  <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-normal tracking-[-0.03em]">
                    Designs
                  </h1>
                  <p className="mt-3 text-[15px] leading-6 text-os-muted">
                    Find references, ideas and generated work.
                  </p>
                </div>
                <div className="flex items-baseline gap-5">
                  <Link
                    to="/designs/boards"
                    className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
                  >
                    Boards / {boards.length}
                  </Link>
                  <Link
                    to="/designs/generations"
                    className="os-focus-ring os-meta cursor-pointer rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
                  >
                    Generations
                  </Link>
                  <span className="os-meta text-os-subtle">
                    {assets.length} {assets.length === 1 ? "asset" : "assets"}
                  </span>
                </div>
              </header>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <label className="relative flex min-w-64 flex-1 items-center">
                  <Search
                    className="pointer-events-none absolute left-3 size-4 text-os-subtle"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="sr-only">Search visuals</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search images, tags, projects…"
                    className="os-focus-ring min-h-10 w-full rounded-md border border-os-border bg-transparent pr-3 pl-9 text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
                  />
                </label>

                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    if (event.target.files) uploadFiles(event.target.files);
                    // Clearing lets the same file be chosen twice in a row.
                    event.target.value = "";
                  }}
                />

                <CommandButton
                  variant="primary"
                  icon={Upload}
                  iconPosition="start"
                  loading={upload.isPending}
                  loadingLabel="Uploading"
                  onClick={() => fileInput.current?.click()}
                >
                  Upload
                </CommandButton>

                <CommandButton
                  variant="secondary"
                  icon={Sparkles}
                  iconPosition="start"
                  onClick={() => setGenerating((current) => !current)}
                >
                  Generate
                </CommandButton>
              </div>

              <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                <FilterBar<LibraryFilter>
                  label="Filter visuals by kind"
                  options={LIBRARY_FILTERS}
                  value={filter}
                  onChange={setFilter}
                />

                {projects.length > 0 ? (
                  <FilterBar<string>
                    label="Filter visuals by project"
                    value={project}
                    onChange={(value) =>
                      setParam("project", value === "all" ? undefined : value)
                    }
                    options={[
                      { value: "all", label: "All projects" },
                      ...projects.map((entry) => ({
                        value: entry.slug,
                        label: entry.name,
                      })),
                      // Loose work is findable rather than merely present.
                      ...(assets.some((asset) => !asset.project)
                        ? [{ value: UNASSIGNED, label: "Unassigned" }]
                        : []),
                    ]}
                  />
                ) : null}
              </div>

              {products.length > 0 || sources.length > 1 ? (
                <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-4">
                  {products.length > 0 ? (
                    <FilterBar<string>
                      label="Filter visuals by product"
                      value={product}
                      onChange={(value) => setParam("product", value === "all" ? undefined : value)}
                      options={[
                        { value: "all", label: "All products" },
                        ...products.map((entry) => ({ value: entry, label: entry })),
                      ]}
                    />
                  ) : null}

                  {sources.length > 1 ? (
                    <FilterBar<string>
                      label="Filter visuals by source"
                      value={source}
                      onChange={(value) => setParam("source", value === "all" ? undefined : value)}
                      options={[
                        { value: "all", label: "Any source" },
                        ...sources.map((entry) => ({
                          value: entry,
                          label: entry === "higgsfield" ? "Higgsfield" : entry === "upload" ? "Uploaded" : entry,
                        })),
                      ]}
                    />
                  ) : null}
                </div>
              ) : null}

              {upload.isError ? (
                <p className="mt-6 text-[13px] leading-5 text-os-danger">
                  {upload.error instanceof Error
                    ? upload.error.message
                    : "That image could not be uploaded."}
                </p>
              ) : null}

              <div className="mt-8 border-t border-os-border pt-8">
                {visible.length === 0 ? (
                  <EmptyState
                    label={isEmptyLibrary ? "Nothing here yet" : "No matches"}
                    description={
                      isEmptyLibrary
                        ? "Drop an image anywhere on this page, or use Upload. Images are stored outside the vault, in AgentOS-Media."
                        : "No visuals match this search."
                    }
                    action={
                      isEmptyLibrary ? (
                        <CommandButton
                          variant="secondary"
                          icon={ImagePlus}
                          iconPosition="start"
                          onClick={() => fileInput.current?.click()}
                        >
                          Add your first image
                        </CommandButton>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    {generating ? (
                      <GeneratePanel
                        className="mb-6"
                        references={assets.filter((asset) =>
                          selected.includes(asset.id),
                        )}
                        onClose={() => setGenerating(false)}
                      />
                    ) : null}

                    <SelectionBar
                      label={
                        visible.length === assets.length
                          ? "Library"
                          : `${visible.length} of ${assets.length}`
                      }
                      selecting={selecting}
                      count={selected.length}
                      onStart={() => setSelecting(true)}
                      onReview={() => setReviewing(true)}
                      onClear={() => {
                        setSelecting(false);
                        setSelected([]);
                        setReviewing(false);
                      }}
                    />

                    {reviewing ? (
                      <DesignReviewPanel
                        className="mb-6"
                        assetIds={selected}
                        onClose={() => setReviewing(false)}
                      />
                    ) : null}

                    <DesignGrid
                      assets={visible}
                      selectedIds={selected}
                      onToggleSelect={
                        selecting
                          ? (asset) =>
                              setSelected((current) =>
                                current.includes(asset.id)
                                  ? current.filter((id) => id !== asset.id)
                                  : current.length >= MAX_REVIEW_ASSETS
                                    ? current
                                    : [...current, asset.id],
                            )
                          : undefined
                      }
                      onOpen={(asset) => setParam("asset", asset.id)}
                      onToggleFavorite={(asset) =>
                        updateAsset.mutate({
                          id: asset.id,
                          patch: { favorite: !asset.favorite },
                        })
                      }
                      // Board membership is managed where an asset's other
                      // details are, rather than in a second popover.
                      onAddToBoard={(asset) => setParam("asset", asset.id)}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </UploadDropzone>

      {openAsset ? (
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

export type { DesignAsset };

/**
 * Choosing references, and what to do with them.
 *
 * Selecting is a mode rather than a permanent state of the grid: the library
 * is for looking at pictures most of the time, and a tile that opened a
 * checkbox instead of the image would make the common case worse to serve the
 * rare one.
 */
function SelectionBar({
  label,
  selecting,
  count,
  onStart,
  onReview,
  onClear,
}: {
  label: string;
  selecting: boolean;
  count: number;
  onStart: () => void;
  onReview: () => void;
  onClear: () => void;
}) {
  if (!selecting) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        <CommandButton variant="quiet" onClick={onStart}>
          Select references
        </CommandButton>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <span className="os-meta text-os-subtle">
        {count} of {MAX_REVIEW_ASSETS} selected
        {count >= MAX_REVIEW_ASSETS ? " — that is the most one review takes" : ""}
      </span>
      <div className="flex flex-wrap gap-2">
        <CommandButton
          variant="primary"
          onClick={onReview}
          disabled={count === 0}
        >
          Review with Hermes
        </CommandButton>
        <CommandButton variant="quiet" onClick={onClear}>
          Cancel
        </CommandButton>
      </div>
    </div>
  );
}

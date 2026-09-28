import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, HairlineCard, Section } from "@/components/os";
import { useDesignLibrary } from "@/lib/agentos/queries";

/**
 * This project's visuals, as a tab.
 *
 * The library is one place, filtered — not a second copy per project — so an
 * image assigned here appears here, and the same image can serve another
 * project without being duplicated. Boards first, because they are what
 * delegated UI work is verified against; then the most recent assets; then the
 * door to the full workspace where generation and review live.
 */
export function ProjectDesigns({ slug, designBoard }: { slug: string; designBoard?: string }) {
  const { data, isPending, isError } = useDesignLibrary();

  const assets = (data?.assets ?? []).filter((asset) => asset.project === slug);
  const boards = (data?.boards ?? []).filter((board) => board.project === slug);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const recent = [...assets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  const workspace = `/designs?project=${encodeURIComponent(slug)}`;

  if (isPending) {
    return <p className="text-[15px] leading-6 text-os-muted">Reading the design library…</p>;
  }

  if (isError) {
    return <EmptyState label="Designs unavailable" description="The design library could not be read." />;
  }

  if (assets.length === 0 && boards.length === 0) {
    return (
      <EmptyState
        label="No designs yet"
        description="Nothing in the library is assigned to this project. Upload or generate in the design workspace and assign it here."
        action={
          <Link
            to={workspace}
            className="os-focus-ring inline-flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-os-border px-4 text-[15px] text-foreground transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised"
          >
            Open design workspace
            <ArrowRight className="size-4 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-12">
      {boards.length > 0 ? (
        <Section label="Boards" action={<span className="os-meta text-os-subtle tabular-nums">{boards.length}</span>}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => {
              const cover = board.assetIds
                .map((id) => byId.get(id) ?? data?.assets.find((asset) => asset.id === id))
                .filter((asset): asset is NonNullable<typeof asset> => asset !== undefined)
                .slice(0, 4);
              const isDefault =
                designBoard !== undefined &&
                (board.name.trim().toLowerCase() === designBoard.trim().toLowerCase() || board.id === designBoard);

              return (
                <Link
                  key={board.id}
                  to={`/designs/boards/${board.id}`}
                  className="os-focus-ring group block cursor-pointer rounded-lg border border-os-border p-3 transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised"
                >
                  <div className="grid aspect-[4/3] grid-cols-2 gap-1.5 overflow-hidden rounded-md bg-os-surface">
                    {cover.length === 0 ? (
                      <span className="os-meta col-span-2 flex items-center justify-center text-os-subtle">Empty board</span>
                    ) : (
                      cover.map((asset, index) => (
                        <img
                          key={asset.id}
                          src={asset.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className={
                            cover.length === 1 || (cover.length === 3 && index === 0)
                              ? "col-span-2 size-full object-cover"
                              : "size-full object-cover"
                          }
                        />
                      ))
                    )}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-4">
                    <h3 className="truncate text-[15px] leading-6">{board.name}</h3>
                    <span className="os-meta shrink-0 text-os-subtle">
                      {isDefault ? "Default" : `${board.assetIds.length}`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Section>
      ) : null}

      {recent.length > 0 ? (
        <Section label="Recent assets" action={<span className="os-meta text-os-subtle tabular-nums">{assets.length}</span>}>
          <HairlineCard className="p-3">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {recent.map((asset) => (
                <li key={asset.id} className="aspect-square overflow-hidden rounded-md bg-os-surface-raised">
                  <img src={asset.thumbnailUrl} alt={asset.filename} loading="lazy" className="size-full object-cover" />
                </li>
              ))}
            </ul>
          </HairlineCard>
        </Section>
      ) : null}

      <Link
        to={workspace}
        className="os-focus-ring group inline-flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-os-border px-4 text-[15px] text-foreground transition-colors duration-150 hover:border-os-border-strong hover:bg-os-surface-raised"
      >
        Open design workspace
        <ArrowRight className="size-4 text-os-subtle transition-colors duration-150 group-hover:text-os-amber" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </div>
  );
}

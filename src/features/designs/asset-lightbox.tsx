import { Check, Heart, PenLine, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DesignAsset,
  DesignAssetType,
  DesignBoard,
  ProjectSummary,
} from "@shared/agentos-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import { formatAdded, typeLabel } from "./designs-model";

const TYPES: readonly DesignAssetType[] = [
  "uploaded",
  "generated",
  "reference",
  "screenshot",
];

export interface AssetLightboxProps {
  asset: DesignAsset;
  boards: DesignBoard[];
  projects: ProjectSummary[];
  onClose: () => void;
  onPatch: (patch: {
    project?: string | null;
    tags?: string[];
    favorite?: boolean;
    approved?: boolean;
    product?: string | null;
    notes?: string | null;
    type?: DesignAssetType;
  }) => void;
  onToggleBoard: (boardId: string, member: boolean) => void;
  onDelete: () => void;
}

/**
 * One asset, at full size, with everything that is known about it.
 *
 * The image gets the room; the panel beside it is where an asset stops being a
 * picture and becomes part of a project — assigned, tagged, collected. Editing
 * happens in place, and each change is saved as it is made.
 */
export function AssetLightbox({
  asset,
  boards,
  projects,
  onClose,
  onPatch,
  onToggleBoard,
  onDelete,
}: AssetLightboxProps) {
  const [tagDraft, setTagDraft] = useState(asset.tags.join(", "));
  const [notesDraft, setNotesDraft] = useState(asset.notes ?? "");
  const [productDraft, setProductDraft] = useState(asset.product ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [shownAssetId, setShownAssetId] = useState(asset.id);

  // Stepping to a different asset is a different set of drafts. Adjusted
  // during render rather than in an effect, so the fields never paint once
  // with the previous asset's text.
  if (shownAssetId !== asset.id) {
    setShownAssetId(asset.id);
    setTagDraft(asset.tags.join(", "));
    setNotesDraft(asset.notes ?? "");
    setProductDraft(asset.product ?? "");
    setConfirmingDelete(false);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const commitTags = () => {
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (tags.join(",") !== asset.tags.join(",")) onPatch({ tags });
  };

  const commitNotes = () => {
    const notes = notesDraft.trim();
    if (notes !== (asset.notes ?? "")) onPatch({ notes: notes || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-os-background/92"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={asset.filename}
        className="relative flex max-h-full w-[min(96vw,80rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface lg:flex-row"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center bg-os-background p-4 md:p-8">
          <img
            src={asset.url}
            alt={asset.filename}
            className="max-h-[45vh] max-w-full object-contain lg:max-h-[80vh]"
          />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-8 overflow-y-auto border-t border-os-border p-5 md:p-6 lg:w-96 lg:border-t-0 lg:border-l">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-base leading-6 font-medium">
                {asset.filename}
              </h2>
              <p className="os-meta mt-2 text-os-subtle">
                Added {formatAdded(asset.createdAt)}
                {asset.width && asset.height
                  ? ` · ${asset.width}×${asset.height}`
                  : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                label={asset.favorite ? "Remove favourite" : "Favourite"}
                onClick={() => onPatch({ favorite: !asset.favorite })}
                active={asset.favorite}
              >
                <Heart
                  className={cn("size-4", asset.favorite && "fill-current")}
                  strokeWidth={1.5}
                />
              </IconButton>
              {/* Liking a concept and choosing it are different claims, so
                  they are different controls. Approved is the one that means
                  "this is the design". */}
              <IconButton
                label={asset.approved ? "Withdraw approval" : "Approve design"}
                onClick={() => onPatch({ approved: !asset.approved })}
                active={asset.approved}
              >
                <Check className="size-4" strokeWidth={1.5} />
              </IconButton>
              <IconButton label="Close" onClick={onClose}>
                <X className="size-4" strokeWidth={1.5} />
              </IconButton>
            </div>
          </header>

          <Field label="Project">
            <ChoiceRow
              options={[
                { value: "", label: "None" },
                ...projects.map((project) => ({
                  value: project.slug,
                  label: project.name,
                })),
              ]}
              value={asset.project ?? ""}
              onChange={(value) => onPatch({ project: value || null })}
            />
          </Field>

          <Field label="Type">
            <ChoiceRow
              options={TYPES.map((type) => ({
                value: type,
                label: typeLabel(type),
              }))}
              value={asset.type}
              onChange={(value) => onPatch({ type: value as DesignAssetType })}
            />
          </Field>

          <Field label="Tags">
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="mobile, nutrition, dark"
              className="os-focus-ring w-full rounded-md border border-os-border bg-transparent px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
            />
          </Field>

          <Field label="Boards">
            {boards.length === 0 ? (
              <p className="text-[13px] leading-5 text-os-subtle">
                No boards yet. Create one from the Boards screen.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {boards.map((board) => {
                  const member = asset.boardIds.includes(board.id);

                  return (
                    <button
                      key={board.id}
                      type="button"
                      aria-pressed={member}
                      onClick={() => onToggleBoard(board.id, !member)}
                      className={cn(
                        "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 transition-colors duration-150",
                        member
                          ? "border-os-border-strong bg-os-surface-raised text-foreground"
                          : "border-transparent text-os-muted hover:border-os-border hover:text-foreground",
                      )}
                    >
                      {board.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {asset.source === "higgsfield" || asset.model || asset.prompt ? (
            <Field label="How it was made">
              <p className="os-meta text-os-subtle">
                {asset.source === "higgsfield" ? "Higgsfield" : asset.source}
                {asset.model ? ` · ${asset.model}` : ""}
                {asset.referenceAssetIds.length > 0
                  ? ` · ${asset.referenceAssetIds.length} reference${asset.referenceAssetIds.length === 1 ? "" : "s"}`
                  : ""}
              </p>
              {asset.prompt ? (
                <p className="mt-2 max-w-[48ch] text-[13px] leading-5 text-os-muted">{asset.prompt}</p>
              ) : null}
            </Field>
          ) : null}

          <Field label="Product">
            <input
              value={productDraft}
              onChange={(event) => setProductDraft(event.target.value)}
              onBlur={() => {
                const next = productDraft.trim();
                if (next !== (asset.product ?? "")) onPatch({ product: next || null });
              }}
              placeholder="chef"
              className="os-focus-ring w-full rounded-md border border-os-border bg-transparent px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={commitNotes}
              rows={3}
              placeholder="What this reference is for."
              className="os-focus-ring w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
            />
          </Field>

          <div className="mt-auto flex flex-col gap-3 border-t border-os-border pt-6">
            {/* Stubbed deliberately: Hermes review is its own step, and a
                button that pretended to work would be worse than one that
                says what it is waiting for. */}
            <CommandButton
              variant="secondary"
              icon={PenLine}
              iconPosition="start"
              disabled
              title="Hermes visual review is not built yet"
            >
              Review with Hermes
            </CommandButton>
            <p className="os-meta text-os-subtle">Coming in a later step</p>

            {confirmingDelete ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CommandButton variant="danger" onClick={onDelete}>
                  Delete for good
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
                className="mt-3 self-start"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </CommandButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-3">{children}</div>
    </div>
  );
}

interface ChoiceRowProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

function ChoiceRow({ options, value, onChange }: ChoiceRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value || "none"}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 transition-colors duration-150",
              isSelected
                ? "border-os-border-strong bg-os-surface-raised text-foreground"
                : "border-transparent text-os-muted hover:border-os-border hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "os-focus-ring inline-flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-os-surface-raised",
        active ? "text-os-amber" : "text-os-subtle hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

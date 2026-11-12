import { ImagePlus, Link2, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell, FilterToolbar, type FilterGroup } from "@/components/os";
import { PAPER_INPUT, PaperButton, PaperEmpty, PaperError, PaperLoading, PaperPageHeader, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { DesignGrid, UploadDropzone } from "@/features/designs";
import { useDeleteDesignAsset, useProjects, useUpdateDesignAsset, useUploadDesignAsset } from "@/lib/agentos/queries";
import { useAddTasteUrl, useTaste, useUpdateTaste } from "@/lib/agentos/taste";
import { cn } from "@/lib/utils";
import { TasteDetail } from "./taste-detail";
import { ALL, collectTags, filterTaste } from "./taste-model";

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * Taste Vault: the references Dylan likes, in one place.
 *
 * A view over the design library's `reference` assets, laid out like Creative
 * so the two read as one room. What it adds is the reason a reference was
 * kept and which workspaces' agents are shown it before they design anything.
 */
export function TastePage() {
  const navigationItems = useNavigationItems();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState(ALL);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The workspace filter and the open reference live in the URL, so a
  // workspace's Creative tab can link straight to its own references.
  const workspace = searchParams.get("workspace") ?? ALL;
  const openId = searchParams.get("asset");

  const { data, isPending, isFetching, error, refetch } = useTaste();
  const { data: projectsData } = useProjects();
  const upload = useUploadDesignAsset();
  const updateAsset = useUpdateDesignAsset();
  const deleteAsset = useDeleteDesignAsset();
  const addUrl = useAddTasteUrl();
  const updateTaste = useUpdateTaste();

  const items = useMemo(() => data ?? [], [data]);
  const workspaces = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const tags = useMemo(() => collectTags(items), [items]);
  const visible = useMemo(() => filterTaste(items, { search, tag, workspace }), [items, search, tag, workspace]);
  const open = items.find((item) => item.id === openId);
  const workspaceName = workspaces.find((entry) => entry.slug === workspace)?.name ?? workspace;

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

  const { mutateAsync: uploadAsset } = upload;
  const { mutate: patchTaste } = updateTaste;

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        uploadAsset({ file, options: { type: "reference" } })
          .then((asset) => {
            // Added while looking at one workspace's references, it joins them;
            // otherwise it would vanish from the view it was dropped into.
            if (workspace !== ALL && !asset.attachedTo.includes(workspace)) {
              patchTaste({ id: asset.id, patch: { attachedTo: [...asset.attachedTo, workspace] } });
            }
          })
          // Shown from the mutation's own error state below.
          .catch(() => undefined);
      }
    },
    [patchTaste, uploadAsset, workspace],
  );

  // Paste an image from the clipboard, anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      event.preventDefault();
      addFiles(images);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const submitUrl = (event: FormEvent) => {
    event.preventDefault();
    const next = url.trim();
    if (!next || addUrl.isPending) return;
    setNotice(null);
    addUrl.mutate(next, {
      onSuccess: ({ asset, duplicate }) => {
        setUrl("");
        setNotice(duplicate ? "That page is already in the vault." : null);
        // Straight into the reference, while the reason for keeping it is fresh.
        setParam("asset", asset.id);
      },
    });
  };

  const groups: FilterGroup[] = [];
  if (workspaces.length > 0) {
    groups.push({
      id: "workspace",
      label: "Workspace",
      value: workspace,
      emptyValue: ALL,
      searchable: true,
      onChange: (value) => setParam("workspace", value === ALL ? undefined : value),
      options: [{ value: ALL, label: "All references" }, ...workspaces.map((entry) => ({ value: entry.slug, label: entry.name }))],
    });
  }
  if (tags.length > 0) {
    groups.push({
      id: "tag",
      label: "Tag",
      value: tag,
      emptyValue: ALL,
      onChange: setTag,
      options: [{ value: ALL, label: "Any tag" }, ...tags.map((entry) => ({ value: entry, label: entry }))],
    });
  }

  const isEmptyVault = items.length === 0;
  const narrowed = search.trim() !== "" || tag !== ALL;

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="taste"
      activeHref="/taste"
      contextLabel={workspace !== ALL ? `Context / ${workspace}` : undefined}
    >
      <UploadDropzone onFiles={addFiles} label="Drop images to add them as references">
        <PaperStage>
          {isPending ? (
            <PaperLoading title="Taste Vault" message="Opening the vault…" />
          ) : !data ? (
            <PaperError
              title="Taste Vault could not be read."
              detail={error?.message}
              hint="References live in the design library. Check that the adapter is running."
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          ) : (
            <>
              <PaperPageHeader
                title="Taste Vault"
                description={`Screenshots, components and sites you like, ready to hand to a workspace · ${items.length} ${
                  items.length === 1 ? "reference" : "references"
                }`}
              />

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <label className="relative flex min-w-56 flex-1 items-center">
                  <Search className="pointer-events-none absolute left-3 size-4 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                  <span className="sr-only">Search references</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search names, notes, tags, URLs…"
                    className={cn(PAPER_INPUT, "w-full pl-9")}
                  />
                </label>

                <form onSubmit={submitUrl} className="flex min-w-56 flex-1 items-center gap-2">
                  <label className="relative flex min-w-0 flex-1 items-center">
                    <Link2 className="pointer-events-none absolute left-3 size-4 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                    <span className="sr-only">Page URL to add</span>
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste a URL"
                      disabled={addUrl.isPending}
                      className={cn(PAPER_INPUT, "w-full pl-9 disabled:opacity-60")}
                    />
                  </label>
                  <PaperButton type="submit" variant="ghost" className="shrink-0" disabled={addUrl.isPending || url.trim() === ""}>
                    {addUrl.isPending ? "Capturing…" : "Add URL"}
                  </PaperButton>
                </form>

                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files);
                    // Clearing lets the same file be chosen twice in a row.
                    event.target.value = "";
                  }}
                />
                <PaperButton variant="amber" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                  <Upload className="size-3.5" aria-hidden="true" />
                  {upload.isPending ? "Uploading…" : "Upload"}
                </PaperButton>
              </div>

              {groups.length > 0 ? (
                <div className="mt-5">
                  <FilterToolbar groups={groups} />
                </div>
              ) : null}

              <div aria-live="polite">
                {addUrl.isPending ? (
                  <p className="mt-5 text-[14px] leading-5 text-paper-char">Photographing the page. This can take ten seconds or more.</p>
                ) : notice ? (
                  <p className="mt-5 text-[14px] leading-5 text-paper-char">{notice}</p>
                ) : null}
              </div>
              {addUrl.isError ? (
                <p role="alert" className="mt-5 text-[14px] leading-5 text-paper-flame-deep">
                  {message(addUrl.error, "That page could not be added.")}
                </p>
              ) : null}
              {upload.isError ? (
                <p role="alert" className="mt-5 text-[14px] leading-5 text-paper-flame-deep">
                  {message(upload.error, "That image could not be uploaded.")}
                </p>
              ) : null}

              <div className="mt-8 border-t border-paper-mist pt-8">
                {isEmptyVault ? (
                  <PaperEmpty
                    title="Nothing in the vault yet"
                    description="Keep the screenshots, components and live sites you like here. Drop an image anywhere on this page, paste one from the clipboard, or add a page by its URL. Attach a reference to a workspace and Claude is shown it before any design work there."
                    action={
                      <PaperButton variant="ghost" onClick={() => fileInput.current?.click()}>
                        <ImagePlus className="size-3.5" aria-hidden="true" />
                        Add your first reference
                      </PaperButton>
                    }
                  />
                ) : visible.length === 0 ? (
                  <PaperEmpty
                    title={narrowed || workspace === ALL ? "No matches" : `Nothing attached to ${workspaceName}`}
                    description={
                      narrowed || workspace === ALL
                        ? "No references match this search."
                        : "Open a reference and switch this workspace on under Attach to workspace. Claude is shown attached references before design work there."
                    }
                    action={
                      workspace !== ALL ? (
                        <PaperButton variant="ghost" onClick={() => setParam("workspace", undefined)}>
                          Show all references
                        </PaperButton>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    <h2 className="mb-5 text-[16px] leading-6 font-semibold tracking-[-0.01em] text-paper-moss">
                      {workspace !== ALL ? `Attached to ${workspaceName}` : "References"}
                      {visible.length !== items.length ? (
                        <span className="ml-2 text-[13px] font-normal text-paper-sage tabular-nums">
                          {visible.length} of {items.length}
                        </span>
                      ) : null}
                    </h2>
                    <DesignGrid
                      assets={visible}
                      onOpen={(asset) => setParam("asset", asset.id)}
                      onToggleFavorite={(asset) => updateAsset.mutate({ id: asset.id, patch: { favorite: !asset.favorite } })}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </PaperStage>
      </UploadDropzone>

      {open ? (
        <TasteDetail
          asset={open}
          workspaces={workspaces}
          error={updateTaste.isError ? message(updateTaste.error, "That change could not be saved.") : undefined}
          onClose={() => {
            updateTaste.reset();
            setParam("asset", undefined);
          }}
          onPatch={(patch) => updateTaste.mutate({ id: open.id, patch })}
          onDelete={() => {
            deleteAsset.mutate(open.id);
            setParam("asset", undefined);
          }}
        />
      ) : null}
    </AppShell>
  );
}

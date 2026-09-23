import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DesignAsset,
  DesignAssetType,
  DesignBoard,
  DesignLibrary,
} from "../../shared/agentos-types";
import { uiStateDir } from "../agentos/session-store";
import { deleteImage, type Dimensions } from "./media";

/**
 * The design library's metadata.
 *
 * Images live in the media directory; what they *mean* lives here — the
 * project they belong to, their tags, the boards they appear on. Kept in
 * `~/.agentos-ui`, beside the session map, so the vault stays a clean
 * human-owned knowledge layer.
 *
 * Board membership is stored once, on the board. An asset's `boardIds` is
 * derived on read, so the two can never disagree with each other.
 */

function libraryFile(): string {
  return path.join(uiStateDir(), "design-library.json");
}

/** What is actually written to disk. The wire model is derived from this. */
export interface StoredAsset {
  id: string;
  filename: string;
  /** Name on disk, always `<id><ext>`. Never leaves the server. */
  storedName: string;
  hasThumbnail: boolean;
  type: DesignAssetType;
  project?: string;
  tags: string[];
  favorite: boolean;
  width?: number;
  height?: number;
  createdAt: string;
  prompt?: string;
  notes?: string;
  /**
   * Everything below arrived with Step 57 and is optional on disk: a library
   * written before it simply has none of it, and reads back with the defaults
   * rather than needing a migration pass.
   */
  mediaType?: "image" | "video";
  source?: "higgsfield" | "upload" | "agentos" | "other";
  product?: string;
  provider?: string;
  model?: string;
  generationId?: string;
  referenceAssetIds?: string[];
  approved?: boolean;
}

export interface StoredLibrary {
  assets: StoredAsset[];
  boards: DesignBoard[];
}

/**
 * A fresh empty library.
 *
 * Deliberately a function, not a shared constant: callers mutate what they are
 * given, so a single shared object would accumulate every asset ever added to
 * it — and hand that back the next time a file could not be read.
 */
function emptyLibrary(): StoredLibrary {
  return { assets: [], boards: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

const ASSET_TYPES = new Set<DesignAssetType>([
  "uploaded",
  "generated",
  "reference",
  "screenshot",
]);

/**
 * Reads one stored asset, dropping anything unusable.
 *
 * A hand-edited or partially written file must not take the whole library with
 * it: an unreadable entry is skipped and everything else still loads.
 */
const MEDIA_SOURCES = new Set(["higgsfield", "upload", "agentos", "other"]);

function readStoredAsset(value: unknown): StoredAsset | undefined {
  if (!isRecord(value)) return undefined;

  const id = asString(value.id);
  const storedName = asString(value.storedName);
  const createdAt = asString(value.createdAt);

  if (!id || !storedName || !createdAt) return undefined;

  const type = value.type as DesignAssetType;

  return {
    id,
    filename: asString(value.filename) ?? storedName,
    storedName,
    hasThumbnail: value.hasThumbnail === true,
    type: ASSET_TYPES.has(type) ? type : "uploaded",
    project: asString(value.project),
    tags: asStrings(value.tags),
    favorite: value.favorite === true,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    createdAt,
    prompt: asString(value.prompt),
    notes: asString(value.notes),
    // Read back explicitly, because this reader is a whitelist: a field it
    // does not name is dropped on the next write, which would quietly erase
    // every asset's provenance one save at a time.
    mediaType: value.mediaType === "video" ? "video" : "image",
    source: MEDIA_SOURCES.has(value.source as string)
      ? (value.source as StoredAsset["source"])
      : undefined,
    product: asString(value.product),
    provider: asString(value.provider),
    model: asString(value.model),
    generationId: asString(value.generationId),
    referenceAssetIds: asStrings(value.referenceAssetIds),
    approved: value.approved === true,
  };
}

function readStoredBoard(value: unknown): DesignBoard | undefined {
  if (!isRecord(value)) return undefined;

  const id = asString(value.id);
  const name = asString(value.name);

  if (!id || !name) return undefined;

  const createdAt = asString(value.createdAt) ?? new Date().toISOString();

  return {
    id,
    name,
    description: asString(value.description),
    project: asString(value.project),
    assetIds: asStrings(value.assetIds),
    notes: asString(value.notes),
    createdAt,
    updatedAt: asString(value.updatedAt) ?? createdAt,
  };
}

async function readLibraryFile(): Promise<StoredLibrary> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(libraryFile(), "utf8"));
    if (!isRecord(parsed)) return emptyLibrary();

    return {
      assets: (Array.isArray(parsed.assets) ? parsed.assets : [])
        .map(readStoredAsset)
        .filter((asset): asset is StoredAsset => asset !== undefined),
      boards: (Array.isArray(parsed.boards) ? parsed.boards : [])
        .map(readStoredBoard)
        .filter((board): board is DesignBoard => board !== undefined),
    };
  } catch {
    // No library yet, or one that cannot be read: an empty library is the
    // honest state, and a write will lay a valid one down.
    return emptyLibrary();
  }
}

/**
 * Writes atomically, via a temp file and a rename.
 *
 * The library is the only record of what an image *means* — losing it to a
 * half-written file would leave a directory of anonymous PNGs.
 */
async function writeLibraryFile(library: StoredLibrary): Promise<void> {
  const target = libraryFile();
  await fs.mkdir(uiStateDir(), { recursive: true });

  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(library, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

/**
 * Serialises every change.
 *
 * Each mutation is a read-modify-write, so two overlapping requests could
 * otherwise read the same library and the second could erase the first's
 * change. Queuing them makes each one see the previous one's result.
 */
let queue: Promise<unknown> = Promise.resolve();

function transaction<T>(change: (library: StoredLibrary) => Promise<T> | T): Promise<T> {
  const next = queue.then(async () => {
    const library = await readLibraryFile();
    const result = await change(library);
    await writeLibraryFile(library);
    return result;
  });

  // The queue must survive a failed change, or one bad request would wedge
  // every later one.
  queue = next.catch(() => undefined);

  return next;
}

/** The wire model: URLs the browser can use, never paths. */
export function toWireAsset(
  asset: StoredAsset,
  boards: DesignBoard[],
): DesignAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    url: `/api/designs/assets/${asset.id}/media`,
    thumbnailUrl: `/api/designs/assets/${asset.id}/media${asset.hasThumbnail ? "?size=thumbnail" : ""}`,
    type: asset.type,
    project: asset.project,
    tags: asset.tags,
    favorite: asset.favorite,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
    prompt: asset.prompt,
    notes: asset.notes,
    // Defaults rather than a migration: an asset stored before Step 57 is a
    // still image nobody generated, which is exactly what these say.
    mediaType: asset.mediaType ?? "image",
    source: asset.source ?? (asset.type === "generated" ? "higgsfield" : "upload"),
    product: asset.product,
    provider: asset.provider,
    model: asset.model,
    generationId: asset.generationId,
    referenceAssetIds: asset.referenceAssetIds ?? [],
    approved: asset.approved ?? false,
    boardIds: boards
      .filter((board) => board.assetIds.includes(asset.id))
      .map((board) => board.id),
  };
}

/** Everything, newest asset first. */
export async function getLibrary(): Promise<DesignLibrary> {
  const library = await readLibraryFile();

  return {
    assets: library.assets
      .map((asset) => toWireAsset(asset, library.boards))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    boards: [...library.boards].sort((a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    ),
  };
}

/** One asset's stored record, for serving its file. */
export async function findStoredAsset(
  id: string,
): Promise<StoredAsset | undefined> {
  return (await readLibraryFile()).assets.find((asset) => asset.id === id);
}

export interface CreateAssetInput {
  id: string;
  filename: string;
  storedName: string;
  hasThumbnail: boolean;
  dimensions?: Dimensions;
  type: DesignAssetType;
  project?: string;
  product?: string;
  tags?: string[];
  prompt?: string;
  mediaType?: "image" | "video";
  source?: "higgsfield" | "upload" | "agentos" | "other";
  provider?: string;
  model?: string;
  generationId?: string;
  referenceAssetIds?: string[];
}

export async function createAsset(input: CreateAssetInput): Promise<DesignAsset> {
  return transaction((library) => {
    const asset: StoredAsset = {
      id: input.id,
      filename: input.filename,
      storedName: input.storedName,
      hasThumbnail: input.hasThumbnail,
      type: input.type,
      project: input.project,
      tags: input.tags ?? [],
      favorite: false,
      width: input.dimensions?.width,
      height: input.dimensions?.height,
      createdAt: new Date().toISOString(),
      prompt: input.prompt,
      mediaType: input.mediaType ?? "image",
      source: input.source ?? (input.type === "generated" ? "higgsfield" : "upload"),
      product: input.product,
      provider: input.provider,
      model: input.model,
      generationId: input.generationId,
      referenceAssetIds: input.referenceAssetIds,
      approved: false,
    };

    library.assets.push(asset);
    return toWireAsset(asset, library.boards);
  });
}

/**
 * What an asset's own screen can change.
 *
 * `undefined` means "leave it alone"; `null` clears a field. Without that
 * distinction there would be no way to un-assign a project.
 */
export interface AssetPatch {
  project?: string | null;
  /** `null` clears it, so an asset can stop belonging to a product. */
  product?: string | null;
  tags?: string[];
  favorite?: boolean;
  approved?: boolean;
  notes?: string | null;
  type?: DesignAssetType;
}

export async function updateAsset(
  id: string,
  patch: AssetPatch,
): Promise<DesignAsset | undefined> {
  return transaction((library) => {
    const asset = library.assets.find((entry) => entry.id === id);
    if (!asset) return undefined;

    if (patch.product !== undefined) {
      asset.product = patch.product?.trim() || undefined;
    }

    if (patch.approved !== undefined) {
      asset.approved = patch.approved;
    }

    if (patch.project !== undefined) {
      asset.project = patch.project ?? undefined;
    }
    if (patch.tags !== undefined) {
      // Tags are compared and searched lower-cased, so they are stored that way.
      asset.tags = [
        ...new Set(
          patch.tags
            .map((tag) => tag.trim().toLowerCase())
            .filter((tag) => tag.length > 0),
        ),
      ];
    }
    if (patch.favorite !== undefined) asset.favorite = patch.favorite;
    if (patch.notes !== undefined) asset.notes = patch.notes ?? undefined;
    if (patch.type !== undefined) asset.type = patch.type;

    return toWireAsset(asset, library.boards);
  });
}

/**
 * Removes an asset, its file, and its membership of every board.
 *
 * The file is deleted only once the metadata write has succeeded, so a failed
 * write can never leave a library pointing at an image that is gone.
 */
export async function deleteAsset(id: string): Promise<boolean> {
  const storedName = await transaction((library) => {
    const index = library.assets.findIndex((entry) => entry.id === id);
    if (index === -1) return undefined;

    const [removed] = library.assets.splice(index, 1);

    for (const board of library.boards) {
      board.assetIds = board.assetIds.filter((entry) => entry !== id);
    }

    return removed.storedName;
  });

  if (!storedName) return false;

  await deleteImage(storedName);
  return true;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
  project?: string;
}

export async function createBoard(input: CreateBoardInput): Promise<DesignBoard> {
  return transaction((library) => {
    const now = new Date().toISOString();

    const board: DesignBoard = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      project: input.project,
      assetIds: [],
      createdAt: now,
      updatedAt: now,
    };

    library.boards.push(board);
    return board;
  });
}

export interface BoardPatch {
  name?: string;
  description?: string | null;
  project?: string | null;
  notes?: string | null;
}

export async function updateBoard(
  id: string,
  patch: BoardPatch,
): Promise<DesignBoard | undefined> {
  return transaction((library) => {
    const board = library.boards.find((entry) => entry.id === id);
    if (!board) return undefined;

    if (patch.name !== undefined) board.name = patch.name;
    if (patch.description !== undefined) {
      board.description = patch.description ?? undefined;
    }
    if (patch.project !== undefined) board.project = patch.project ?? undefined;
    if (patch.notes !== undefined) board.notes = patch.notes ?? undefined;

    board.updatedAt = new Date().toISOString();
    return board;
  });
}

/** Removes the board only. The assets it collected are untouched. */
export async function deleteBoard(id: string): Promise<boolean> {
  return transaction((library) => {
    const index = library.boards.findIndex((entry) => entry.id === id);
    if (index === -1) return false;

    library.boards.splice(index, 1);
    return true;
  });
}

/** Adds or removes an asset. Membership lives on the board, and only there. */
export async function setBoardMembership(
  boardId: string,
  assetId: string,
  member: boolean,
): Promise<DesignBoard | undefined> {
  return transaction((library) => {
    const board = library.boards.find((entry) => entry.id === boardId);
    if (!board) return undefined;
    if (!library.assets.some((asset) => asset.id === assetId)) return undefined;

    const isMember = board.assetIds.includes(assetId);

    if (member && !isMember) board.assetIds.push(assetId);
    if (!member && isMember) {
      board.assetIds = board.assetIds.filter((entry) => entry !== assetId);
    }

    if (member !== isMember) board.updatedAt = new Date().toISOString();

    return board;
  });
}

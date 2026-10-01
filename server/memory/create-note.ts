import fs from "node:fs/promises";
import path from "node:path";
import {
  checkFolder,
  composeNote,
  normaliseTag,
  noteFileName,
  type CreateMemoryNoteRequest,
  type CreateMemoryNoteResponse,
} from "../../shared/memory-paths";
import { isMemoryType, type MemoryProvenance } from "../../shared/memory-types";
import { isExcluded, probeVault } from "./config";
import { patchFrontmatter } from "./frontmatter";
import { recordCreation } from "./mutations";
import type { MemoryService } from "./service";

/**
 * A person adding a note to the vault from AgentOS.
 *
 * A human edit, so it is written straight to the vault (the Step 53
 * convention; agents still go through review). It can only ever *create*:
 * the file is opened exclusively, so an existing note — including one that
 * differs only in case on the SSD's case-insensitive file system — is never
 * replaced. The path must stay inside the vault through any symlinked folder,
 * and nothing is written, not even a folder, while the drive is missing.
 */

export class CreateNoteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503,
  ) {
    super(message);
  }
}

const MAX_BODY = 200 * 1024;
const MAX_TAGS = 12;
const MAX_LINKS = 20;

/** The deepest part of `target` that exists, resolved; `undefined` if it is outside `realRoot`. */
async function containedAncestor(realRoot: string, target: string): Promise<string | undefined> {
  let current = target;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return real === realRoot || real.startsWith(realRoot + path.sep) ? real : undefined;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

/**
 * `provenance` is the server's to supply — the HTTP route passes a person,
 * task closeout passes the agent that proposed it and the task it came from.
 * Nothing in the request body can set it.
 */
export async function createMemoryNote(
  service: MemoryService,
  request: CreateMemoryNoteRequest,
  provenance: MemoryProvenance = { createdBy: "human" },
): Promise<CreateMemoryNoteResponse> {
  // Validate everything before touching the disk.
  const folder = checkFolder(typeof request.folder === "string" ? request.folder : "");
  if (!folder.ok) throw new CreateNoteError(folder.reason, 400);
  if (folder.folder && isExcluded(`${folder.folder}/x.md`)) {
    throw new CreateNoteError("That folder is kept out of memory, so a note there would never be indexed.", 400);
  }

  const title = typeof request.title === "string" ? request.title.trim() : "";
  const fileName = noteFileName(title);
  if (!fileName) throw new CreateNoteError("The note needs a title.", 400);

  const body = typeof request.body === "string" ? request.body : "";
  if (body.length > MAX_BODY) throw new CreateNoteError("The note is longer than 200 KB. Split it into smaller notes.", 400);

  const tags = [...new Set((request.tags ?? []).flatMap((tag) => (typeof tag === "string" ? [normaliseTag(tag)] : [])))].filter(
    (tag): tag is string => Boolean(tag),
  );
  if (tags.length > MAX_TAGS) throw new CreateNoteError(`A note can have at most ${MAX_TAGS} tags.`, 400);

  if (request.type !== undefined && request.type !== "" && !isMemoryType(request.type)) {
    throw new CreateNoteError("That is not a memory type.", 400);
  }
  const type = isMemoryType(request.type) ? request.type : undefined;

  const links = [...new Set((request.links ?? []).filter((id): id is string => typeof id === "string"))];
  if (links.length > MAX_LINKS) throw new CreateNoteError(`A note can link to at most ${MAX_LINKS} notes here; add more in Obsidian.`, 400);
  const missing = links.filter((id) => !service.index.notes.has(id));
  if (missing.length > 0) throw new CreateNoteError(`These notes are not in the vault: ${missing.join(", ")}.`, 400);

  const id = folder.folder ? `${folder.folder}/${fileName}` : fileName;
  const lower = id.toLowerCase();
  if ([...service.index.notes.keys()].some((existing) => existing.toLowerCase() === lower)) {
    throw new CreateNoteError(`There is already a note at ${id}.`, 409);
  }

  // The vault must be there. An unplugged SSD is refused, never recreated.
  const probe = await probeVault(service.root);
  if (!probe.available) throw new CreateNoteError(`The vault is not available: ${probe.reason}`, 503);

  const realRoot = await fs.realpath(service.root);
  const directory = path.resolve(service.root, folder.folder);
  const target = path.resolve(directory, fileName);
  if (!target.startsWith(path.resolve(service.root) + path.sep)) throw new CreateNoteError("That path is outside the vault.", 400);
  if (!(await containedAncestor(realRoot, directory))) throw new CreateNoteError("That folder leads outside the vault.", 400);

  // Which folders this creates, for the response and the activity log.
  const createdFolders: string[] = [];
  const segments = folder.folder ? folder.folder.split("/") : [];
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const relative = segments.slice(0, depth).join("/");
    try {
      await fs.stat(path.join(service.root, relative));
    } catch {
      createdFolders.push(relative);
    }
  }

  await fs.mkdir(directory, { recursive: true });
  // Checked again now the folders exist, in case one was a symlink made meanwhile.
  if (!(await containedAncestor(realRoot, directory))) throw new CreateNoteError("That folder leads outside the vault.", 400);

  const contents = patchFrontmatter(composeNote({ title, body, tags, links, allIds: [...service.index.notes.keys()] }), {
    type,
    createdBy: provenance.createdBy ?? "human",
    createdAt: provenance.createdAt ?? new Date().toISOString(),
    sourceProject: provenance.sourceProject,
    sourceTask: provenance.sourceTask,
    sourceRun: provenance.sourceRun,
    sourceArtifact: provenance.sourceArtifact,
    approvedBy: provenance.approvedBy,
  });
  try {
    await fs.writeFile(target, contents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CreateNoteError(`There is already a note at ${id}.`, 409);
    }
    throw error;
  }

  await recordCreation(id, contents, provenance.approvedBy ?? provenance.createdBy ?? "human", provenance.sourceTask).catch((error) => {
    console.error("[memory] could not record the note's creation:", error);
  });

  // Indexed before answering, so the tree, graph and note open at once.
  await service.reindex(new Set([id]));
  return { id, createdFolders };
}

/**
 * The vault's notes as a folder tree, and the rows it shows when some folders
 * are open. Pure, so it can be tested without a browser.
 */

export interface TreeNote {
  id: string;
  title: string;
}

export interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  notes: Array<TreeNote & { name: string }>;
  count: number;
}

export type Row =
  | { kind: "folder"; key: string; level: number; folder: FolderNode; parent?: string }
  | { kind: "note"; key: string; level: number; note: TreeNote & { name: string }; parent?: string };

export function buildTree(notes: readonly TreeNote[]): FolderNode {
  const root: FolderNode = { path: "", name: "", folders: [], notes: [], count: 0 };
  const folders = new Map<string, FolderNode>([["", root]]);

  const folderAt = (path: string): FolderNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = folderAt(slash < 0 ? "" : path.slice(0, slash));
    const created: FolderNode = { path, name: path.slice(slash + 1), folders: [], notes: [], count: 0 };
    parent.folders.push(created);
    folders.set(path, created);
    return created;
  };

  for (const note of notes) {
    const slash = note.id.lastIndexOf("/");
    const folder = folderAt(slash < 0 ? "" : note.id.slice(0, slash));
    folder.notes.push({ ...note, name: note.id.slice(slash + 1).replace(/\.md$/i, "") });
  }

  const finish = (folder: FolderNode): number => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.notes.sort((a, b) => a.name.localeCompare(b.name));
    folder.count = folder.notes.length + folder.folders.reduce((sum, child) => sum + finish(child), 0);
    return folder.count;
  };
  finish(root);
  return root;
}

export function flatten(root: FolderNode, expanded: ReadonlySet<string>, everything: boolean): Row[] {
  const rows: Row[] = [];
  const walk = (folder: FolderNode, level: number, parent?: string) => {
    for (const child of folder.folders) {
      const key = `folder:${child.path}`;
      rows.push({ kind: "folder", key, level, folder: child, parent });
      if (everything || expanded.has(child.path)) walk(child, level + 1, key);
    }
    for (const note of folder.notes) rows.push({ kind: "note", key: `note:${note.id}`, level, note, parent });
  };
  walk(root, 1);
  return rows;
}

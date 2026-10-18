import type { KnowledgeNote } from "../session/model";
import { notePath, parentPath, pathKey } from "../notes/paths";

export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  notes: KnowledgeNote[];
}
export interface TreeEditing {
  kind: "create" | "rename";
  parent: string;
  path: string;
}
type RowBase = { key: string; depth: number; parent: string; position: number; siblings: number };
export type NoteTreeRow = RowBase &
  (
    | { kind: "folder"; folder: FolderNode; expanded: boolean }
    | { kind: "note"; note: KnowledgeNote }
    | { kind: "edit"; initial: string }
  );

/** Build and sort once per immutable collection, rather than during every rendered branch. */
export function buildNoteTree(
  notes: readonly KnowledgeNote[],
  folders: readonly string[] = [],
): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], notes: [] };
  const paths = new Map<string, FolderNode>([["", root]]);
  const descend = (path: string) => {
    let node = root,
      current = "";
    for (const name of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${name}` : name;
      const key = pathKey(current);
      let folder = paths.get(key);
      if (!folder) {
        folder = { name, path: current, folders: [], notes: [] };
        paths.set(key, folder);
        node.folders.push(folder);
      }
      node = folder;
    }
    return node;
  };
  for (const note of notes) descend(parentPath(notePath(note))).notes.push(note);
  for (const folder of folders) descend(folder);
  for (const folder of paths.values()) {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.notes.sort((a, b) => (a.title || "未命名笔记").localeCompare(b.title || "未命名笔记"));
  }
  return root;
}

/** Collapsed descendants are absent from the row model and never mounted. */
export function visibleNoteRows(
  root: FolderNode,
  collapsed: readonly string[],
  editing?: TreeEditing | null,
): NoteTreeRow[] {
  const hidden = new Set(collapsed.map(pathKey)),
    rows: NoteTreeRow[] = [];
  const visit = (node: FolderNode, depth: number) => {
    const create = editing?.kind === "create" && pathKey(editing.parent) === pathKey(node.path);
    const siblings = node.folders.length + node.notes.length + Number(create);
    let position = 0;
    if (create)
      rows.push({
        kind: "edit",
        key: `create:${node.path}`,
        initial: "",
        depth,
        parent: node.path,
        position: ++position,
        siblings,
      });
    for (const folder of node.folders) {
      const base = {
        key: `folder:${folder.path}`,
        depth,
        parent: node.path,
        position: ++position,
        siblings,
      };
      if (editing?.kind === "rename" && editing.path === folder.path) {
        rows.push({ ...base, kind: "edit", initial: folder.name });
        continue;
      }
      const expanded = !hidden.has(pathKey(folder.path));
      rows.push({ ...base, kind: "folder", folder, expanded });
      if (expanded) visit(folder, depth + 1);
    }
    for (const note of node.notes)
      rows.push({
        kind: "note",
        key: `note:${note.id}`,
        note,
        depth,
        parent: node.path,
        position: ++position,
        siblings,
      });
  };
  visit(root, 0);
  return rows;
}

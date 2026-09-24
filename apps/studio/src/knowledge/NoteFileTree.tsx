import { FileText, Folder, FolderInput } from "lucide-react";
import { useMemo } from "react";
import type { KnowledgeNote } from "./model";
import { notePath, pathKey } from "./paths";

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  notes: KnowledgeNote[];
}
export function NoteFileTree({
  notes,
  activeId,
  onSelect,
  onMoveFolder,
}: {
  notes: KnowledgeNote[];
  activeId?: string | undefined;
  onSelect: (id: string) => void;
  onMoveFolder: (path: string) => void;
}) {
  const root = useMemo(() => {
    const root: FolderNode = { name: "", path: "", folders: new Map(), notes: [] };
    for (const note of notes) {
      const segments = notePath(note).split("/");
      let node = root;
      for (const name of segments.slice(0, -1)) {
        const key = pathKey(name);
        if (!node.folders.has(key))
          node.folders.set(key, {
            name,
            path: `${node.path ? `${node.path}/` : ""}${name}`,
            folders: new Map(),
            notes: [],
          });
        node = node.folders.get(key)!;
      }
      node.notes.push(note);
    }
    return root;
  }, [notes]);
  function render(node: FolderNode) {
    return (
      <ul>
        {[...node.folders.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folder) => (
            <li key={folder.path}>
              <details open className="knowledge-file-folder">
                <summary>
                  <Folder size={15} aria-hidden="true" />
                  <span>{folder.name}</span>
                </summary>
                <button
                  type="button"
                  className="knowledge-folder-move"
                  aria-label={`移动文件夹 ${folder.path}`}
                  onClick={() => onMoveFolder(folder.path)}
                >
                  <FolderInput size={15} aria-hidden="true" />
                </button>
                {render(folder)}
              </details>
            </li>
          ))}
        {node.notes
          .toSorted((a, b) => notePath(a).localeCompare(notePath(b)))
          .map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="knowledge-file-note"
                aria-current={note.id === activeId ? "page" : undefined}
                title={`${note.title || "未命名笔记"}\n${notePath(note)}`}
                onClick={() => onSelect(note.id)}
              >
                <FileText size={15} aria-hidden="true" />
                <span>{note.path ? note.path.split("/").at(-1) : note.title || "未命名笔记"}</span>
              </button>
            </li>
          ))}
      </ul>
    );
  }
  return <div className="knowledge-file-tree">{render(root)}</div>;
}

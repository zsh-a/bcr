import { FileText, Folder, FolderInput } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { IconButton } from "@bcr/react";
import { noteWhen } from "../editor/format";
import { type KnowledgeNote } from "../session/model";
import { notePath, parentPath, pathKey } from "../notes/paths";

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  notes: KnowledgeNote[];
}

export type TreeTarget =
  | { kind: "note"; id: string }
  | { kind: "folder"; path: string }
  | { kind: "root" };
export type TreeDrag = { kind: "note"; id: string } | { kind: "folder"; path: string };

/** 行内目录名输入：Enter 提交、Esc 放弃、失焦按提交收尾（空值由调用方视为放弃）。 */
function FolderEdit({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.select();
  }, []);
  return (
    <div className="knowledge-tree-edit">
      <Folder size={15} aria-hidden="true" />
      <input
        ref={input}
        autoFocus
        aria-label="目录名称"
        placeholder="目录名称，可用 / 分层"
        defaultValue={initial}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            done.current = true;
            onCommit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={(event) => {
          if (done.current) return;
          done.current = true;
          onCommit(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/**
 * 文件夹树：文件系统式目录结构，是侧栏唯一的笔记列表，也充当移动表单的文件夹选择器。
 * 文件夹 = 笔记路径推导 ∪ 显式目录登记；笔记行标签用标题（逻辑路径退到 title 提示），
 * 尾随相对时间，空笔记降级为一行静默标题。展开/折叠走原生 details，键盘可达。
 *
 * 侧栏形态额外支持：右键菜单（onMenu）、拖放移动（onDropMove）与行内新建/重命名目录
 * （editing + onEditCommit/onEditCancel）。选择器形态不传这些交互，只保留点击选择。
 * 单击选中笔记（onSelect），双击或 Enter 显式打开标签（onOpen）。
 */
export function NoteFileTree({
  notes,
  activeId,
  folders,
  editing,
  onSelect,
  onOpen,
  onMoveFolder,
  onEditCommit,
  onEditCancel,
  onMenu,
  onDropMove,
}: {
  notes: KnowledgeNote[];
  activeId?: string | undefined;
  folders?: readonly string[] | undefined;
  editing?: { kind: "create" | "rename"; parent: string; path: string } | null | undefined;
  onSelect: (id: string) => void;
  onOpen?: ((id: string) => void) | undefined;
  onMoveFolder: (path: string) => void;
  onEditCommit?: ((value: string) => void) | undefined;
  onEditCancel?: (() => void) | undefined;
  onMenu?: ((event: MouseEvent, target: TreeTarget) => void) | undefined;
  onDropMove?: ((payload: TreeDrag, destination: string) => void) | undefined;
}) {
  const root = useMemo(() => {
    const root: FolderNode = { name: "", path: "", folders: new Map(), notes: [] };
    const descend = (path: string) => {
      let node = root;
      let current = "";
      for (const name of path.split("/").filter(Boolean)) {
        current = current ? `${current}/${name}` : name;
        const key = pathKey(name);
        if (!node.folders.has(key))
          node.folders.set(key, { name, path: current, folders: new Map(), notes: [] });
        node = node.folders.get(key)!;
      }
      return node;
    };
    for (const note of notes) descend(parentPath(notePath(note))).notes.push(note);
    for (const folder of folders ?? []) descend(folder);
    return root;
  }, [notes, folders]);

  const drag = useRef<TreeDrag | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const droppable = (payload: TreeDrag, destination: string) =>
    payload.kind === "folder"
      ? pathKey(destination) !== pathKey(payload.path) &&
        !pathKey(destination).startsWith(`${pathKey(payload.path)}/`)
      : true;
  const dropProps = (payload: TreeDrag, destination: string, key: string) =>
    onDropMove
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            drag.current = payload;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", destination || "/");
          },
          onDragEnd: () => {
            drag.current = null;
            setDrop(null);
          },
          onDragOver: (event: DragEvent) => {
            const current = drag.current;
            if (!current || !droppable(current, destination)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDrop(key);
          },
          onDragLeave: () => setDrop((value) => (value === key ? null : value)),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const current = drag.current;
            drag.current = null;
            setDrop(null);
            if (current && droppable(current, destination)) onDropMove(current, destination);
          },
        }
      : {};
  const menuProps = (target: TreeTarget) =>
    onMenu
      ? {
          onContextMenu: (event: MouseEvent) => {
            event.stopPropagation();
            onMenu(event, target);
          },
        }
      : {};

  function render(node: FolderNode) {
    return (
      <ul>
        {editing?.kind === "create" && editing.parent === node.path && (
          <li>
            <FolderEdit
              initial=""
              onCommit={(value) => onEditCommit?.(value)}
              onCancel={() => onEditCancel?.()}
            />
          </li>
        )}
        {[...node.folders.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folder) => (
            <li key={folder.path}>
              {editing?.kind === "rename" && editing.path === folder.path ? (
                <FolderEdit
                  initial={folder.name}
                  onCommit={(value) => onEditCommit?.(value)}
                  onCancel={() => onEditCancel?.()}
                />
              ) : (
                <details open className="knowledge-file-folder">
                  <summary
                    data-drop={drop === folder.path ? "true" : undefined}
                    {...dropProps({ kind: "folder", path: folder.path }, folder.path, folder.path)}
                    {...menuProps({ kind: "folder", path: folder.path })}
                  >
                    <Folder size={15} aria-hidden="true" />
                    <span>{folder.name}</span>
                  </summary>
                  <IconButton
                    label={`移动文件夹 ${folder.path}`}
                    className="knowledge-folder-move"
                    size="sm"
                    onClick={() => onMoveFolder(folder.path)}
                  >
                    <FolderInput size={15} aria-hidden="true" />
                  </IconButton>
                  {render(folder)}
                </details>
              )}
            </li>
          ))}
        {node.notes
          .toSorted((a, b) => (a.title || "未命名笔记").localeCompare(b.title || "未命名笔记"))
          .map((note) => {
            const title = note.title || "未命名笔记";
            const key = `note:${note.id}`;
            return (
              <li key={note.id}>
                <button
                  type="button"
                  className="knowledge-file-note"
                  data-empty={!note.title.trim() && !note.body.trim() ? "true" : undefined}
                  data-drop={drop === key ? "true" : undefined}
                  aria-current={note.id === activeId ? "page" : undefined}
                  title={`${title}\n${notePath(note)}`}
                  onClick={() => onSelect(note.id)}
                  onDoubleClick={() => onOpen?.(note.id)}
                  onKeyDown={(event) => {
                    if (!onOpen || event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    onOpen(note.id);
                  }}
                  {...dropProps({ kind: "note", id: note.id }, parentPath(notePath(note)), key)}
                  {...menuProps({ kind: "note", id: note.id })}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span>{title}</span>
                  <time aria-hidden="true" dateTime={new Date(note.updatedAt).toISOString()}>
                    {noteWhen(note.updatedAt)}
                  </time>
                </button>
              </li>
            );
          })}
      </ul>
    );
  }
  return (
    <div
      className="knowledge-file-tree"
      data-drop={drop === "" ? "true" : undefined}
      {...menuProps({ kind: "root" })}
      onDragOver={(event) => {
        const current = drag.current;
        if (!current || !droppable(current, "")) return;
        event.preventDefault();
        setDrop("");
      }}
      onDrop={(event) => {
        event.preventDefault();
        const current = drag.current;
        drag.current = null;
        setDrop(null);
        if (current && droppable(current, "")) onDropMove?.(current, "");
      }}
    >
      {render(root)}
    </div>
  );
}

import { Ellipsis, FileText, Folder, FolderInput } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  buildNoteTree,
  visibleNoteRows,
  type TreeEditing,
  type NoteTreeRow,
} from "./noteTreeModel";
import { IconButton } from "@bcr/react";
import { noteWhen } from "../editor/format";
import { type KnowledgeNote } from "../session/model";
import { notePath, parentPath, pathKey } from "../notes/paths";

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
        data-tree-focus=""
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
 * 尾随相对时间，空笔记降级为一行静默标题。只展开可见分支；大列表按视口虚拟化，方向键可达。
 *
 * 侧栏形态额外支持：右键菜单（onMenu）、拖放移动（onDropMove）与行内新建/重命名目录
 * （editing + onEditCommit/onEditCancel）。选择器形态不传这些交互，只保留点击选择。
 * 单击选中笔记（onSelect），双击或 Enter 显式打开标签（onOpen）。
 */
export function NoteFileTree({
  notes,
  activeId,
  folders,
  collapsedFolders,
  onToggleFolder,
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
  collapsedFolders?: readonly string[] | undefined;
  onToggleFolder?: ((path: string, expanded: boolean) => void) | undefined;
  editing?: TreeEditing | null | undefined;
  onSelect: (id: string) => void;
  onOpen?: ((id: string) => void) | undefined;
  onMoveFolder: (path: string) => void;
  onEditCommit?: ((value: string) => void) | undefined;
  onEditCancel?: (() => void) | undefined;
  onMenu?: ((event: MouseEvent, target: TreeTarget) => void) | undefined;
  onDropMove?: ((payload: TreeDrag, destination: string) => void) | undefined;
}) {
  const root = useMemo(() => buildNoteTree(notes, folders), [notes, folders]);
  const element = useRef<HTMLDivElement>(null);
  const [localCollapsed, setLocalCollapsed] = useState<readonly string[]>([]);
  const collapsed = collapsedFolders ?? localCollapsed;
  const rows = useMemo(() => visibleNoteRows(root, collapsed, editing), [root, collapsed, editing]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);
  const focused = Math.max(
    0,
    rows.findIndex((row) => row.key === (focusKey ?? `note:${activeId}`)),
  );
  const virtual = rows.length > 100;
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!virtual) return;
    const tree = element.current;
    const parent = tree?.closest<HTMLElement>(".knowledge-note-list, .knowledge-move-picker");
    if (!tree || !parent) return;
    const update = () =>
      setScrollMargin(
        tree.getBoundingClientRect().top -
          parent.getBoundingClientRect().top +
          parent.scrollTop -
          parent.clientTop,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [virtual]);
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () =>
      element.current?.closest<HTMLElement>(".knowledge-note-list, .knowledge-move-picker") ?? null,
    estimateSize: () => (matchMedia("(width <= 45em)").matches ? 52 : 44),
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
    scrollMargin,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          focused,
          ...rows.flatMap((row, index) => (row.kind === "edit" ? [index] : [])),
        ]),
      ]
        .filter((index) => index >= 0 && index < rows.length)
        .sort((a, b) => a - b),
  });
  const setExpanded = (path: string, expanded: boolean) => {
    if (onToggleFolder) onToggleFolder(path, expanded);
    else
      setLocalCollapsed((current) =>
        expanded ? current.filter((item) => item !== pathKey(path)) : [...current, pathKey(path)],
      );
  };
  const focusRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    focusAfter.current = row.key;
    setFocusKey(row.key);
    if (virtual) virtualizer.scrollToIndex(index, { align: "auto" });
  };
  useLayoutEffect(() => {
    if (!focusAfter.current) return;
    const index = rows.findIndex((row) => row.key === focusAfter.current);
    const target = element.current?.querySelector<HTMLElement>(
      `[data-tree-index="${index}"] [data-tree-focus]`,
    );
    if (target) {
      target.focus({ preventScroll: virtual });
      focusAfter.current = null;
    }
  });
  const navigate = (event: KeyboardEvent, row: NoteTreeRow, index: number) => {
    if (event.nativeEvent.isComposing || event.target !== event.currentTarget) return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusRow(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))),
      );
    } else if (event.key === "ArrowLeft") {
      if (row.kind === "folder" && row.expanded) setExpanded(row.folder.path, false);
      else
        focusRow(
          rows.findIndex((item) => item.kind === "folder" && item.folder.path === row.parent),
        );
      event.preventDefault();
    } else if (event.key === "ArrowRight" && row.kind === "folder") {
      event.preventDefault();
      if (!row.expanded) setExpanded(row.folder.path, true);
      else if (rows[index + 1]?.parent === row.folder.path) focusRow(index + 1);
    }
  };
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

  function renderRow(row: NoteTreeRow, index: number) {
    const accessibility = {
      "aria-level": row.depth + 1,
      "aria-posinset": row.position,
      "aria-setsize": row.siblings,
    };
    if (row.kind === "edit")
      return (
        <FolderEdit
          initial={row.initial}
          onCommit={(value) => onEditCommit?.(value)}
          onCancel={() => onEditCancel?.()}
        />
      );
    if (row.kind === "folder") {
      const { folder, expanded } = row;
      return (
        <details open={expanded} className="knowledge-file-folder">
          <summary
            role="treeitem"
            {...accessibility}
            aria-expanded={expanded}
            data-tree-focus=""
            tabIndex={index === focused ? 0 : -1}
            data-drop={drop === folder.path ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setExpanded(folder.path, !expanded);
            }}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
                event.preventDefault();
                setExpanded(folder.path, !expanded);
              } else navigate(event, row, index);
            }}
            {...dropProps({ kind: "folder", path: folder.path }, folder.path, folder.path)}
            {...menuProps({ kind: "folder", path: folder.path })}
          >
            <Folder size={15} aria-hidden="true" />
            <span>{folder.name}</span>
            <IconButton
              label={onMenu ? `目录操作：${folder.path}` : `移动文件夹 ${folder.path}`}
              className="knowledge-folder-move"
              aria-haspopup={onMenu ? "menu" : undefined}
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (onMenu) onMenu(event, { kind: "folder", path: folder.path });
                else onMoveFolder(folder.path);
              }}
            >
              {onMenu ? <Ellipsis size={18} /> : <FolderInput size={15} aria-hidden="true" />}
            </IconButton>
          </summary>
        </details>
      );
    }
    const { note } = row,
      title = note.title || "未命名笔记";
    return (
      <div className="knowledge-file-entry">
        <button
          type="button"
          role="treeitem"
          {...accessibility}
          className="knowledge-file-note"
          data-tree-focus=""
          tabIndex={index === focused ? 0 : -1}
          data-empty={!note.title.trim() && !note.body.trim() ? "true" : undefined}
          data-drop={drop === row.key ? "true" : undefined}
          aria-current={note.id === activeId ? "page" : undefined}
          title={`${title}\n${notePath(note)}`}
          onClick={() => onSelect(note.id)}
          onDoubleClick={() => onOpen?.(note.id)}
          onKeyDown={(event) => {
            navigate(event, row, index);
            if (!onOpen || event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onOpen(note.id);
          }}
          {...dropProps({ kind: "note", id: note.id }, parentPath(notePath(note)), row.key)}
          {...menuProps({ kind: "note", id: note.id })}
        >
          <FileText size={15} aria-hidden="true" />
          <span>{title}</span>
          <time aria-hidden="true" dateTime={new Date(note.updatedAt).toISOString()}>
            {noteWhen(note.updatedAt)}
          </time>
        </button>
        {onMenu && (
          <IconButton
            className="knowledge-file-actions"
            label={`笔记操作：${title}`}
            aria-haspopup="menu"
            onClick={(event) => onMenu(event, { kind: "note", id: note.id })}
          >
            <Ellipsis size={18} />
          </IconButton>
        )}
      </div>
    );
  }
  return (
    <div
      ref={element}
      className="knowledge-file-tree"
      data-virtual={virtual ? "true" : undefined}
      onFocusCapture={(event) => {
        const row = (event.target as Element).closest<HTMLElement>("[data-tree-index]");
        const item = rows[Number(row?.dataset.treeIndex)];
        if (item) setFocusKey(item.key);
      }}
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
      <ul
        role="tree"
        aria-label="笔记目录"
        style={virtual ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
      >
        {(virtual
          ? virtualizer.getVirtualItems()
          : rows.map((_, index) => ({ index, key: rows[index]!.key, start: 0 }))
        ).map((item) => {
          const row = rows[item.index]!;
          return (
            <li
              key={row.key}
              role="none"
              data-tree-index={item.index}
              ref={virtual ? virtualizer.measureElement : undefined}
              data-index={item.index}
              style={{
                paddingInlineStart: `${row.depth * 20}px`,
                ...(virtual
                  ? {
                      position: "absolute",
                      insetInline: 0,
                      top: 0,
                      transform: `translateY(${item.start - scrollMargin}px)`,
                    }
                  : {}),
              }}
            >
              {renderRow(row, item.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

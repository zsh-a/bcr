import { useEffect, useRef, useState } from "react";
import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { TransactionSpec } from "@codemirror/state";
import { Button, ContextMenu, Dialog, Input, Toast, type ContextMenuAction } from "@bcr/react";
import {
  ArrowLeft,
  Bold,
  ClipboardPaste,
  Code,
  Copy,
  ExternalLink,
  FilePlus2,
  ImagePlus,
  Italic,
  Link,
  List,
  ListTodo,
  MessageSquare,
  Paperclip,
  Quote,
  Redo2,
  Scissors,
  Search,
  Strikethrough,
  Type,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  editorBlocks,
  editorFormats,
  inlineFormat,
  inlineCodeContext,
  insertBlock,
  lineFormat,
  proseContext,
  runEditorEdit,
} from "./editorCommands";
import {
  editorLinkMarkdown,
  editorUnlink,
  safeEditorLink,
  targetValid,
  type EditorTarget,
} from "./editorContext";
import type { EditorView } from "@codemirror/view";
import "./editorContext.css";

type MenuPage = "root" | "format" | "insert";
const formatIcons = { bold: Bold, italic: Italic, strike: Strikethrough, "inline-code": Code };
const stale = "正文或选区已变化，请重新选择后操作。";

/** React surfaces only; every body edit goes through the existing CodeMirror state/history. */
export function EditorContextMenu({
  target,
  readOnly,
  onClose,
  onOpenLink,
  onAskAi,
  onPick,
  onFiles,
}: {
  target: EditorTarget | null;
  readOnly: boolean;
  onClose: () => void;
  onOpenLink?: ((target: string) => void) | undefined;
  onAskAi?: (() => void) | undefined;
  onPick?: ((view: EditorView, image: boolean) => void) | undefined;
  onFiles?: ((view: EditorView, files: File[]) => void) | undefined;
}) {
  const [navigation, setNavigation] = useState<{ target: EditorTarget | null; page: MenuPage }>({
    target: null,
    page: "root",
  });
  const page = navigation.target === target ? navigation.page : "root";
  const setPage = (page: MenuPage) => setNavigation({ target, page });
  const [notice, setNotice] = useState("");
  const [editingLink, setEditingLink] = useState<{
    target: EditorTarget;
    label: string;
    url: string;
    error: string;
  } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const modifier = /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl+";
  const fail = (message: string) => {
    if (alive.current) setNotice(message);
  };
  const valid = (current: EditorTarget, writable = true) => {
    if (targetValid(current, writable)) return true;
    fail(stale);
    return false;
  };
  const edit = (current: EditorTarget, command: (view: EditorView) => TransactionSpec) => {
    if (valid(current)) runEditorEdit(current.view, command(current.view));
  };
  async function copy(
    current: EditorTarget,
    cut = false,
    text = current.doc.sliceString(current.from, current.to),
  ) {
    if (!valid(current, cut)) return;
    try {
      await navigator.clipboard.writeText(text);
      if (cut && valid(current))
        runEditorEdit(current.view, {
          changes: { from: current.from, to: current.to, insert: "" },
          selection: { anchor: current.from },
          userEvent: "delete.cut",
        });
    } catch {
      fail(`浏览器无法写入剪贴板，请回到正文使用 ${modifier}${cut ? "X" : "C"}。`);
    }
  }
  async function paste(current: EditorTarget) {
    if (!valid(current)) return;
    try {
      let text = "";
      const files: File[] = [];
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/plain"))
            text += await (await item.getType("text/plain")).text();
          else if (onFiles) {
            const type = item.types.find((mime) => mime.startsWith("image/"));
            if (type)
              files.push(
                new File([await item.getType(type)], `剪贴板图片.${type.split("/")[1]}`, { type }),
              );
          }
        }
      } else text = await navigator.clipboard.readText();
      if (!valid(current)) return;
      if (text)
        runEditorEdit(current.view, {
          changes: { from: current.from, to: current.to, insert: text },
          selection: { anchor: current.from + text.length },
          userEvent: "input.paste",
          scrollIntoView: true,
        });
      else if (files.length) onFiles?.(current.view, files);
      else fail(`剪贴板中没有可插入的文字或图片。也可以使用 ${modifier}V 粘贴。`);
    } catch {
      fail(`浏览器无法读取剪贴板，请回到正文使用 ${modifier}V。`);
    }
  }
  function linkDialog(current: EditorTarget) {
    if (!valid(current)) return;
    setEditingLink({
      target: current,
      label: current.link?.label ?? current.doc.sliceString(current.from, current.to),
      url: current.link?.url ?? "",
      error: "",
    });
  }

  let actions: ContextMenuAction[] = [];
  if (target) {
    const { view, from, to, link } = target;
    const selected = from !== to,
      writable = !readOnly && !view.state.readOnly;
    const prose = proseContext(view.state, target.pos);
    const code = !!inlineCodeContext(view.state, target.pos);
    const specificLink = link && (!selected || (from === link.from && to === link.to));
    const back: ContextMenuAction = {
      id: "back",
      label: "返回",
      icon: <ArrowLeft />,
      keepOpen: true,
      run: () => setPage("root"),
    };
    const history: ContextMenuAction[] = [
      {
        id: "undo",
        label: "撤销",
        icon: <Undo2 />,
        shortcut: `${modifier}Z`,
        separated: selected || !!specificLink,
        disabled: !writable || !undoDepth(view.state),
        run: () => {
          if (valid(target)) {
            undo(view);
            view.focus();
          }
        },
      },
      {
        id: "redo",
        label: "重做",
        icon: <Redo2 />,
        shortcut: `${modifier}⇧Z`,
        disabled: !writable || !redoDepth(view.state),
        run: () => {
          if (valid(target)) {
            redo(view);
            view.focus();
          }
        },
      },
    ];
    const search: ContextMenuAction = {
      id: "search",
      label: "查找正文",
      icon: <Search />,
      shortcut: `${modifier}F`,
      run: () => {
        if (valid(target, false)) openSearchPanel(view);
      },
    };
    const ai: ContextMenuAction = {
      id: "ai",
      label: "询问 AI",
      icon: <MessageSquare />,
      separated: true,
      run: () => {
        if (valid(target)) onAskAi?.();
      },
    };
    if (page === "format") {
      actions = [
        back,
        ...editorFormats.map((format, i) => {
          const Icon = formatIcons[format.id];
          return {
            id: format.id,
            label: format.label,
            icon: <Icon />,
            shortcut: `${modifier}${format.hint}`,
            separated: i === 0,
            disabled:
              !writable ||
              (!prose && !(code && format.id === "inline-code")) ||
              (format.id === "inline-code" && target.doc.sliceString(from, to).includes("\n")),
            run: () => edit(target, (v) => inlineFormat(v.state, format.marker)),
          };
        }),
        ...editorBlocks
          .filter((block) => ["h1", "h2", "h3", "list", "task", "quote"].includes(block.id))
          .map((block, i) => {
            const Icon =
              block.id === "list"
                ? List
                : block.id === "task"
                  ? ListTodo
                  : block.id === "quote"
                    ? Quote
                    : Type;
            return {
              id: block.id,
              label: block.label,
              icon: <Icon />,
              separated: i === 0,
              disabled: !writable || !prose,
              run: () => edit(target, (v) => lineFormat(v.state, block.text())),
            };
          }),
      ];
    } else if (page === "insert") {
      actions = [
        back,
        {
          id: "link",
          label: "链接…",
          icon: <Link />,
          separated: true,
          disabled: !writable || !prose,
          run: () => linkDialog(target),
        },
        ...(onPick
          ? [false, true].map((image) => ({
              id: image ? "image" : "file",
              label: image ? "图片…" : "附件…",
              icon: image ? <ImagePlus /> : <Paperclip />,
              disabled: !writable,
              run: () => {
                if (valid(target)) onPick(view, image);
              },
            }))
          : []),
        ...editorBlocks
          .filter((block) => ["code", "table", "divider", "date"].includes(block.id))
          .map((block, i) => ({
            id: block.id,
            label: block.label,
            icon: <FilePlus2 />,
            separated: i === 0,
            disabled: !writable || !prose,
            run: () => edit(target, (v) => insertBlock(v.state, block.id)),
          })),
      ];
    } else if (specificLink) {
      actions = [
        {
          id: "open-link",
          label: link.internal ? "打开关联笔记" : "打开链接",
          icon: <ExternalLink />,
          disabled: link.internal ? !onOpenLink : !safeEditorLink(link.url),
          run: () => {
            if (valid(target, false)) {
              if (link.internal) onOpenLink?.(link.target);
              else window.open(link.url, "_blank", "noopener,noreferrer");
            }
          },
        },
        {
          id: "copy-link",
          label: "复制链接地址",
          icon: <Copy />,
          run: () => void copy(target, false, link.url),
        },
        ...(writable
          ? [
              {
                id: "edit-link",
                label: "编辑链接…",
                icon: <Link />,
                run: () => linkDialog(target),
              },
              {
                id: "unlink",
                label: "移除链接",
                icon: <Unlink />,
                run: () =>
                  edit(target, () => ({
                    changes: { from: link.from, to: link.to, insert: editorUnlink(target) },
                    selection: { anchor: link.from + editorUnlink(target).length },
                    userEvent: "input",
                  })),
              },
              ...history,
            ]
          : []),
        search,
      ];
    } else {
      actions = [
        ...(selected
          ? [
              {
                id: "copy",
                label: "复制",
                icon: <Copy />,
                shortcut: `${modifier}C`,
                run: () => void copy(target),
              },
            ]
          : []),
        ...(writable
          ? [
              ...(selected
                ? [
                    {
                      id: "cut",
                      label: "剪切",
                      icon: <Scissors />,
                      shortcut: `${modifier}X`,
                      run: () => void copy(target, true),
                    },
                  ]
                : []),
              {
                id: "paste",
                label: "粘贴",
                icon: <ClipboardPaste />,
                shortcut: `${modifier}V`,
                run: () => void paste(target),
              },
              ...history,
              {
                id: "format",
                label: "格式",
                icon: <Bold />,
                separated: true,
                submenu: true,
                disabled: !prose && !code,
                run: () => setPage("format"),
              },
              {
                id: "insert",
                label: "插入",
                icon: <FilePlus2 />,
                submenu: true,
                run: () => setPage("insert"),
              },
            ]
          : []),
        ...(!writable || !selected ? [search] : []),
        ...(onAskAi && writable ? [ai] : []),
      ];
    }
  }

  return (
    <>
      {target && (
        <ContextMenu
          label="正文操作"
          {...(page === "root"
            ? {}
            : { title: page === "format" ? "格式" : "插入", onBack: () => setPage("root") })}
          page={page}
          x={target.x}
          y={target.y}
          trigger={target.view.contentDOM}
          actions={actions}
          onClose={onClose}
        />
      )}
      {editingLink && (
        <Dialog
          open
          title={editingLink.target.link ? "编辑链接" : "插入链接"}
          onClose={() => setEditingLink(null)}
          className="knowledge-link-dialog"
        >
          <form
            className="knowledge-link-form"
            onSubmit={(event) => {
              event.preventDefault();
              const { target: current, label, url } = editingLink;
              const error = !targetValid(current)
                ? stale
                : !safeEditorLink(url)
                  ? "请输入有效的网址、笔记名称或路径。网址支持 http、https 和 mailto。"
                  : "";
              if (error) {
                setEditingLink({ ...editingLink, error });
                return;
              }
              try {
                const markdown = editorLinkMarkdown(current, label.trim(), url.trim());
                const from = current.link?.from ?? current.from,
                  to = current.link?.to ?? current.to;
                runEditorEdit(current.view, {
                  changes: { from, to, insert: markdown },
                  selection: { anchor: from + markdown.length },
                  userEvent: "input",
                  scrollIntoView: true,
                });
                setEditingLink(null);
              } catch (reason) {
                setEditingLink({
                  ...editingLink,
                  error: reason instanceof Error ? reason.message : String(reason),
                });
              }
            }}
          >
            <label>
              显示文字
              <Input
                aria-label="链接显示文字"
                autoFocus
                value={editingLink.label}
                onChange={(event) =>
                  setEditingLink({ ...editingLink, label: event.target.value, error: "" })
                }
              />
            </label>
            <label>
              链接目标
              <Input
                aria-label="链接目标"
                required
                placeholder="https://… 或笔记名称、路径"
                value={editingLink.url}
                onChange={(event) =>
                  setEditingLink({ ...editingLink, url: event.target.value, error: "" })
                }
              />
            </label>
            <p className="knowledge-hint">笔记名称和路径会作为知识库内部链接打开。</p>
            {editingLink.error && (
              <p role="alert" className="knowledge-alert">
                {editingLink.error}
              </p>
            )}
            <div className="knowledge-dialog-actions">
              <Button type="button" onClick={() => setEditingLink(null)}>
                取消
              </Button>
              <Button type="submit" variant="primary">
                {editingLink.target.link ? "保存链接" : "插入链接"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      <Toast
        notice={notice ? { message: notice, tone: "warning" } : null}
        onDismiss={() => setNotice("")}
      />
    </>
  );
}

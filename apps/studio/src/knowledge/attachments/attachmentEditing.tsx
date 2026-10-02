import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import type { KnowledgeStore } from "../session/store";
import {
  attachmentMarkdown,
  attachmentReferences,
  type AttachmentReference,
} from "./attachmentModel";
import { AttachmentInline } from "./AttachmentView";

type Anchor = { id: string; from: number; to: number };
const addAnchor = StateEffect.define<Anchor>(),
  removeAnchor = StateEffect.define<string>();
const anchors = StateField.define<Anchor[]>({
  create: () => [],
  update(value, transaction) {
    let next = value
      .filter(
        (item) => item.from === item.to || !transaction.changes.touchesRange(item.from, item.to),
      )
      .map((item) => ({
        ...item,
        from: transaction.changes.mapPos(item.from, 1),
        to: transaction.changes.mapPos(item.to, 1),
      }));
    for (const effect of transaction.effects) {
      if (effect.is(addAnchor)) next = [...next, effect.value];
      if (effect.is(removeAnchor)) next = next.filter((item) => item.id !== effect.value);
    }
    return next;
  },
});
const refsMemo = new WeakMap<Text, AttachmentReference[]>();
function refsFor(doc: Text) {
  let refs = refsMemo.get(doc);
  if (!refs) {
    refs = attachmentReferences(doc.toString());
    refsMemo.set(doc, refs);
  }
  return refs;
}
class AttachmentWidget extends WidgetType {
  private root: Root | undefined;
  constructor(
    private ref: AttachmentReference,
    private store: KnowledgeStore,
    private open: (id: string) => void,
    private menu: (ref: AttachmentReference, x: number, y: number) => void,
  ) {
    super();
  }
  eq(other: AttachmentWidget) {
    return (
      this.ref.id === other.ref.id &&
      this.ref.image === other.ref.image &&
      this.ref.label === other.ref.label &&
      this.ref.from === other.ref.from &&
      this.ref.to === other.ref.to &&
      this.store === other.store
    );
  }
  toDOM() {
    const node = document.createElement("span");
    this.root = createRoot(node);
    this.root.render(
      <AttachmentInline
        asset={this.store.getSnapshot().attachments?.[this.ref.id]}
        storage={this.store.attachments}
        label={this.ref.label}
        image={this.ref.image}
        onOpen={() => this.open(this.ref.id)}
        onMenu={(x, y) => this.menu(this.ref, x, y)}
      />,
    );
    return node;
  }
  destroy() {
    const root = this.root;
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}
export function attachmentEditing({
  store,
  open,
  menu,
  status,
  live,
}: {
  store: KnowledgeStore;
  open: (id: string) => void;
  menu: (ref: AttachmentReference, x: number, y: number) => void;
  status: (message: string, busy: boolean, error?: boolean) => void;
  live: () => boolean;
}) {
  const controller = new AbortController();
  let active: Promise<void> = Promise.resolve();
  let pending = 0;
  function bookmark(view: EditorView) {
    const selection = view.state.selection.main;
    const marker = { id: crypto.randomUUID(), from: selection.from, to: selection.to };
    view.dispatch({ effects: addAnchor.of(marker) });
    return marker.id;
  }
  function insert(view: EditorView, files: File[], marker = bookmark(view)) {
    if (view.state.readOnly || !files.length) return;
    pending++;
    status(`正在保存 ${files.length} 个附件…`, true);
    const task = active
      .catch(() => undefined)
      .then(async () => {
        try {
          const markdown: string[] = [];
          for (const file of files)
            markdown.push(
              attachmentMarkdown(await store.importAttachment(file, controller.signal), file.name),
            );
          controller.signal.throwIfAborted();
          const range = view.state.field(anchors).find((item) => item.id === marker);
          if (!range || view.state.readOnly) throw new Error("插入位置已失效，附件原文件已保留");
          const inline = markdown.join("\n\n");
          const from = range.from,
            to = Math.max(from, range.to);
          const before = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n\n" : "";
          const after =
            to < view.state.doc.length && view.state.sliceDoc(to, to + 1) !== "\n" ? "\n\n" : "\n";
          const atInsertion =
            view.state.selection.main.from === from && view.state.selection.main.to === to;
          view.dispatch({
            changes: { from, to, insert: before + inline + after },
            ...(atInsertion
              ? {
                  selection: { anchor: from + before.length + inline.length + after.length },
                  scrollIntoView: true,
                }
              : {}),
            effects: removeAnchor.of(marker),
            userEvent: "input.paste",
          });
          view.focus();
          if (pending === 1) status("", false);
        } catch (reason) {
          if (!controller.signal.aborted)
            status(reason instanceof Error ? reason.message : String(reason), false, true);
          throw reason;
        } finally {
          pending--;
          if (!controller.signal.aborted) {
            view.dispatch({ effects: removeAnchor.of(marker) });
          }
        }
      });
    active = task.catch(() => undefined);
    void task.catch(() => undefined);
  }
  const refresh = StateEffect.define<null>();
  const previews = StateField.define<DecorationSet>({
    create(state) {
      return decorate(state);
    },
    update(value, tr) {
      return tr.docChanged || tr.selection || tr.effects.some((effect) => effect.is(refresh))
        ? decorate(tr.state)
        : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  function decorate(state: import("@codemirror/state").EditorState) {
    if (!live()) return Decoration.none;
    const ranges = state.selection.ranges.map((range) => ({
      from: state.doc.lineAt(range.from).from,
      to: state.doc.lineAt(range.to).to,
    }));
    let end = -1;
    return Decoration.set(
      refsFor(state.doc)
        .filter((ref) => {
          if (ref.from < end || ranges.some((range) => ref.to > range.from && ref.from <= range.to))
            return false;
          const line = state.doc.lineAt(ref.from);
          if (!ref.image && (line.from !== ref.from || line.to !== ref.to)) return false;
          end = ref.to;
          return true;
        })
        .map((ref) => {
          const imageLine = state.doc.lineAt(ref.from);
          const block = imageLine.from === ref.from && imageLine.to === ref.to;
          return Decoration.replace({
            widget: new AttachmentWidget(ref, store, open, menu),
            block,
          }).range(ref.from, ref.to);
        }),
      true,
    );
  }
  return {
    extension: [
      anchors,
      previews,
      EditorView.domEventHandlers({
        paste(event, view) {
          const files = [...(event.clipboardData?.files ?? [])];
          if (!files.length) return false;
          event.preventDefault();
          if (!view.state.readOnly) insert(view, files);
          return true;
        },
        drop(event, view) {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          event.preventDefault();
          if (!view.state.readOnly) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) view.dispatch({ selection: { anchor: pos } });
            insert(view, files);
          }
          return true;
        },
        dragover(event) {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      }),
    ],
    insert,
    refresh(view: EditorView) {
      view.dispatch({ effects: refresh.of(null) });
    },
    pick(view: EditorView, image = false) {
      if (view.state.readOnly) return;
      const marker = bookmark(view),
        input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      if (image) input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp";
      const clear = () => {
        input.remove();
        if (!controller.signal.aborted) view.dispatch({ effects: removeAnchor.of(marker) });
      };
      input.addEventListener(
        "change",
        () => {
          const files = [...(input.files ?? [])];
          input.remove();
          if (files.length) insert(view, files, marker);
          else clear();
        },
        { once: true },
      );
      input.addEventListener("cancel", clear, { once: true });
      controller.signal.addEventListener("abort", () => input.remove(), { once: true });
      document.body.append(input);
      input.click();
    },
    flush: () => active,
    get pending() {
      return pending > 0;
    },
    destroy: () => controller.abort(),
  };
}

import {
  renameCollection,
  deleteCollection,
  moveExcerpt,
  readDraft,
  draftFailed,
  writeDraft,
  clearDraft,
  pruneDrafts,
  browserDraftStorage,
} from "../researchManagement";
import type { SearchIndex } from "@bcr/core";
import { useEffect, useRef, useState } from "react";
import { ResearchBackupPanel } from "./ResearchBackupPanel";
import type {
  ResearchCollection,
  ResearchExcerpt,
  ResearchLibrary,
  ResearchStore,
} from "../research";
import { exportResearch, assessExcerpt, type ExcerptStatus } from "../research";

const button =
  "rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
export function ResearchPanel(props: {
  readonly library: ResearchLibrary;
  readonly search: SearchIndex | undefined;
  readonly store: ResearchStore;
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  readonly busy: boolean;
  readonly run: (action: () => Promise<void>) => void;
  readonly onOpen: (excerpt: ResearchExcerpt) => void;
}) {
  const [cleanupError, setCleanupError] = useState("");
  const cleanup = () => {
    try {
      pruneDrafts(props.store.getSnapshot(), browserDraftStorage);
      setCleanupError("");
    } catch (error) {
      setCleanupError(`草稿清理未完成：${String(error)}`);
    }
  };
  useEffect(() => {
    if (props.busy) return;
    try {
      pruneDrafts(props.library, browserDraftStorage);
      setCleanupError("");
    } catch (error) {
      setCleanupError(`草稿清理未完成：${String(error)}`);
    }
  }, [props.library, props.busy]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exportError, setExportError] = useState("");
  const collection = props.library.collections.find((item) => item.id === props.selected);
  const updateCollection = (change: (current: ResearchCollection) => ResearchCollection) =>
    props.store.update((current) => ({
      ...current,
      collections: current.collections.map((item) =>
        item.id === props.selected ? change(item) : item,
      ),
    }));
  const download = () => {
    if (!collection) return;
    try {
      const content = exportResearch(collection, window.location.origin);
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${collection.name.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError("");
    } catch (reason) {
      setExportError(String(reason));
    }
  };
  const matches =
    collection?.excerpts.filter((item) =>
      `${item.title} ${item.source} ${item.text} ${item.note}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(query.normalize("NFKC").toLocaleLowerCase().trim()),
    ) ?? [];
  return (
    <div className="px-4 pb-4">
      <form
        className="flex gap-2 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          const title = name.trim();
          if (!title) return;
          const id = crypto.randomUUID();
          props.run(async () => {
            await props.store.update((current) => ({
              ...current,
              collections: [...current.collections, { id, name: title, excerpts: [] }],
            }));
            props.onSelect(id);
            setName("");
          });
        }}
      >
        <input
          aria-label="新集合名称"
          placeholder="例如：分布式系统读书笔记"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-[12px] text-text"
        />
        <button className={button} disabled={props.busy || !name.trim()}>
          创建集合
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
        <label className="text-[11px] text-faint" htmlFor="research-collection">
          当前集合
        </label>
        <select
          id="research-collection"
          value={collection?.id ?? ""}
          onChange={(event) => {
            props.onSelect(event.target.value);
            setEditing(false);
            setDeleting(false);
          }}
          className="min-w-0 flex-1 rounded bg-surface p-2 text-[12px] text-text"
        >
          {!collection && <option value="">请选择集合</option>}
          {props.library.collections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.excerpts.length}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={button}
          onClick={download}
          disabled={!collection?.excerpts.length}
        >
          导出 Markdown
        </button>
      </div>
      {collection && (
        <div className="flex flex-wrap items-center gap-2 py-2">
          <button
            type="button"
            className={button}
            disabled={props.busy}
            onClick={() => {
              setRename(collection.name);
              setEditing(true);
              setDeleting(false);
            }}
          >
            重命名集合
          </button>
          <button
            type="button"
            className={button}
            disabled={props.busy}
            onClick={() => {
              setDeleting(true);
              setEditing(false);
            }}
          >
            删除集合
          </button>
          {editing && (
            <form
              className="flex min-w-0 flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                props.run(async () => {
                  await props.store.update((current) =>
                    renameCollection(current, collection.id, rename),
                  );
                  setEditing(false);
                });
              }}
            >
              <input
                aria-label="集合新名称"
                className="min-w-0 rounded bg-surface p-2 text-text"
                maxLength={120}
                value={rename}
                onChange={(event) => setRename(event.target.value)}
              />
              <button className={button} disabled={props.busy || !rename.trim()}>
                保存名称
              </button>
              <button type="button" className={button} onClick={() => setEditing(false)}>
                取消
              </button>
            </form>
          )}
          {deleting && (
            <div role="alert" className="w-full space-y-2 text-[12px] text-muted">
              <p>
                删除「{collection.name}」及其中 {collection.excerpts.length}{" "}
                条摘录和笔记？源文件仍会保留。
              </p>
              <button
                type="button"
                className={button}
                disabled={props.busy}
                onClick={() =>
                  props.run(async () => {
                    await props.store.update((current) => deleteCollection(current, collection.id));
                    setDeleting(false);
                    props.onSelect(props.store.getSnapshot().collections[0]?.id ?? "");
                  })
                }
              >
                确认删除集合
              </button>
              <button type="button" className={button} onClick={() => setDeleting(false)}>
                取消
              </button>
            </div>
          )}
        </div>
      )}
      <ResearchBackupPanel
        library={props.library}
        store={props.store}
        busy={props.busy}
        run={props.run}
      />
      {cleanupError && (
        <p role="alert" className="py-2 text-[11px] text-danger">
          {cleanupError}
          <button type="button" className={button} disabled={props.busy} onClick={cleanup}>
            重试清理草稿
          </button>
        </p>
      )}
      {exportError && (
        <p role="alert" className="py-2 text-danger">
          {exportError}
        </p>
      )}
      <p className="py-3 text-[11px] leading-5 text-faint">
        在「工作区搜索」中选择正文结果，保存到当前集合。摘录保留保存时的正文与来源；个人笔记草稿保留在当前浏览器；点击保存后写入资料库。Markdown
        仅导出已保存的笔记。
      </p>
      {collection && (
        <input
          aria-label="搜索集合摘录"
          placeholder="在标题、正文和笔记中查找…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-3 w-full rounded border border-border bg-surface px-3 py-2 text-[12px] text-text"
        />
      )}
      <div className="max-h-[40vh] space-y-3 overflow-auto" aria-label="集合摘录">
        {matches.map((item) => (
          <ExcerptCard
            key={item.id}
            item={item}
            collections={props.library.collections.filter((entry) => entry.id !== props.selected)}
            onMove={(target) =>
              props.run(() =>
                props.store.update((current) =>
                  moveExcerpt(current, props.selected, target, item.id),
                ),
              )
            }
            status={assessExcerpt(item, props.search)}
            busy={props.busy}
            onOpen={() => props.onOpen({ ...item, route: assessExcerpt(item, props.search).route })}
            onSave={(note, done) =>
              props.run(async () => {
                await updateCollection((current) => ({
                  ...current,
                  excerpts: current.excerpts.map((excerpt) =>
                    excerpt.id === item.id
                      ? (({ draft: _draft, ...saved }) => ({ ...saved, note }))(excerpt)
                      : excerpt,
                  ),
                }));
                try {
                  clearDraft(item, note, browserDraftStorage);
                } catch {
                  /* The note is already durable. */
                }
                done();
              })
            }
            onRemove={() =>
              props.run(() =>
                updateCollection((current) => ({
                  ...current,
                  excerpts: current.excerpts.filter((excerpt) => excerpt.id !== item.id),
                })),
              )
            }
          />
        ))}
        {matches.length === 0 && (
          <p className="py-8 text-center text-[12px] text-muted">
            {collection ? "暂无匹配摘录" : "创建一个集合，开始整理资料"}
          </p>
        )}
      </div>
    </div>
  );
}
function ExcerptCard(props: {
  readonly item: ResearchExcerpt;
  readonly collections: ReadonlyArray<ResearchCollection>;
  readonly onMove: (target: string) => void;
  readonly status: ExcerptStatus;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly onSave: (note: string, done: () => void) => void;
}) {
  const [initial] = useState(() => {
    try {
      return {
        note: readDraft(props.item, browserDraftStorage),
        error: draftFailed(props.item)
          ? "草稿暂未写入浏览器，刷新可能丢失。请重试或保存笔记。"
          : "",
      };
    } catch {
      return { note: props.item.note, error: "无法读取浏览器草稿，请检查浏览器存储后重试。" };
    }
  });
  const [note, setNote] = useState(initial.note);
  const [draftError, setDraftError] = useState(initial.error);
  const currentNote = useRef(note);
  const [readError, setReadError] = useState(initial.error.startsWith("无法读取"));
  const [target, setTarget] = useState("");
  const retainDraft = (value: string) => {
    currentNote.current = value;
    setNote(value);
    setReadError(false);
    try {
      writeDraft(props.item, value, browserDraftStorage);
      setDraftError("");
    } catch {
      setDraftError("草稿暂未写入浏览器，刷新可能丢失。请重试或保存笔记。");
    }
  };
  return (
    <article className="rounded border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-text">{props.item.title}</h3>
          <p className="mt-1 text-[10px] text-faint">{props.item.source}</p>
        </div>
        <button
          type="button"
          className={button}
          disabled={["missing", "changed", "ambiguous"].includes(props.status.state)}
          onClick={props.onOpen}
        >
          回到原文
        </button>
      </div>
      <p
        data-citation-status={props.status.state}
        className="mt-2 text-[11px] text-muted"
        role="status"
      >
        {props.status.label}
      </p>
      {props.item.citation && (
        <p className="mt-1 font-mono text-[10px] text-faint">
          来源版本 {props.item.citation.source.version.slice(0, 12)}
        </p>
      )}
      <p className="mt-3 text-[10px] text-faint">来源正文快照</p>
      <blockquote className="my-3 max-h-36 overflow-auto whitespace-pre-wrap border-l-2 border-accent/50 pl-3 text-[12px] leading-6 text-muted">
        {props.item.text}
      </blockquote>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave(note, () => {
            if (currentNote.current === note) {
              setDraftError("");
              setReadError(false);
            }
          });
        }}
      >
        <textarea
          aria-label={`笔记：${props.item.title}`}
          value={note}
          disabled={readError}
          onChange={(event) => retainDraft(event.target.value)}
          rows={2}
          maxLength={12000}
          placeholder="个人笔记：写下你的理解…"
          className="w-full resize-y rounded border border-border bg-raised p-2 text-[12px] text-text"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className={button}
            disabled={
              props.busy ||
              readError ||
              (note === props.item.note && props.item.draft === undefined)
            }
          >
            保存笔记
          </button>
          <span className="flex-1 text-[10px] text-faint">
            {note === props.item.note ? "已保存" : "笔记尚未保存"}
          </span>
          <button type="button" className={button} disabled={props.busy} onClick={props.onRemove}>
            移除摘录
          </button>
        </div>
      </form>
      {draftError && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {draftError}
          <button
            type="button"
            className={button}
            onClick={() => {
              if (!readError) {
                retainDraft(note);
                return;
              }
              try {
                const recovered = readDraft(props.item, browserDraftStorage);
                currentNote.current = recovered;
                setNote(recovered);
                setReadError(false);
                setDraftError(
                  draftFailed(props.item) ? "草稿暂未写入浏览器，请重试保留草稿。" : "",
                );
              } catch {
                setDraftError("无法读取浏览器草稿，请检查浏览器存储后重试。");
              }
            }}
          >
            {readError ? "重试读取草稿" : "重试保留草稿"}
          </button>
        </p>
      )}
      {props.collections.length > 0 && (
        <div className="mt-3 flex gap-2">
          <select
            aria-label={`移动目标：${props.item.title}`}
            className="min-w-0 flex-1 rounded bg-raised p-2 text-[11px] text-text"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">选择目标集合</option>
            {props.collections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button}
            disabled={props.busy || !target || !!draftError}
            onClick={() => props.onMove(target)}
          >
            移动摘录
          </button>
        </div>
      )}
    </article>
  );
}

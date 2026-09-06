import type { SearchIndex } from "@bcr/core";
import { useState } from "react";
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
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
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
          onChange={(event) => props.onSelect(event.target.value)}
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
      {exportError && (
        <p role="alert" className="py-2 text-danger">
          {exportError}
        </p>
      )}
      <p className="py-3 text-[11px] leading-5 text-faint">
        在「工作区搜索」中选择正文结果，保存到当前集合。摘录保留保存时的正文与来源；修改笔记后请点击保存。
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
            status={assessExcerpt(item, props.search)}
            busy={props.busy}
            onOpen={() => props.onOpen({ ...item, route: assessExcerpt(item, props.search).route })}
            onSave={(note) =>
              props.run(() =>
                updateCollection((current) => ({
                  ...current,
                  excerpts: current.excerpts.map((excerpt) =>
                    excerpt.id === item.id ? { ...excerpt, note } : excerpt,
                  ),
                })),
              )
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
  readonly status: ExcerptStatus;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(props.item.note);
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
      <blockquote className="my-3 max-h-36 overflow-auto whitespace-pre-wrap border-l-2 border-accent/50 pl-3 text-[12px] leading-6 text-muted">
        {props.item.text}
      </blockquote>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave(note);
        }}
      >
        <textarea
          aria-label={`笔记：${props.item.title}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={12000}
          placeholder="写下你的理解…"
          className="w-full resize-y rounded border border-border bg-raised p-2 text-[12px] text-text"
        />
        <div className="mt-2 flex items-center gap-2">
          <button className={button} disabled={props.busy || note === props.item.note}>
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
    </article>
  );
}

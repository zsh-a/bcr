import { useState } from "react";
import type { SearchDocument, SearchIndex, TextRange } from "@bcr/core";
import {
  boundReaderExcerpt,
  citationRoute,
  type ResearchExcerpt,
  type ResearchStore,
} from "../research";
import { linkPreview, relinkExcerpt } from "../researchReview";
const button =
  "rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
export function ResearchReview(props: {
  readonly item: ResearchExcerpt;
  readonly collection: string;
  readonly search: SearchIndex | undefined;
  readonly store: ResearchStore;
  readonly busy: boolean;
  readonly run: (action: () => Promise<void>) => void;
}) {
  const [open, setOpen] = useState(false),
    [all, setAll] = useState(false),
    [query, setQuery] = useState("");
  const [document, setDocument] = useState<SearchDocument>();
  const [range, setRange] = useState<TextRange>({ start: 0, end: 0 });
  const [done, setDone] = useState("");
  const scope = boundReaderExcerpt({ ...props.item, ...props.item.links?.at(-1) }).citation?.source
    .scope;
  const candidates = open
    ? (props.search?.documents() ?? [])
        .filter(
          (item) =>
            item.citation &&
            item.body &&
            citationRoute(item.route) &&
            props.search?.isSourceLive(item.source) &&
            (all || item.citation.scope === scope) &&
            `${item.title} ${item.body}`
              .normalize("NFKC")
              .toLowerCase()
              .includes(query.normalize("NFKC").toLowerCase().trim()),
        )
        .slice(0, 30)
    : [];
  let preview;
  try {
    if (document) preview = linkPreview(document, range);
  } catch {
    /* A selection is required. */
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        className={button}
        onClick={() => {
          setOpen(!open);
          setDocument(undefined);
          setRange({ start: 0, end: 0 });
          setDone("");
        }}
      >
        核对与重新关联
      </button>
      {done && (
        <p role="status" className="mt-2 text-[11px] text-accent">
          {done}
        </p>
      )}
      {open && (
        <div className="mt-3 space-y-3 text-[11px] text-muted" aria-label="引用核对">
          <p>原始快照始终保留。请选择并核对当前正文，再确认新的来源关联。</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => {
                setAll(event.target.checked);
                setDocument(undefined);
              }}
            />
            查找其它已加载来源
          </label>
          <input
            aria-label="筛选当前来源"
            placeholder="输入当前正文或标题中的关键词…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded bg-raised p-2 text-text"
          />
          <p>
            仅列出已加载且可精确引用的来源，最多显示 30 个片段。未加载的资料请先在来源工作台打开。
          </p>
          <select
            aria-label="选择当前来源片段"
            className="w-full min-w-0 rounded bg-raised p-2 text-text"
            value={document?.id ?? ""}
            onChange={(event) => {
              setDocument(candidates.find((item) => item.id === event.target.value));
              setRange({ start: 0, end: 0 });
            }}
          >
            <option value="">请选择来源片段</option>
            {candidates.map((item, i) => (
              <option key={item.id} value={item.id}>
                {i + 1}. {item.title} · {item.subtitle}
              </option>
            ))}
          </select>
          {document && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-faint">最初保存的正文</p>
                  <blockquote className="max-h-48 overflow-auto whitespace-pre-wrap leading-5">
                    {props.item.text}
                  </blockquote>
                </div>
                <div>
                  <p className="mb-1 text-faint">当前来源正文（可选择文字）</p>
                  <textarea
                    aria-label="当前来源正文"
                    readOnly
                    value={document.body}
                    rows={7}
                    className="w-full rounded bg-raised p-2 leading-5 text-text"
                    onSelect={(event) =>
                      setRange({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  起点（从 0 开始）
                  <input
                    aria-label="新引用起点"
                    type="number"
                    min={0}
                    max={document.body!.length}
                    value={range.start}
                    onChange={(event) => setRange({ ...range, start: Number(event.target.value) })}
                    className="ml-1 w-20 rounded bg-raised p-1 text-text"
                  />
                </label>
                <label>
                  终点
                  <input
                    aria-label="新引用终点"
                    type="number"
                    min={0}
                    max={document.body!.length}
                    value={range.end}
                    onChange={(event) => setRange({ ...range, end: Number(event.target.value) })}
                    className="ml-1 w-20 rounded bg-raised p-1 text-text"
                  />
                </label>
              </div>
              {preview ? (
                <div className="rounded border border-accent/30 p-2">
                  <p>将关联到：{preview.source}</p>
                  <p className="mt-1 whitespace-pre-wrap">{preview.text}</p>
                  <p className="mt-1 font-mono text-faint">
                    版本 {preview.citation.source.version.slice(0, 12)}
                  </p>
                </div>
              ) : (
                <p>请选择 1–512 个字符。字符位置按 UTF-16 计数，也可直接在正文中选中文字。</p>
              )}
              <button
                type="button"
                className={button}
                disabled={props.busy || !preview || !props.search}
                onClick={() =>
                  props.run(async () => {
                    await props.store.update((current) =>
                      relinkExcerpt(
                        current,
                        props.collection,
                        props.item.id,
                        document,
                        range,
                        props.item.links?.length ?? 0,
                        props.search!,
                      ),
                    );
                    setOpen(false);
                    setDone("已追加关联记录，原始快照与笔记均已保留");
                  })
                }
              >
                确认重新关联
              </button>
            </>
          )}
        </div>
      )}
      {!!props.item.links?.length && (
        <details className="mt-3 text-[11px] text-muted">
          <summary className="cursor-pointer">关联修订记录 · {props.item.links.length}</summary>
          <ol className="mt-2 max-h-48 space-y-3 overflow-auto">
            {props.item.links.map((link, i) => (
              <li key={i} className="border-l border-border pl-2">
                <p>
                  {new Date(link.linkedAt).toLocaleString()} ·{" "}
                  {i === props.item.links!.length - 1 ? "当前关联" : "历史关联"}
                </p>
                <p>{link.source}</p>
                <p className="whitespace-pre-wrap">{link.text}</p>
                <p className="font-mono text-faint">
                  版本 {link.citation.source.version.slice(0, 12)}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

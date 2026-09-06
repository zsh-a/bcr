import {
  isResearchResult,
  publishResearch,
  researchSource,
  researchTarget,
} from "../researchSearch";
import { Dialog } from "@base-ui/react/dialog";
import type { SearchDocument, SearchDocumentKind, SearchResult } from "@bcr/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AudioWaveform,
  BookOpen,
  Database,
  FileSearch,
  FileText,
  Globe2,
  LayoutGrid,
  Search,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";
import {
  ResearchStore,
  citationRoute,
  excerptFromResult,
  resultDocument,
  sameExcerpt,
} from "../research";
import { ResearchPanel } from "./ResearchPanel";
import { useServices } from "../services";

type SearchFilterId =
  | "research"
  | "all"
  | "file"
  | "task"
  | "reader"
  | "document"
  | "manga"
  | "market"
  | "media"
  | "dataset";

interface SearchFilter {
  readonly id: SearchFilterId;
  readonly label: string;
  readonly kinds?: ReadonlyArray<SearchDocumentKind> | undefined;
}

const FILTERS: ReadonlyArray<SearchFilter> = [
  { id: "all", label: "全部" },
  { id: "research", label: "资料集合", kinds: ["research-note", "research-excerpt"] },
  { id: "file", label: "文件", kinds: ["file"] },
  { id: "task", label: "任务", kinds: ["task"] },
  { id: "reader", label: "阅读器", kinds: ["reader-book", "reader-section"] },
  { id: "document", label: "文档", kinds: ["document"] },
  { id: "manga", label: "漫画", kinds: ["manga-page", "manga-region"] },
  { id: "market", label: "市场", kinds: ["market-instrument"] },
  { id: "media", label: "媒体", kinds: ["media"] },
  { id: "dataset", label: "数据", kinds: ["dataset"] },
];

function iconFor(kind: SearchDocumentKind) {
  if (kind === "research-note" || kind === "research-excerpt")
    return <BookOpen className="size-4" />;
  if (kind === "app") return <LayoutGrid className="size-4" />;
  if (kind === "file" || kind === "document") return <FileText className="size-4" />;
  if (kind === "task") return <TerminalSquare className="size-4" />;
  if (kind === "reader-book" || kind === "reader-section") {
    return <BookOpen className="size-4" />;
  }
  if (kind === "manga-page" || kind === "manga-region") return <WandSparkles className="size-4" />;
  if (kind === "market-instrument") return <Globe2 className="size-4" />;
  if (kind === "media") return <AudioWaveform className="size-4" />;
  if (kind === "dataset") return <Database className="size-4" />;
  return <Activity className="size-4" />;
}

function kindLabel(kind: SearchDocumentKind): string {
  if (kind === "research-note") return "笔记";
  if (kind === "research-excerpt") return "摘录";
  if (kind === "app") return "APP";
  if (kind === "file") return "FILE";
  if (kind === "task") return "TASK";
  if (kind === "reader-book" || kind === "reader-section") return "READER";
  if (kind === "document") return "DOC";
  if (kind === "manga-page" || kind === "manga-region") return "MANGA";
  if (kind === "market-instrument") return "MARKET";
  if (kind === "media") return "MEDIA";
  if (kind === "dataset") return "DATA";
  return "UNKNOWN";
}

function recentResult(document: SearchDocument): SearchResult {
  return {
    document,
    score: 0,
    snippet: document.body ?? document.subtitle ?? document.title,
    matchedTerms: [],
  };
}

/** Global search surface shared by every mounted domain app. */
export function SearchPanel(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onNavigate: (document: SearchDocument) => void;
}) {
  const services = useServices();
  const search = services.search;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilterId>("all");
  const [active, setActive] = useState(0);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<"search" | "research">("search");
  const research = useMemo(() => new ResearchStore(services.metadata), [services.metadata]);
  const library = useSyncExternalStore(research.subscribe, research.getSnapshot);
  const [scope, setScope] = useState("");
  const [focus, setFocus] = useState<{
    excerpt: string;
    field: "note" | "text";
    start?: number;
    end?: number;
    exact?: string;
  }>();
  const [collectionId, setCollectionId] = useState("");
  const [researchReady, setResearchReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setResearchReady(false);
    void research.ready.then(
      () => {
        if (live) setResearchReady(true);
      },
      (reason) => {
        if (live) setMessage(String(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [research]);
  useEffect(() => {
    if (!search || !researchReady) return;
    let live = true;
    void search.ready.then(() => {
      if (live) publishResearch(search, library);
    });
    return () => {
      live = false;
    };
  }, [search, researchReady, library]);
  useEffect(() => {
    if (scope && !library.collections.some((item) => item.id === scope)) setScope("");
  }, [library, scope]);
  const selectedCollection =
    library.collections.find((item) => item.id === collectionId) ?? library.collections[0];
  const run = (action: () => Promise<void>) => {
    if (busy || !researchReady) return;
    setBusy(true);
    setMessage("正在保存…");
    void action()
      .then(
        () => setMessage("已保存到本地"),
        (reason) => setMessage(`保存失败：${String(reason)}`),
      )
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (search === undefined) return;
    return search.subscribe(() => setRevision((value) => value + 1));
  }, [search]);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setView("search");
    setFilter("all");
    setScope("");
    setFocus(undefined);
    setActive(0);
  }, [props.open]);

  const documents = useMemo(() => search?.documents() ?? [], [search, revision]);

  const selectedFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0]!;
  const results = useMemo(() => {
    if (search === undefined) return [];
    const options = {
      ...(selectedFilter.kinds ? { kinds: selectedFilter.kinds } : {}),
      ...(filter === "research" && scope ? { sources: [researchSource(scope)] } : {}),
    };
    const trimmed = query.trim();
    return trimmed.length === 0
      ? documents
          .filter((document) =>
            selectedFilter.kinds === undefined
              ? true
              : selectedFilter.kinds.includes(document.kind),
          )
          .filter(
            (document) =>
              (!isResearchResult(document) || researchReady) &&
              (!options.sources || options.sources.includes(document.source)),
          )
          .slice(0, 10)
          .map(recentResult)
      : search
          .search(trimmed, { ...options, limit: 60 })
          .filter((result) => !isResearchResult(result.document) || researchReady);
  }, [query, search, selectedFilter, documents, filter, scope, researchReady]);

  useEffect(() => {
    setActive((value) => Math.min(Math.max(0, results.length - 1), value));
  }, [results.length]);

  const openResult = (result: SearchResult | undefined): void => {
    if (result === undefined) return;
    if (isResearchResult(result.document)) {
      const target = researchTarget(result.document);
      if (
        !target ||
        !library.collections
          .find((item) => item.id === target.collection)
          ?.excerpts.some((item) => item.id === target.excerpt)
      ) {
        setMessage("该摘录已不存在，请重新搜索");
        return;
      }
      setCollectionId(target.collection);
      setFocus({
        excerpt: target.excerpt,
        field: target.field,
        ...(result.match
          ? {
              start: target.offset + result.match.start,
              end: target.offset + result.match.end,
              exact: result.document.body?.slice(result.match.start, result.match.end) ?? "",
            }
          : {}),
      });
      setView("research");
      return;
    }
    props.onNavigate(resultDocument(result));
    props.onOpenChange(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onOpenChange(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(Math.max(0, results.length - 1), value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      openResult(results[active]);
    }
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[3px]" />
        <Dialog.Popup className="fixed top-[12%] left-1/2 z-50 w-[min(46rem,calc(100vw-1.5rem))] -translate-x-1/2 max-h-[80dvh] overflow-y-auto rounded-[var(--radius-md)] border border-border-strong bg-raised shadow-2xl shadow-black/60 outline-none studio-enter">
          <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
          <div className="flex gap-2 border-b border-border px-4 py-2">
            <button
              type="button"
              aria-pressed={view === "search"}
              onClick={() => setView("search")}
              className="rounded px-3 py-2 text-[12px] text-muted aria-pressed:bg-overlay aria-pressed:text-accent"
            >
              工作区搜索
            </button>
            <button
              type="button"
              aria-pressed={view === "research"}
              onClick={() => {
                setFocus(undefined);
                setView("research");
              }}
              className="rounded px-3 py-2 text-[12px] text-muted aria-pressed:bg-overlay aria-pressed:text-accent"
            >
              资料集合 · {library.collections.length}
            </button>
          </div>
          {message && (
            <p role="status" className="px-4 py-2 text-[11px] text-muted">
              {message}
            </p>
          )}
          {view === "research" ? (
            <ResearchPanel
              library={library}
              search={search}
              store={research}
              selected={selectedCollection?.id ?? ""}
              focus={focus}
              onSelect={(id) => {
                setFocus(undefined);
                setCollectionId(id);
              }}
              busy={busy || !researchReady}
              run={run}
              onOpen={(item) => {
                props.onNavigate({
                  id: item.documentId,
                  title: item.title,
                  source: "research",
                  kind: "document",
                  route: item.route,
                  updatedAt: item.savedAt,
                });
                props.onOpenChange(false);
              }}
            />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Search className="size-4 shrink-0 text-accent" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="搜索工作区、文档、阅读内容或市场标的…"
                  aria-label="全局搜索"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-faint"
                />
                <kbd className="rounded-[var(--radius-xs)] border border-border px-1.5 py-1 font-mono text-[10px] text-faint">
                  esc
                </kbd>
              </div>
              <div
                className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2"
                role="tablist"
                aria-label="搜索范围"
              >
                {FILTERS.map((item) => {
                  const count =
                    search === undefined
                      ? 0
                      : documents.filter((document) =>
                          item.kinds === undefined ? true : item.kinds.includes(document.kind),
                        ).length;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={filter === item.id}
                      onClick={() => {
                        setFilter(item.id);
                        setActive(0);
                      }}
                      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-xs)] px-2.5 text-[11px] transition-colors ${
                        filter === item.id
                          ? "bg-accent-dim/55 text-accent"
                          : "text-faint hover:bg-overlay hover:text-text"
                      }`}
                    >
                      {item.label}
                      <span className="font-mono text-[9px] opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
              {filter === "research" && (
                <label className="flex items-center gap-2 px-4 py-2 text-[11px] text-muted">
                  集合范围
                  <select
                    aria-label="集合搜索范围"
                    className="min-w-0 flex-1 rounded bg-surface p-2 text-text"
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value);
                      setActive(0);
                    }}
                  >
                    <option value="">全部集合</option>
                    {library.collections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex items-center justify-between px-4 py-2 font-mono text-[10px] text-faint">
                <span aria-live="polite">
                  {query.trim().length === 0
                    ? "最近更新"
                    : `${results.length} 个结果 · ${selectedFilter.label}`}
                </span>
                <span className="hidden sm:inline">↑↓ 选择 · Enter 打开 · ⌘⇧F 呼出</span>
              </div>
              <div
                className="max-h-[min(28rem,55vh)] overflow-auto px-2 pb-2"
                role="listbox"
                aria-label="搜索结果"
              >
                {search === undefined ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                    <FileSearch className="size-6 text-faint" />
                    <p className="text-[13px] text-muted">当前运行时未启用搜索索引</p>
                  </div>
                ) : results.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                    <FileSearch className="size-6 text-faint" />
                    <p className="text-[13px] text-muted">没有找到匹配内容</p>
                    <p className="max-w-sm text-[11px] leading-5 text-faint">
                      试试文件名、章节标题、股票代码或字幕中的关键词。
                    </p>
                  </div>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={`${result.document.id}:${result.match?.start ?? "meta"}:${result.match?.end ?? ""}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      onClick={() => openResult(result)}
                      className={`group flex w-full items-start gap-3 rounded-[var(--radius-sm)] px-3 py-3 text-left transition-colors ${
                        index === active ? "bg-accent-dim/45" : "hover:bg-overlay"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border ${
                          index === active
                            ? "border-accent/35 bg-accent/10 text-accent"
                            : "border-border bg-surface text-faint"
                        }`}
                      >
                        {iconFor(result.document.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <strong className="min-w-0 truncate text-[13px] font-medium text-text">
                            {result.document.title}
                          </strong>
                          <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-faint">
                            {kindLabel(result.document.kind)}
                          </span>
                        </span>
                        {result.document.subtitle !== undefined && (
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">
                            {result.document.subtitle}
                          </span>
                        )}
                        {isResearchResult(result.document) && (
                          <span className="mt-1 block text-[10px] text-accent">
                            {result.match
                              ? result.document.kind === "research-note"
                                ? "命中已保存笔记"
                                : "命中摘录正文"
                              : "命中标题或集合信息"}{" "}
                            · 打开笔记
                          </span>
                        )}
                        {result.match && result.document.citation && (
                          <span className="mt-1 block text-[10px] text-muted">
                            命中：
                            <mark className="bg-accent-dim text-accent">
                              {result.document.body?.slice(result.match.start, result.match.end)}
                            </mark>{" "}
                            · 位置 {result.document.citation.offset + result.match.start + 1}
                          </span>
                        )}
                        <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-faint">
                          {result.snippet}
                        </span>
                      </span>
                      <span className="mt-2 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        →
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                <span className="text-[11px] text-faint">保存正文到</span>
                <select
                  aria-label="摘录目标集合"
                  value={selectedCollection?.id ?? ""}
                  onChange={(event) => setCollectionId(event.target.value)}
                  className="min-w-0 flex-1 rounded bg-surface p-2 text-[11px] text-text"
                >
                  {!selectedCollection && <option value="">请先创建资料集合</option>}
                  {library.collections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded border border-border px-3 py-2 text-[11px] text-accent disabled:opacity-40"
                  disabled={
                    busy ||
                    !researchReady ||
                    !selectedCollection ||
                    !results[active]?.document.body?.trim() ||
                    !citationRoute(results[active]?.document.route)
                  }
                  onClick={() => {
                    const result = results[active];
                    if (!result || !selectedCollection) return;
                    const excerpt = excerptFromResult(result, Date.now());
                    run(() =>
                      research.update((current) => ({
                        ...current,
                        collections: current.collections.map((item) =>
                          item.id !== selectedCollection.id ||
                          item.excerpts.some((saved) => sameExcerpt(saved, excerpt))
                            ? item
                            : { ...item, excerpts: [...item.excerpts, excerpt] },
                        ),
                      })),
                    );
                  }}
                >
                  保存当前结果
                </button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

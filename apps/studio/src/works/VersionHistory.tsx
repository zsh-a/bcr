import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@bcr/react";
import {
  ArrowLeftRight,
  BookmarkPlus,
  Check,
  File,
  History,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  textChange,
  type VersionPage,
  type VersionEntry,
  type VersionDiff,
  type WorkSummary,
  type RestoreRequest,
} from "@bcr/work-core";
import type { WorkService } from "./service";

export function VersionHistory({
  service,
  work,
  readOnly = false,
  close,
}: {
  service: WorkService;
  work: WorkSummary;
  readOnly?: boolean;
  close: () => void;
}) {
  const [page, setPage] = useState<VersionPage>(),
    [selected, setSelected] = useState<VersionEntry>(),
    [path, setPath] = useState("");
  const [diff, setDiff] = useState<VersionDiff>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [bookmarks, setBookmarks] = useState<Record<string, string[]>>({});
  const abort = useRef(new AbortController()),
    request = useRef<RestoreRequest | undefined>(undefined);
  const load = async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await service.versions(work.ref, cursor, abort.current.signal);
      if (abort.current.signal.aborted) return;
      setPage((old) =>
        cursor && old ? { ...result, items: [...old.items, ...result.items] } : result,
      );
      if (!cursor) {
        setSelected(result.items.find((v) => v.revision !== result.head) ?? result.items[0]);
        setPath("");
        setConfirm(false);
        request.current = undefined;
      }
    } catch (e) {
      if (!abort.current.signal.aborted) setError(String(e));
    } finally {
      if (!abort.current.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    abort.current = new AbortController();
    void load();
    void service
      .reviewRead(work.ref, abort.current.signal)
      .then((book) => {
        if (abort.current.signal.aborted) return;
        const marks: Record<string, string[]> = {};
        for (const s of book.submissions) (marks[s.sourceRevision] ??= []).push(`审阅：${s.title}`);
        for (const d of book.deliveries)
          for (const s of d.selections) (marks[s.sourceRevision] ??= []).push(`交付：${d.title}`);
        setBookmarks(marks);
      })
      .catch(() => undefined);
    return () => abort.current.abort();
  }, [service, work.ref.sourceId, work.ref.id]);
  useEffect(() => {
    setDiff(undefined);
    if (!selected || !page) return;
    const controller = new AbortController();
    void service
      .diff(work.ref, selected.revision, page.head, path || undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDiff(result);
        if (!path && result.changes[0]) setPath(result.changes[0].path);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [service, selected?.revision, page?.head, path]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (!abort.current.signal.aborted) setError(String(e));
    } finally {
      if (!abort.current.signal.aborted) setBusy(false);
    }
  };
  const restore = async (input: RestoreRequest) => {
    await service.restore(work.ref, input, abort.current.signal);
    close();
  };
  const detail = diff?.detail;
  const lines = detail && !detail.message ? textChange(detail.before, detail.after) : undefined;
  return (
    <Dialog
      open
      placement="drawer"
      title="版本历史"
      className="build-history"
      closeLabel="关闭版本历史"
      onClose={close}
      closable={!busy}
    >
      <p className="build-dialog-intro">查看已保存的源码，比较变化，再决定从哪里继续。</p>
      {readOnly && (
        <p className="build-notice">
          当前有未保存的修改。可以查看历史，保存或放弃修改后再创建检查点或恢复。
        </p>
      )}
      {error && (
        <p className="works-error" role="alert">
          {error}
        </p>
      )}
      {page?.pending && (
        <div className="build-notice">
          <strong>上次恢复尚未完成</strong>
          <p>恢复前的源码已保留。处理提示中的外部文件变化后，可继续同一次恢复。</p>
          <Button
            disabled={busy || readOnly}
            onClick={() => void run(() => restore(page.pending!))}
          >
            继续恢复
          </Button>
        </div>
      )}
      <form
        className="build-checkpoint"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!page || readOnly) return;
            await service.checkpoint(
              work.ref,
              {
                id: work.ref.id,
                revision: page.head,
                requestId: crypto.randomUUID(),
                message: message.trim(),
              },
              abort.current.signal,
            );
            setMessage("");
            await load();
          });
        }}
      >
        <BookmarkPlus size={16} />
        <input
          aria-label="检查点说明"
          placeholder="给当前版本留一句说明…"
          maxLength={160}
          value={message}
          disabled={busy || readOnly || !!page?.pending}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button
          type="submit"
          disabled={busy || readOnly || !page || !!page.pending || !message.trim()}
        >
          保存检查点
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="刷新版本历史"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </Button>
      </form>
      <div className="build-history-layout">
        <nav aria-label="源码版本" className="build-version-list">
          {!page?.items.length && (
            <div className="build-quiet">
              <History size={24} />
              <p>{loading ? "正在读取版本" : "还没有捕获的版本"}</p>
              <small>保存检查点，或生成一次预览。</small>
            </div>
          )}
          {page?.items.map((v) => (
            <button
              key={v.id}
              disabled={busy}
              className={selected?.id === v.id ? "is-active" : ""}
              onClick={() => {
                setSelected(v);
                setPath("");
                setConfirm(false);
                request.current = undefined;
              }}
            >
              <span className="build-version-meta">
                {new Date(v.createdAt).toLocaleString()}{" "}
                {v.revision === page.head && <Check size={12} />}
              </span>
              <strong>{v.message}</strong>
              <code>
                {v.revision.slice(0, 8)}
                {v.revision === page.head ? " · 当前内容" : ""}
              </code>
              {bookmarks[v.revision]?.slice(0, 3).map((mark, i) => (
                <small className="build-version-mark" key={`${mark}:${i}`}>
                  {mark}
                </small>
              ))}
            </button>
          ))}
          {page?.nextCursor && (
            <Button
              variant="ghost"
              disabled={loading || busy}
              onClick={() => void load(page.nextCursor!)}
            >
              更早的版本
            </Button>
          )}
        </nav>
        <section className="build-version-detail">
          <header>
            <div>
              <span className="build-eyebrow">SOURCE HISTORY</span>
              <h3>{selected?.message ?? "保存一个可以返回的起点"}</h3>
            </div>
            <span>
              <ArrowLeftRight size={14} />
              与当前版本比较
            </span>
          </header>
          {diff && (
            <p className="build-diff-summary">
              {diff.changes.length ? `${diff.changes.length} 个文件发生变化` : "文件内容一致"} ·{" "}
              {diff.from.slice(0, 8)} → {diff.to.slice(0, 8)}
            </p>
          )}
          <div className="build-change-files">
            {diff?.changes.map((f) => (
              <button
                className={path === f.path ? "is-active" : ""}
                key={f.path}
                onClick={() => setPath(f.path)}
              >
                <span className={`build-change-${f.status}`}>
                  {{ added: "+", removed: "−", modified: "~" }[f.status]}
                </span>
                <File size={12} />
                {f.path}
                <small>
                  {f.before?.size ?? 0} → {f.after?.size ?? 0} B
                </small>
              </button>
            ))}
          </div>
          {detail?.message ? (
            <div className="build-quiet">
              <File size={24} />
              <p>{detail.path}</p>
              <small>{detail.message}</small>
            </div>
          ) : (
            lines && (
              <div className="build-text-diff" aria-label="源码差异">
                {(["before", "after"] as const).map((side) => {
                  const values = lines[side],
                    start = Math.max(0, lines.prefix - 12),
                    end = Math.min(values.length, start + 400);
                  return (
                    <section key={side}>
                      <header>{side === "before" ? "选定版本" : "当前版本"}</header>
                      <pre>
                        {values.slice(start, end).map((line, index) => {
                          const n = start + index;
                          return (
                            <span
                              className={
                                n >= lines.prefix && n < values.length - lines.suffix
                                  ? `is-${side}`
                                  : ""
                              }
                              key={n}
                            >
                              <i>{n + 1}</i>
                              {line || " "}
                              {"\n"}
                            </span>
                          );
                        })}
                      </pre>
                      {(start > 0 || end < values.length) && (
                        <small>
                          显示第 {start + 1}–{end} 行；完整内容可通过文件读取工具查看。
                        </small>
                      )}
                    </section>
                  );
                })}
              </div>
            )
          )}
          {confirm && page && selected && (
            <div className="build-restore-confirm" role="region" aria-label="确认恢复版本">
              <strong>以「{selected.message}」继续制作？</strong>
              <p>将恢复上述文件变化，并保留当前源码作为检查点。已提交的审阅稿和交付保持固定。</p>
              <div>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                  取消
                </Button>
                <Button
                  disabled={busy || readOnly}
                  onClick={() =>
                    void run(() => {
                      request.current ??= {
                        id: work.ref.id,
                        revision: page.head,
                        restoreRevision: selected.revision,
                        requestId: crypto.randomUUID(),
                      };
                      return restore(request.current);
                    })
                  }
                >
                  保留当前并恢复
                </Button>
              </div>
            </div>
          )}
          {!confirm && (
            <footer>
              <span>历史内容只读</span>
              <Button
                disabled={
                  busy ||
                  readOnly ||
                  !diff ||
                  !selected ||
                  selected.revision === page?.head ||
                  !!page?.pending
                }
                onClick={() => setConfirm(true)}
              >
                <RotateCcw size={14} />
                恢复为当前版本
              </Button>
            </footer>
          )}
        </section>
      </div>
    </Dialog>
  );
}

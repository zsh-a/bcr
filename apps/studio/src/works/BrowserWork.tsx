import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Dialog, Select, useUpdateParticipant } from "@bcr/react";
import { Code2, Download, Play, RotateCcw, Save, Square } from "lucide-react";
import { mimeFor, type Work } from "./model";
import type { WorkService } from "./service";
import type { WorkSummary } from "@bcr/work-core";
import { BuildShell } from "./BuildShell";

/** Browser file editor. Local execution and connection state live outside this view. */
export function BrowserWork({
  service,
  work,
  onBlocked,
  onReview,
  onSubmit,
}: {
  service: WorkService;
  work: Work;
  onBlocked: (blocked: boolean) => void;
  onReview: () => void;
  onSubmit: () => void;
}) {
  const store = service.browser,
    preview = service.preview;
  const state = useSyncExternalStore(preview.subscribe, preview.getSnapshot);
  const [path, setPath] = useState(""),
    [source, setSource] = useState(""),
    [original, setOriginal] = useState("");
  const [base, setBase] = useState<Work>(),
    [title, setTitle] = useState(""),
    [entry, setEntry] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editable, setEditable] = useState(false);
  const [view, setView] = useState<"preview" | "code" | "split">("split"),
    [inspector, setInspector] = useState(true),
    [exporting, setExporting] = useState(false);
  const running = useRef(false),
    dirtyRef = useRef(false),
    draft = useRef<ReturnType<typeof store.registerDraft> | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const dirty =
    source !== original || (!!base && (title !== base.title || entry !== (base.entry ?? "")));
  dirtyRef.current = dirty;
  useEffect(() => {
    onBlocked(dirty || busy);
    return () => onBlocked(false);
  }, [dirty, busy, onBlocked]);
  useEffect(() => {
    const refresh = () => {
      void store.refresh().catch((e) => setError(String(e)));
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [store]);
  useEffect(() => {
    if (!work) return;
    const registration = store.registerDraft(work.id, () => dirtyRef.current);
    draft.current = registration;
    return () => {
      registration.dispose();
      draft.current = null;
    };
  }, [store, work?.id]);
  useEffect(() => {
    if (dirtyRef.current) return;
    setBase(work);
    setTitle(work?.title ?? "");
    setEntry(work?.entry ?? "");
    if (work && !work.files.some((f) => f.path === path))
      setPath(work.entry ?? work.files[0]?.path ?? "");
  }, [work, path]);
  useEffect(() => {
    if (!base || !path || dirtyRef.current) return;
    let disposed = false;
    setEditable(false);
    const file = base.files.find((f) => f.path === path);
    if (!file) return;
    const text =
      file.artifact.size <= 1_000_000 &&
      /^(?:text\/|application\/(?:json|javascript))|^image\/svg\+xml/u.test(file.artifact.mime);
    void (
      text
        ? store.files.read(file.artifact).then((blob) => blob.text())
        : Promise.resolve("此文件保留在作品中，可通过 Agent 下载或替换。")
    ).then(
      (value) => {
        if (!disposed) {
          setSource(value);
          setOriginal(value);
          setEditable(text);
        }
      },
      (e) => {
        if (!disposed) setError(String(e));
      },
    );
    return () => {
      disposed = true;
    };
  }, [base, path, store]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || running.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  useUpdateParticipant({
    blocked: () =>
      dirtyRef.current
        ? "作品有未保存的编辑，请先保存或撤销。"
        : running.current
          ? "正在处理作品，请稍候。"
          : null,
    save: () => store.flush(),
  });
  const run = async (action: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const saved = (next: Work) => {
    dirtyRef.current = false;
    setBase(next);
    setTitle(next.title);
    setEntry(next.entry ?? "");
    setOriginal(source);
  };
  const save = () =>
    run(async () => {
      if (!base) return;
      saved(
        await service.commit(
          {
            id: base.id,
            revision: base.revision,
            requestId: crypto.randomUUID(),
            title,
            entry: entry || null,
            put:
              editable && source !== original
                ? [
                    {
                      path,
                      text: source,
                      mime: base.files.find((f) => f.path === path)?.artifact.mime,
                    },
                  ]
                : [],
          },
          undefined,
          draft.current?.token,
        ),
      );
    });
  const download = (format: "html" | "archive") =>
    run(async () => {
      if (!work) return;
      const blob =
        format === "html"
          ? new Blob([await (await import("./document")).workDocument(work, store.files)], {
              type: "text/html",
            })
          : await (await import("./archive")).exportWork(work, store.files);
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${work.title.replace(/[/\\]/gu, "-")}.${format === "html" ? "html" : "zip"}`;
      anchor.click();
      setExporting(false);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  const summary: WorkSummary = {
    ref: { sourceId: "browser", provider: "browser", id: work.id },
    title: work.title,
    revision: work.revision,
    targets: work.entry ? [{ id: "page", runtime: "html", entry: work.entry }] : [],
    capabilities: ["versions", "preview", "archive"],
  };
  const panel = (
    <>
      <div className="build-inspector-heading">
        <span>作品文件</span>
        <small>{work.files.length} 个文件</small>
      </div>
      <nav className="build-file-list" aria-label="作品文件">
        {work.files.map((f) => (
          <button
            key={f.path}
            className={path === f.path ? "is-active" : ""}
            disabled={dirty || busy}
            onClick={() => {
              setPath(f.path);
              if (view === "preview") setView("code");
            }}
          >
            <Code2 size={13} />
            <span>{f.path}</span>
            <small>{(f.artifact.size / 1024).toFixed(1)} KB</small>
          </button>
        ))}
      </nav>
      <Button variant="ghost" disabled={dirty || busy} onClick={() => upload.current?.click()}>
        导入文件
      </Button>
      <input
        ref={upload}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void run(async () => {
            const put = [];
            for (const file of files)
              put.push({
                path: file.name,
                artifact: await store.files.import(
                  file.slice(0, undefined, file.type || mimeFor(file.name)),
                  file.name,
                ),
              });
            await service.commit({
              id: work.id,
              revision: work.revision,
              requestId: crypto.randomUUID(),
              put,
            });
          });
        }}
      />
      <details className="build-source-list">
        <summary>作品设置</summary>
        <label className="build-parameter">
          <span>作品名称</span>
          <input
            aria-label="作品名称"
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="build-parameter">
          <span>页面入口</span>
          <Select
            aria-label="页面入口"
            value={entry}
            disabled={busy}
            onChange={(e) => setEntry(e.target.value)}
          >
            <option value="">仅保存文件</option>
            {work.files
              .filter((f) => /\.html?$/iu.test(f.path))
              .map((f) => (
                <option key={f.path}>{f.path}</option>
              ))}
          </Select>
        </label>
      </details>
      <p className="build-inspector-intro">
        每次保存都会保留版本。代码由你和 Agent 共同编辑，预览运行已保存内容。
      </p>
    </>
  );
  return (
    <>
      <BuildShell
        service={service}
        work={summary}
        dirty={dirty}
        busy={busy}
        status={busy ? "正在处理…" : dirty ? "有未保存的修改" : "已保存到本机"}
        onReview={onReview}
        onSubmit={onSubmit}
        onExport={() => setExporting(true)}
        inspector={panel}
        inspectorOpen={inspector}
        onInspector={() => setInspector((v) => !v)}
        toggleLabel="文件"
        controls={
          <div className="build-view-switch" aria-label="制作视图">
            {(["preview", "code", "split"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {{ preview: "画面", code: "代码", split: "分屏" }[v]}
              </button>
            ))}
          </div>
        }
        tools={
          <>
            <Button
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                dirtyRef.current = false;
                setSource(original);
                setBase(work);
                setTitle(work.title);
                setEntry(work.entry ?? "");
              }}
            >
              <RotateCcw size={14} />
              放弃修改
            </Button>
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              <Save size={14} />
              保存
            </Button>
            <Button
              variant="ghost"
              disabled={!work.entry || dirty || busy}
              onClick={() => void run(() => preview.start(work, store.files))}
            >
              <Play size={14} />
              运行
            </Button>
            <Button
              variant="ghost"
              disabled={state.status === "idle"}
              onClick={() => preview.stop()}
              aria-label="停止预览"
            >
              <Square size={13} />
            </Button>
          </>
        }
        bottom={
          <span className="build-page-preview-state">
            {state.id === work.id && state.revision && state.revision !== work.revision
              ? "预览来自较早版本"
              : "页面作品"}
          </span>
        }
      >
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        {dirty && base?.revision !== work.revision && (
          <div className="build-notice">
            源码已在其他窗口更新。当前草稿保留，保存前请先核对变化。
          </div>
        )}
        <div className={`build-editor-preview is-${view}`}>
          <section className="build-code" aria-label="文件编辑" hidden={view === "preview"}>
            <header>
              <Code2 size={13} />
              <code>{path || "选择文件"}</code>
              {dirty && <small>未保存</small>}
            </header>
            <textarea
              aria-label="作品文件内容"
              spellCheck={false}
              value={source}
              readOnly={!editable || busy}
              onChange={(e) => setSource(e.target.value)}
            />
          </section>
          <section className="build-preview" aria-label="作品运行预览" hidden={view === "code"}>
            <div className="build-frame" ref={preview.mount} />
            {state.status === "idle" && (
              <div className="build-empty-canvas">
                <Play size={30} />
                <span className="build-eyebrow">YOUR WORK, IN VIEW</span>
                <h2>让想法，出现在画面里。</h2>
                <p>运行已保存的页面，检查布局与交互。</p>
                <Button
                  disabled={!work.entry || dirty || busy}
                  onClick={() => void run(() => preview.start(work, store.files))}
                >
                  运行页面
                </Button>
              </div>
            )}
          </section>
        </div>
        {!!state.reports.length && (
          <details className="build-logs" open={state.reports.some((r) => r.level === "error")}>
            <summary>运行记录 · {state.reports.length}</summary>
            {state.reports.map((r, i) => (
              <pre key={i} data-level={r.level}>
                {r.level} · {r.message}
              </pre>
            ))}
          </details>
        )}
      </BuildShell>
      {exporting && (
        <Dialog
          open
          title="导出页面"
          className="build-export-dialog"
          onClose={() => setExporting(false)}
          closable={!busy}
        >
          <p className="build-dialog-intro">独立页面可直接打开；源码归档可用于恢复工程。</p>
          <div className="build-export-choices">
            <Button disabled={!work.entry || dirty || busy} onClick={() => void download("html")}>
              <Download size={16} />
              独立页面
            </Button>
            <Button disabled={dirty || busy} onClick={() => void download("archive")}>
              <Code2 size={16} />
              作品归档
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

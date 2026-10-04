import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AppToolbar,
  Button,
  Select,
  useLocationSearch,
  useNavigation,
  useOpenAssistant,
  useRuntime,
  useUpdateParticipant,
} from "@bcr/react";
import { Code2, Download, FilePlus2, Play, RotateCcw, Save, Sparkles, Square } from "lucide-react";
import { workspaceServices } from "../workspace";
import { mimeFor, type Work } from "./model";
import { LocalWork, RunnerConnection } from "./LocalWork";
import "./works.css";

const INITIAL =
  '<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>我的作品</title>\n<style>body{max-width:720px;margin:64px auto;padding:24px;font-family:system-ui;line-height:1.7}</style>\n<h1>从一个想法开始</h1>\n<p>请 AI 助手将这里变成你的交互作品。</p>\n</html>\n';

export function WorksApp() {
  const runtime = useRuntime(),
    workspace = useMemo(() => workspaceServices(runtime), [runtime]);
  const store = workspace.works,
    preview = workspace.preview;
  const works = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = useSyncExternalStore(preview.subscribe, preview.getSnapshot);
  const search = useLocationSearch(),
    navigation = useNavigation(),
    openAssistant = useOpenAssistant();
  const runner = workspace.workService.local;
  const connection = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const route = new URLSearchParams(search),
    isLocal = route.get("provider") === "local";
  const work = isLocal ? undefined : (works.find((w) => w.id === route.get("work")) ?? works[0]);
  const localWork = isLocal
    ? connection.items.find((w) => w.ref.id === route.get("work"))
    : undefined;
  const [connecting, setConnecting] = useState(false),
    [localDirty, setLocalDirty] = useState(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    const timer = setInterval(() => {
      void runner.refresh().catch((e) => setError(String(e)));
    }, 5000);
    return () => clearInterval(timer);
  }, [runner, connection.status]);
  const [path, setPath] = useState(""),
    [source, setSource] = useState(""),
    [original, setOriginal] = useState("");
  const [base, setBase] = useState<Work>(),
    [title, setTitle] = useState(""),
    [entry, setEntry] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [editable, setEditable] = useState(false),
    [history, setHistory] = useState<{ revision: string; title: string; updatedAt: number }[]>([]);
  const running = useRef(false),
    dirtyRef = useRef(false),
    draft = useRef<ReturnType<typeof store.registerDraft> | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const dirty =
    source !== original || (!!base && (title !== base.title || entry !== (base.entry ?? "")));
  dirtyRef.current = dirty;
  useEffect(() => {
    void store.ready.then(
      () => setReady(true),
      (e) => setError(String(e)),
    );
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
    let disposed = false;
    if (work)
      void store.history(work.id).then(
        (value) => {
          if (!disposed) setHistory(value.items);
        },
        (e) => {
          if (!disposed) setError(String(e));
        },
      );
    return () => {
      disposed = true;
    };
  }, [store, work]);
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
        await store.commit(
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
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  return (
    <div className="works-app">
      <AppToolbar>
        <Code2 size={18} aria-hidden="true" />
        <strong>作品</strong>
        <Select
          aria-label="选择作品"
          value={isLocal ? `local:${route.get("work")}` : (work?.id ?? "")}
          disabled={dirty || localDirty || busy}
          onChange={(e) => {
            preview.stop();
            runner.preview.stop();
            const value = e.target.value;
            navigation.navigate(
              value.startsWith("local:")
                ? `/works?provider=local&work=${encodeURIComponent(value.slice(6))}`
                : `/works?work=${value}`,
            );
          }}
        >
          {!works.length && <option value="">你的第一个作品</option>}
          <optgroup label="浏览器作品">
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </optgroup>
          {connection.items.length > 0 && (
            <optgroup label="本地工程">
              {connection.items.map((w) => (
                <option key={w.ref.id} value={`local:${w.ref.id}`}>
                  {w.title}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        <Button
          variant="ghost"
          disabled={!ready || dirty || localDirty || busy}
          onClick={() =>
            void run(async () => {
              const next = await store.commit({
                requestId: crypto.randomUUID(),
                revision: null,
                title: "新作品",
                entry: "index.html",
                put: [{ path: "index.html", text: INITIAL }],
              });
              preview.stop();
              navigation.navigate(`/works?work=${next.id}`);
            })
          }
        >
          <FilePlus2 size={16} />
          新建作品
        </Button>
        <Button
          variant="ghost"
          disabled={dirty || localDirty || busy}
          onClick={() => setConnecting(!connecting)}
        >
          {connection.status === "connected" ? "本地已连接" : "连接本地工程"}
        </Button>
        <span className="works-spacer" />
        <Button variant="ghost" onClick={() => openAssistant?.()}>
          <Sparkles size={16} />
          AI 助手
        </Button>
      </AppToolbar>
      {connecting && <RunnerConnection runner={runner} close={() => setConnecting(false)} />}
      {connection.errors.map((e) => (
        <p className="works-error" role="alert" key={e.directory}>
          {e.directory}: {e.message}
        </p>
      ))}
      {error && (
        <p className="works-error" role="alert">
          {error}
        </p>
      )}
      {isLocal ? (
        localWork ? (
          <LocalWork
            key={localWork.ref.id}
            runner={runner}
            work={localWork}
            onDirty={setLocalDirty}
          />
        ) : (
          <section className="works-empty">
            <h1>连接工程所在的 Runner</h1>
            <p>本地工程的源文件保留在文件系统中，连接后即可继续预览和导出。</p>
            <Button onClick={() => setConnecting(true)}>连接本地工程</Button>
          </section>
        )
      ) : !work ? (
        <section className="works-empty">
          <span className="works-kicker">AN OPEN CANVAS</span>
          <h1>让想法拥有自己的页面。</h1>
          <p>
            交互图表、资料浏览器、时间线，或你尚未命名的新工具。
            <br />
            创建一个作品，让助手从文件开始构建。
          </p>
          <div>
            <span>01 · 保存文件</span>
            <span>02 · 运行预览</span>
            <span>03 · 导出与分享</span>
          </div>
        </section>
      ) : (
        <div className="works-layout">
          <aside className="works-sidebar">
            <label className="works-label">
              作品名称
              <input
                aria-label="作品名称"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="works-label">
              页面入口
              <Select
                aria-label="页面入口"
                value={entry}
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
            <div className="works-section-title">
              <span>文件 / {work.files.length}</span>
              <button
                disabled={dirty || localDirty || busy}
                onClick={() => upload.current?.click()}
              >
                导入文件
              </button>
            </div>
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
                  await store.commit({
                    id: work.id,
                    revision: work.revision,
                    requestId: crypto.randomUUID(),
                    put,
                  });
                });
              }}
            />
            <nav aria-label="作品文件">
              {work.files.map((f) => (
                <button
                  key={f.path}
                  className={path === f.path ? "is-active" : ""}
                  disabled={dirty || localDirty || busy}
                  onClick={() => setPath(f.path)}
                >
                  <span>{f.path}</span>
                  <small>{(f.artifact.size / 1024).toFixed(1)} KB</small>
                </button>
              ))}
            </nav>
            <details className="works-history">
              <summary>
                版本记录 · {history.length}
                {history.length === 30 ? "+" : ""}
              </summary>
              {history.map((h) => (
                <div key={h.revision}>
                  <span>
                    {new Date(h.updatedAt).toLocaleString()}
                    <code>{h.revision.slice(0, 8)}</code>
                  </span>
                  {h.revision === work.revision ? (
                    <small>当前</small>
                  ) : (
                    <button
                      disabled={dirty || localDirty || busy}
                      onClick={() =>
                        void run(async () => {
                          await store.commit({
                            id: work.id,
                            revision: work.revision,
                            requestId: crypto.randomUUID(),
                            restoreRevision: h.revision,
                          });
                        })
                      }
                    >
                      恢复
                    </button>
                  )}
                </div>
              ))}
            </details>
            <p className="works-footnote">
              文件与版本保存在本机。每次保存保留历史，预览运行已保存版本。
            </p>
          </aside>
          <section className="works-editor" aria-label="文件编辑">
            <header>
              <span>
                {path || "选择文件"}
                {dirty ? " · 未保存" : ""}
              </span>
              <div>
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
                  撤销
                </Button>
                <Button disabled={!dirty || busy} onClick={() => void save()}>
                  <Save size={14} />
                  保存
                </Button>
              </div>
            </header>
            <textarea
              aria-label="作品文件内容"
              spellCheck={false}
              value={source}
              readOnly={!editable || busy}
              onChange={(e) => setSource(e.target.value)}
            />
            <footer>
              <code>{base?.revision.slice(0, 8)}</code>
              <span>{busy ? "正在处理…" : dirty ? "保存后可预览" : "已保存到本机"}</span>
            </footer>
          </section>
          <section className="works-preview" aria-label="作品运行预览">
            <header>
              <span>
                预览
                {state.id === work.id && state.revision && state.revision !== work.revision
                  ? " · 较早版本"
                  : ""}
              </span>
              <div>
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
                  <Square size={14} />
                </Button>
              </div>
            </header>
            <div className="works-frame" ref={preview.mount} />
            {state.status === "idle" && (
              <p className="works-preview-hint">点击「运行」查看作品。保存文件不会自动执行脚本。</p>
            )}
            <details
              className="works-reports"
              open={state.reports.some((r) => r.level === "error")}
            >
              <summary>运行记录 · {state.reports.length}</summary>
              {state.reports.map((r, i) => (
                <pre key={i} data-level={r.level}>
                  {r.level} · {r.message}
                </pre>
              ))}
            </details>
            <footer>
              <Button
                variant="ghost"
                disabled={!work.entry || dirty || busy}
                onClick={() => void download("html")}
              >
                <Download size={14} />
                独立页面
              </Button>
              <Button
                variant="ghost"
                disabled={dirty || localDirty || busy}
                onClick={() => void download("archive")}
              >
                作品归档
              </Button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

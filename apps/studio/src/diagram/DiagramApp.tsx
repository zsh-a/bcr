import "./assets";
import { Excalidraw, MainMenu, CaptureUpdateAction, getSceneVersion } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AppToolbar,
  ActionMenu,
  Button,
  Dialog,
  Drawer,
  IconButton,
  ResourceSearch,
  Textarea,
  Toast,
  useMediaQuery,
  useRuntime,
  useRuntimeActivity,
  useNavigation,
  useLocationSearch,
  useOpenAssistant,
  useUpdateParticipant,
} from "@bcr/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  Download,
  FileCode2,
  FileImage,
  FolderOpen,
  LayoutTemplate,
  Link,
  Plus,
  Scan,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { workspaceServices } from "../workspace";
import { themeStore } from "../theme/browser";
import { nativeFile, type DiagramScene } from "./model";
import type { DiagramDraft, DiagramStore } from "./store";
import { createGraph, importFile, importMermaid, layoutScene, renderPng, renderSvg } from "./scene";
import { architectureTemplate, flowTemplate, mermaidExample } from "./templates";
import "@excalidraw/excalidraw/index.css";
import "./diagram.css";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DiagramApp() {
  const runtime = useRuntime(),
    active = useRuntimeActivity(),
    navigation = useNavigation(),
    search = useLocationSearch();
  const store = useMemo(() => workspaceServices(runtime).diagrams, [runtime]);
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<DiagramDraft | null>(null),
    [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState(false),
    [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const id = new URLSearchParams(search).get("diagram");
  const select = useCallback(
    (id: string) => {
      navigation.navigate(`/diagram?diagram=${encodeURIComponent(id)}`);
      setLibrary(false);
    },
    [navigation],
  );
  useEffect(() => {
    let live = true;
    void store.ready.then(
      () => {
        if (live) setReady(true);
      },
      (reason) => {
        if (live) setError(message(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [store]);
  useEffect(() => {
    if (!active || !ready) return;
    if (!id) {
      setDraft(null);
      return;
    }
    if (draft?.getSnapshot().document.id === id) return;
    setDraft(null);
    setError("");
    let live = true;
    void store.open(id).then(
      (value) => {
        if (live) setDraft(value);
      },
      (reason) => {
        if (live) setError(message(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [id, store, active, ready]);
  useUpdateParticipant({
    blocked: () => (busy ? "绘图正在处理，请稍后更新。" : null),
    save: () => store.flush(),
  });
  async function create(template?: "flow" | "architecture") {
    setBusy(true);
    setError("");
    try {
      const scene = template
        ? await createGraph(template === "flow" ? flowTemplate : architectureTemplate)
        : undefined;
      const next = await store.create(
        template === "flow" ? "流程图" : template === "architecture" ? "系统架构" : "未命名图表",
        scene,
      );
      select(next.getSnapshot().document.id);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const next = await store.create(
        file.name.replace(/\.excalidraw$/i, "") || "导入的图表",
        await importFile(file),
      );
      select(next.getSnapshot().document.id);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="diagram-app" aria-label="绘图工作区" aria-busy={busy}>
      {draft ? (
        <DrawingEditor
          key={draft.getSnapshot().document.id}
          draft={draft}
          store={store}
          active={active}
          pending={busy}
          onLibrary={() => setLibrary((value) => !value)}
          onCreate={() => void create()}
          onImport={() => fileInput.current?.click()}
          onDeleted={() => navigation.navigate("/diagram")}
        />
      ) : (
        <AppToolbar className="diagram-toolbar">
          <Shapes size={19} />
          <strong className="diagram-app-label">绘图</strong>
          <span className="diagram-toolbar-spacer" />
          <Button variant="ghost" size="sm" onClick={() => setLibrary((value) => !value)}>
            <FolderOpen size={16} />
            我的图表
            <ChevronDown size={13} />
          </Button>
          <IconButton
            label="导入图表"
            title="导入 .excalidraw"
            disabled={!ready || busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} />
          </IconButton>
        </AppToolbar>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".excalidraw,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <Drawer
        open={library}
        onClose={() => setLibrary(false)}
        title="我的图表"
        closeLabel="关闭图表列表"
        className="diagram-library"
      >
        <ResourceSearch
          ref={searchInput}
          className="diagram-library-resource-search"
          aria-label="搜索图表"
          placeholder="搜索图表…"
          value={query}
          onValueChange={setQuery}
        />
        <Button variant="ghost" onClick={() => void create()} disabled={!ready || busy}>
          <Plus size={16} />
          新建图表
        </Button>
        <nav aria-label="图表列表">
          {items
            .filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                aria-current={item.id === id ? "page" : undefined}
                onClick={() => select(item.id)}
              >
                <Shapes size={17} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small>
                </span>
              </button>
            ))}
        </nav>
        {!items.some((item) => item.title.toLowerCase().includes(query.trim().toLowerCase())) && (
          <div className="diagram-library-empty" role="status">
            <p>
              {query.trim()
                ? `未找到与「${query.trim().slice(0, 30)}」匹配的图表`
                : "新建的图表会保存在这里。"}
            </p>
            {query && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  searchInput.current?.focus();
                }}
              >
                清除搜索
              </Button>
            )}
          </div>
        )}
      </Drawer>
      {error && (
        <div role="alert" className="diagram-alert">
          {error}
          <IconButton label="关闭提示" onClick={() => setError("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {!draft && (
        <section className="diagram-welcome" aria-labelledby="diagram-heading">
          <svg className="diagram-welcome-art" viewBox="0 0 310 126" fill="none" aria-hidden="true">
            <rect x="8" y="42" width="82" height="44" rx="10" />
            <rect x="119" y="42" width="82" height="44" rx="10" />
            <rect x="230" y="10" width="72" height="38" rx="9" />
            <rect x="230" y="80" width="72" height="38" rx="9" />
            <path d="M90 64h29M201 64h14V29h15M215 64v35h15" />
            <path d="m113 59 6 5-6 5m111-45 6 5-6 5m0 60 6 5-6 5" />
          </svg>
          <span className="diagram-eyebrow">把想法画清楚</span>
          <h1 id="diagram-heading">从一个想法，到一张图。</h1>
          <p>自由绘制，或让 AI 帮你梳理流程与架构。</p>
          <div className="diagram-starters">
            <button disabled={!ready || busy} onClick={() => void create()}>
              <Plus size={22} />
              <strong>空白画布</strong>
              <span>从这里开始</span>
            </button>
            <button disabled={!ready || busy} onClick={() => void create("flow")}>
              <Workflow size={22} />
              <strong>流程图</strong>
              <span>梳理步骤与判断</span>
            </button>
            <button disabled={!ready || busy} onClick={() => void create("architecture")}>
              <LayoutTemplate size={22} />
              <strong>系统架构</strong>
              <span>连接组件与数据</span>
            </button>
          </div>
          {!ready && !error && <p role="status">正在打开本地图表…</p>}
          {busy && <p role="status">正在准备画布…</p>}
          {items.length > 0 && (
            <div className="diagram-recent">
              <span>最近编辑</span>
              {items.slice(0, 3).map((item) => (
                <button key={item.id} onClick={() => select(item.id)}>
                  <Shapes size={15} />
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function DrawingEditor({
  draft,
  store,
  active,
  pending,
  onLibrary,
  onCreate,
  onImport,
  onDeleted,
}: {
  draft: DiagramDraft;
  store: DiagramStore;
  active: boolean;
  pending: boolean;
  onLibrary: () => void;
  onCreate: () => void;
  onImport: () => void;
  onDeleted: () => void;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot),
    theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const initial = useRef(state.document.scene),
    api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [apiReady, setApiReady] = useState(false),
    [selection, setSelection] = useState<readonly string[]>([]);
  const [title, setTitle] = useState(state.document.title),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [mermaid, setMermaid] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState("");
  const openAssistant = useOpenAssistant();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const processing = busy || pending;
  const saveLabel = state.error
    ? "保存失败"
    : state.saving
      ? "保存中…"
      : state.dirty
        ? "未保存"
        : "已保存";
  const signature = useRef("");
  useEffect(() => setTitle(state.document.title), [state.document.title]);
  useEffect(() => {
    const flush = () => void draft.flush().catch(() => undefined);
    const unload = (event: BeforeUnloadEvent) => {
      if (!draft.getSnapshot().dirty) return;
      flush();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", unload);
      flush();
    };
  }, [draft]);
  useEffect(() => {
    if (!active) return;
    store.current = { id: state.document.id, selection };
    return () => {
      if (store.current?.id === state.document.id) store.current = null;
    };
  }, [active, store, state.document.id, selection]);
  useEffect(() => {
    if (!apiReady) return;
    return draft.attachEditor((scene) => {
      api.current?.addFiles(Object.values(scene.files));
      api.current?.updateScene({
        elements: scene.elements,
        appState: scene.appState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
  }, [draft, apiReady]);
  useEffect(() => {
    if (!active || !apiReady) return;
    const frame = requestAnimationFrame(() => api.current?.refresh());
    return () => cancelAnimationFrame(frame);
  }, [active, apiReady]);
  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const selected = Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id],
      );
      setSelection((current) => (current.join("\0") === selected.join("\0") ? current : selected));
      const stamp = `${getSceneVersion(elements)}:${elements.length}:${appState.viewBackgroundColor}:${appState.gridSize}:${Object.keys(files).join(",")}`;
      if (signature.current === stamp) return;
      signature.current = stamp;
      // Selection, pan, zoom, theme and tool changes are transient; they never trigger a disk write.
      const scene: DiagramScene = {
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
        files,
      };
      draft.change({ scene });
    },
    [draft],
  );
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: "excalidraw" | "svg" | "png") {
    const document = draft.getSnapshot().document;
    const content =
      format === "excalidraw"
        ? new Blob([nativeFile(document)], { type: "application/json" })
        : format === "svg"
          ? new Blob([await renderSvg(document.scene)], { type: "image/svg+xml" })
          : await renderPng(document.scene);
    download(content, `${document.title.replace(/[\\/:*?"<>|]/g, "_")}.${format}`);
    setNotice("已导出图表");
  }
  async function copyReference() {
    const document = draft.getSnapshot().document;
    await navigator.clipboard.writeText(
      `[${document.title.replace(/[[\]]/g, "")}](/diagram?diagram=${document.id})`,
    );
    setNotice("已复制笔记引用");
  }
  async function layout() {
    const document = draft.getSnapshot().document,
      next = await layoutScene(document.scene, selection);
    draft.apply(next, document.revision);
    await draft.flush();
    fitCanvas();
  }
  function fitCanvas() {
    api.current?.scrollToContent(undefined, { fitToContent: true, animate: !reducedMotion });
  }
  function openMermaid() {
    setError("");
    setMermaid(mermaidExample);
  }
  return (
    <>
      <AppToolbar className="diagram-toolbar">
        <IconButton label="我的图表" title="我的图表" onClick={onLibrary}>
          <FolderOpen size={18} />
        </IconButton>
        <input
          className="diagram-title"
          aria-label="图表名称"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() && title.trim() !== state.document.title)
              draft.change({ title: title.trim() });
            else setTitle(state.document.title);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
          }}
        />
        <span
          className="diagram-save-state"
          role="status"
          aria-label={saveLabel}
          title={saveLabel}
          data-dirty={state.dirty}
          data-error={!!state.error}
        >
          {state.error ? (
            <AlertCircle size={14} aria-hidden="true" />
          ) : state.saving || state.dirty ? (
            <CircleDot size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          <span className="diagram-save-label">{saveLabel}</span>
        </span>
        <span className="diagram-toolbar-spacer" />
        <IconButton
          className="diagram-desktop-action"
          label="整理布局"
          title={selection.length ? "整理选中节点" : "整理全部节点"}
          disabled={processing || !apiReady}
          onClick={() => void run(layout)}
        >
          <LayoutTemplate size={17} />
        </IconButton>
        <IconButton
          className="diagram-desktop-action"
          label="从 Mermaid 插入"
          title="从 Mermaid 插入"
          disabled={processing}
          onClick={openMermaid}
        >
          <Code2 size={18} />
        </IconButton>
        <Button
          className="diagram-ai-button"
          aria-label="AI 绘图"
          title="AI 绘图"
          variant="ghost"
          size="sm"
          onClick={openAssistant}
          disabled={!openAssistant}
        >
          <Sparkles size={16} />
          <span>AI 绘图</span>
        </Button>
        <ActionMenu label="图表操作" variant="menu" className="diagram-actions">
          <button type="button" role="menuitem" disabled={processing} onClick={onCreate}>
            <Plus size={16} />
            新建图表
          </button>
          <button type="button" role="menuitem" disabled={processing} onClick={onImport}>
            <Upload size={16} />
            导入图表
          </button>
          <div className="ui-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="diagram-mobile-action"
            disabled={processing || !apiReady}
            onClick={() => void run(layout)}
          >
            <LayoutTemplate size={16} />
            整理布局
          </button>
          <button
            type="button"
            role="menuitem"
            className="diagram-mobile-action"
            disabled={processing}
            onClick={openMermaid}
          >
            <Code2 size={16} />
            从 Mermaid 插入
          </button>
          <button type="button" role="menuitem" disabled={!apiReady} onClick={fitCanvas}>
            <Scan size={16} />
            适应画布
          </button>
          <div className="ui-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={processing}
            onClick={() => void run(() => exportFile("excalidraw"))}
          >
            <Download size={16} />
            下载可编辑文件
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={processing}
            onClick={() => void run(() => exportFile("svg"))}
          >
            <FileCode2 size={16} />
            导出 SVG
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={processing}
            onClick={() => void run(() => exportFile("png"))}
          >
            <FileImage size={16} />
            导出 PNG
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={processing}
            onClick={() => void run(copyReference)}
          >
            <Link size={16} />
            复制笔记引用
          </button>
          <div className="ui-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={processing}
            onClick={() => {
              setError("");
              setDeleting(true);
            }}
          >
            <Trash2 size={16} />
            删除图表
          </button>
        </ActionMenu>
      </AppToolbar>
      {(error || state.error) && (
        <div role="alert" className="diagram-alert">
          <span>{error || state.error}</span>
          {state.error && (
            <Button
              size="sm"
              onClick={() =>
                void run(async () => {
                  await draft.flush();
                })
              }
            >
              重试保存
            </Button>
          )}
          {error && (
            <IconButton label="关闭提示" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          )}
        </div>
      )}
      <Toast
        notice={notice ? { message: notice, tone: "success" } : null}
        onDismiss={() => setNotice("")}
      />
      <div className="diagram-canvas" data-testid="diagram-canvas">
        <Excalidraw
          initialData={{
            ...initial.current,
            appState: {
              ...initial.current.appState,
              currentItemFontFamily: 2,
              currentItemRoughness: 0,
              currentItemStrokeColor: "#26423f",
              currentItemBackgroundColor: "transparent",
            },
            scrollToContent: true,
          }}
          excalidrawAPI={(value) => {
            api.current = value;
            setApiReady(true);
          }}
          onChange={onChange}
          theme={theme.resolved}
          langCode="zh-CN"
          name={state.document.title}
          handleKeyboardGlobally={false}
          viewModeEnabled={busy || !active}
          validateEmbeddable={() => false}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
              toggleTheme: false,
            },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </div>
      <Dialog
        open={mermaid !== null}
        onClose={() => setMermaid(null)}
        title="从 Mermaid 插入"
        closable={!busy}
        className="diagram-code-dialog"
      >
        <p>将流程描述转换为可编辑图形，插入到当前画布。</p>
        <Textarea
          aria-label="Mermaid 代码"
          aria-invalid={!!error}
          aria-describedby={error ? "diagram-mermaid-error" : undefined}
          disabled={busy}
          value={mermaid ?? ""}
          onChange={(event) => setMermaid(event.target.value)}
          spellCheck={false}
          rows={10}
        />
        {error && (
          <p id="diagram-mermaid-error" className="diagram-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="diagram-dialog-actions">
          <Button variant="ghost" onClick={() => setMermaid(null)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || !mermaid?.trim()}
            onClick={() =>
              void run(async () => {
                const document = draft.getSnapshot().document,
                  right = Math.max(
                    0,
                    ...document.scene.elements
                      .filter((element) => !element.isDeleted)
                      .map((element) => element.x + element.width),
                  );
                const next = await importMermaid(mermaid!, { x: right + 80, y: 80 });
                draft.apply(
                  {
                    ...document.scene,
                    elements: [...document.scene.elements, ...next.elements],
                    files: { ...document.scene.files, ...next.files },
                  },
                  document.revision,
                );
                await draft.flush();
                setMermaid(null);
                api.current?.scrollToContent(next.elements, {
                  fitToContent: true,
                  animate: !reducedMotion,
                });
              })
            }
          >
            {busy ? "正在生成…" : "插入图形"}
          </Button>
        </div>
      </Dialog>
      <Dialog open={deleting} onClose={() => setDeleting(false)} title="删除图表" closable={!busy}>
        <p>删除“{state.document.title}”？此操作会移除本机保存的图表。</p>
        {error && (
          <p className="diagram-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="diagram-dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await store.remove(state.document.id, state.document.revision);
                setDeleting(false);
                onDeleted();
              })
            }
          >
            删除图表
          </Button>
        </div>
      </Dialog>
    </>
  );
}

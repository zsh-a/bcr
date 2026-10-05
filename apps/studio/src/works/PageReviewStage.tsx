import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, Select } from "@bcr/react";
import { Camera, LoaderCircle, MousePointer2 } from "lucide-react";
import type { PageState, ReviewAnchor, ReviewView } from "@bcr/work-core";
import { WorkPreview } from "./preview";
import { LocalPreview } from "./runner-preview";
import type { StageProps } from "./ReviewStage";

export function PageReviewStage({
  service,
  workRef,
  submission,
  ref,
  pageReview,
  annotate,
  point,
  pointView,
  onOutput,
  onPoint,
  focus,
}: StageProps) {
  const pages = submission.pages ?? [{ path: submission.target.entry, title: submission.title }];
  const views = (pageReview?.views ?? []).filter((v) => v.submissionId === submission.id);
  const [path, setPath] = useState(pages[0]!.path),
    [viewId, setViewId] = useState("");
  const view = views.find((v) => v.id === viewId);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const requested = pageReview?.viewport ?? viewport;
  const size = view?.page.viewport ?? requested;
  const [reload, setReload] = useState(0);
  const [actualSize, setActualSize] = useState(false);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [loading, setLoading] = useState(true),
    [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]);
  const [image, setImage] = useState("");
  const browser = useMemo(() => new WorkPreview(), []),
    local = useMemo(() => new LocalPreview(), []);
  const localState = useSyncExternalStore(local.subscribe, local.getSnapshot);
  const showingPath =
    !view && workRef.provider === "local" && localState.status === "ready"
      ? (localState.path ?? path)
      : path;
  const outer = useRef<HTMLDivElement>(null),
    restoring = useRef<PageState | undefined>(undefined);
  const currentView = useRef(view);
  currentView.current = view;
  const alive = useRef(new AbortController());
  const flight = useRef<Promise<ReviewAnchor> | undefined>(undefined);
  const disabled = !!pageReview?.locked || capturing;
  useEffect(() => {
    const abort = new AbortController();
    alive.current = abort;
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!outer.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(outer.current);
    return () => observer.disconnect();
  }, []);
  const openView = (v: ReviewView) => {
    setPath(v.page.path);
    setViewId(v.id);
    setError("");
  };
  useEffect(() => {
    if (focus?.viewId) {
      const v = views.find((v) => v.id === focus.viewId);
      if (v) openView(v);
    } else if (focus?.page) {
      restoring.current = focus.page;
      setPath(focus.page.path);
      setViewport(focus.page.viewport);
      pageReview?.onViewport(focus.page.viewport);
      setViewId("");
    } else if (focus?.output) {
      const output = submission.outputs.find((o) => o.key === focus.output);
      const page = pages.find((p) => p.path === output?.path);
      if (page) {
        setPath(page.path);
        setViewId("");
      }
    }
  }, [focus]);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    setImage("");
    setError("");
    setLoading(true);
    setWarnings([]);
    void (async () => {
      try {
        if (view) {
          const blob = await service.reviewImage(workRef, view.image, abort.signal);
          if (abort.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setImage(objectUrl);
          setWarnings([...view.warnings]);
          return;
        }
        if (workRef.provider === "browser") {
          const { html } = await service.reviewDocument(workRef, submission, path, abort.signal);
          await browser.startDocument(
            { id: workRef.id, revision: submission.sourceRevision, title: submission.title },
            html,
            abort.signal,
          );
        } else {
          service.assertSource(workRef.sourceId);
          if (!submission.previewJobId) throw new Error("此稿没有固定页面预览");
          const resource = await service.local.previewResource(
            submission.previewJobId,
            abort.signal,
          );
          const url = new URL(resource.url);
          url.pathname = `/${resource.jobId}/${path.split("/").map(encodeURIComponent).join("/")}`;
          await local.start({ ...resource, url: url.href }, abort.signal);
        }
        const state = restoring.current;
        restoring.current = undefined;
        if (state) {
          const result = await (workRef.provider === "browser" ? browser : local).page(
            "page-restore",
            state,
          );
          if (Array.isArray(result)) setWarnings(result.map(String).slice(0, 20));
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      abort.abort();
      browser.stop();
      local.stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    service,
    workRef.sourceId,
    workRef.id,
    submission.id,
    path,
    viewId,
    requested.width,
    requested.height,
    reload,
    browser,
    local,
  ]);
  const position = async (): Promise<ReviewAnchor> => {
    const saved = currentView.current;
    if (saved) return { viewId: saved.id, page: saved.page, viewport: saved.page.viewport };
    if (loading) throw new Error("页面尚未就绪");
    const page = (await (workRef.provider === "browser" ? browser : local).page(
      "page-state",
    )) as PageState;
    const actualPath = workRef.provider === "local" ? page.path : path;
    if (!pages.some((p) => p.path === actualPath))
      throw new Error("当前页面未包含在审阅清单，请从页面选择器打开已提交页面");
    return { page: { ...page, path: actualPath, viewport: requested }, viewport: requested };
  };
  const capture = (): Promise<ReviewAnchor> => {
    if (currentView.current) return position();
    if (flight.current) return flight.current;
    const result = (async () => {
      setCapturing(true);
      setError("");
      pageReview?.onBusy(true);
      try {
        if (!pageReview) throw new Error("审阅视图存储未就绪");
        const anchor = await position();
        const saved = await service.capturePage(
          workRef,
          submission.id,
          anchor.page!,
          crypto.randomUUID(),
          alive.current.signal,
        );
        alive.current.signal.throwIfAborted();
        await pageReview.saveView(saved);
        alive.current.signal.throwIfAborted();
        currentView.current = saved;
        openView(saved);
        return { viewId: saved.id, page: saved.page, viewport: saved.page.viewport };
      } catch (e) {
        if (!alive.current.signal.aborted) setError(String(e));
        throw e;
      } finally {
        if (!alive.current.signal.aborted) setCapturing(false);
        pageReview?.onBusy(false);
        flight.current = undefined;
      }
    })();
    flight.current = result;
    return result;
  };
  useImperativeHandle(ref, () => ({
    position,
    capture,
    seek: async () => {},
    applyPage: async (state) => {
      if (!pages.some((p) => p.path === state.path)) throw new Error("对照稿不包含此页面");
      restoring.current = state;
      setPath(state.path);
      setViewId("");
      setViewport(state.viewport);
      pageReview?.onViewport(state.viewport);
      // If the page is already mounted at this size, there is no new load effect.
      if (
        !view &&
        path === state.path &&
        size.width === state.viewport.width &&
        size.height === state.viewport.height
      ) {
        const result = await (workRef.provider === "browser" ? browser : local).page(
          "page-restore",
          state,
        );
        restoring.current = undefined;
        if (Array.isArray(result)) setWarnings(result.map(String).slice(0, 20));
      }
    },
  }));
  const scale = actualSize
    ? 1
    : Math.max(0.01, Math.min(1, bounds.width / size.width, bounds.height / size.height));
  return (
    <section className="review-stage review-page" aria-label={`${submission.title} 画面`}>
      <header className="review-stage-header">
        <div>
          <span className="review-eyebrow">PAGE</span>
          <strong>{submission.title}</strong>
        </div>
        <Select
          aria-label={`${submission.title} 页面`}
          value={showingPath}
          disabled={disabled}
          onChange={(e) => {
            setPath(e.target.value);
            setViewId("");
            setReload((n) => n + 1);
          }}
        >
          {!pages.some((p) => p.path === showingPath) && (
            <option value={showingPath} disabled>
              未提交：{showingPath}
            </option>
          )}
          {pages.map((p) => (
            <option key={p.path} value={p.path}>
              {p.title === submission.title ? p.path : p.title}
            </option>
          ))}
        </Select>
      </header>
      <div className="review-page-tools">
        <Select
          aria-label={`${submission.title} 视口`}
          value={`${size.width}x${size.height}`}
          disabled={disabled || !!view}
          onChange={(e) => {
            const [width, height] = e.target.value.split("x").map(Number);
            const value = { width: width!, height: height! };
            setViewport(value);
            pageReview?.onViewport(value);
          }}
        >
          <option value="1280x800">桌面 · 1280 × 800</option>
          <option value="768x1024">平板 · 768 × 1024</option>
          <option value="390x844">手机 · 390 × 844</option>
          {!["1280x800", "768x1024", "390x844"].includes(`${size.width}x${size.height}`) && (
            <option value={`${size.width}x${size.height}`}>
              {size.width} × {size.height}
            </option>
          )}
        </Select>
        <Button
          variant="ghost"
          aria-pressed={actualSize}
          onClick={() => setActualSize(!actualSize)}
        >
          {actualSize ? "适应画布" : "实际大小"}
        </Button>
        {view ? (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              restoring.current = view.page;
              setViewport(view.page.viewport);
              pageReview?.onViewport(view.page.viewport);
              setViewId("");
            }}
          >
            <MousePointer2 size={14} />
            恢复交互
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => void capture().catch(() => undefined)}
          >
            {capturing ? (
              <LoaderCircle size={14} className="review-spinner" />
            ) : (
              <Camera size={14} />
            )}
            保存视图
          </Button>
        )}
      </div>
      <div className={`review-surface ${actualSize ? "is-actual" : ""}`} ref={outer}>
        <div
          className="review-page-fit"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <div
            className="review-page-native"
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
          >
            <div
              className="review-frame"
              style={{ display: view ? "none" : "block" }}
              ref={workRef.provider === "browser" ? browser.mount : local.mount}
            />
            {view && image && (
              <img className="review-page-image" src={image} alt={`${view.title} 固定截图`} />
            )}
          </div>
          {(loading || capturing) && (
            <div className="review-stage-placeholder" role="status">
              <LoaderCircle size={22} className="review-spinner" />
              <span>{capturing ? "正在保存页面视图" : "正在打开页面"}</span>
            </div>
          )}
          {error && (
            <div className="review-page-error" role="alert">
              {error}
            </div>
          )}
          {annotate && view && image && !loading && (
            <button
              className="review-pin-layer"
              aria-label="在画面上定位反馈"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const p = {
                  x: event.detail === 0 ? 0.5 : (event.clientX - box.left) / box.width,
                  y: event.detail === 0 ? 0.5 : (event.clientY - box.top) / box.height,
                };
                const x = p.x * size.width,
                  y = p.y * size.height;
                const element = view.elements
                  .filter((e) => x >= e.x && y >= e.y && x <= e.x + e.width && y <= e.y + e.height)
                  .sort((a, b) => a.width * a.height - b.width * b.height)[0];
                onPoint?.(p, element);
              }}
            >
              <span>确认截图后，点击需要调整的位置</span>
            </button>
          )}
          {point && view && pointView === view.id && (
            <span
              aria-label="反馈位置"
              className="review-pin"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            >
              1
            </span>
          )}
        </div>
      </div>
      {warnings.length > 0 && (
        <details className="review-page-warnings">
          <summary>{warnings.length} 项状态恢复提示</summary>
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </details>
      )}
      <footer className="review-stage-footer">
        <span>
          {view ? "固定截图 · 状态重放" : "交互页面"} · {Math.round(scale * 100)}%
        </span>
        <span>{submission.sourceRevision.slice(0, 8)}</span>
      </footer>
      {submission.outputs.some((o) => /^(image|video)\//u.test(o.mime)) && (
        <Select
          aria-label={`${submission.title} 附带文件`}
          value=""
          disabled={disabled}
          onChange={(e) => onOutput?.(e.target.value)}
        >
          <option value="">查看附带图片或视频…</option>
          {submission.outputs
            .filter((o) => /^(image|video)\//u.test(o.mime))
            .map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
        </Select>
      )}
      {views.length > 24 && (
        <Select
          aria-label={`${submission.title} 全部视图`}
          value={viewId}
          disabled={disabled}
          onChange={(e) => {
            const v = views.find((v) => v.id === e.target.value);
            if (v) openView(v);
          }}
        >
          <option value="">选择已保存视图…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} · {new Date(v.createdAt).toLocaleString()}
            </option>
          ))}
        </Select>
      )}
      {views.length > 0 && (
        <nav className="review-views" aria-label={`${submission.title} 已保存视图`}>
          {views.slice(-24).map((v) => (
            <button
              key={v.id}
              aria-pressed={v.id === viewId}
              disabled={disabled}
              onClick={() => openView(v)}
            >
              <ReviewThumbnail service={service} workRef={workRef} view={v} />
              <span>{v.page.path}</span>
              <small>
                {v.page.viewport.width} × {v.page.viewport.height} · 滚动{" "}
                {Math.round(v.page.scroll?.y ?? 0)}
              </small>
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}

export function ReviewThumbnail({
  service,
  workRef,
  view,
}: Pick<StageProps, "service" | "workRef"> & { view: ReviewView }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    void service
      .reviewImage(workRef, view.image, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(""));
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [service, workRef.sourceId, workRef.id, view.image.hash]);
  return url ? (
    <img src={url} alt={view.title} />
  ) : (
    <span className="review-thumbnail-empty">页面视图</span>
  );
}

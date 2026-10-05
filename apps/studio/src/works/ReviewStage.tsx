import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Button, Select } from "@bcr/react";
import { Download, Image, LoaderCircle } from "lucide-react";
import type {
  ReviewAnchor,
  Submission,
  WorkRef,
  ReviewView,
  PageState,
  PageViewport,
  PageElement,
} from "@bcr/work-core";
import { isTimelineAnchor, targetSurface } from "@bcr/work-core";
import { PageReviewStage } from "./PageReviewStage";
import { RunnerPreview } from "./runner-preview";
import type { WorkService } from "./service";
import { downloadBlob } from "./review-session";

export type StageHandle = {
  position(): Promise<ReviewAnchor>;
  seek(frame: number): Promise<void>;
  capture?(): Promise<ReviewAnchor>;
  applyPage?(state: PageState): Promise<void>;
};
export type StageProps = {
  service: WorkService;
  workRef: WorkRef;
  submission: Submission;
  annotate?: boolean;
  point?: { x: number; y: number } | undefined;
  pointOutput?: string | undefined;
  pointView?: string | undefined;
  onOutput?: (key: string) => void;
  initialOutput?: string;
  onPoint?: ((point: { x: number; y: number }, element?: PageElement) => void) | undefined;
  focus?: ReviewAnchor | undefined;
  ref?: Ref<StageHandle>;
  pageReview?: {
    views: readonly ReviewView[];
    viewport: PageViewport;
    onViewport(value: PageViewport): void;
    saveView(view: ReviewView): Promise<void>;
    locked: boolean;
    onBusy(value: boolean): void;
  };
};
export function ReviewStage(props: StageProps) {
  const [output, setOutput] = useState("");
  useEffect(() => {
    if (props.focus) setOutput(props.focus.output ?? "");
  }, [props.focus]);
  const html = targetSurface(props.submission.target) === "page";
  const media = props.submission.outputs.some(
    (o) => o.key === output && /^(image|video)\//u.test(o.mime),
  );
  return html && !media ? (
    <PageReviewStage {...props} onOutput={setOutput} />
  ) : (
    <MediaReviewStage
      {...props}
      {...(html ? { initialOutput: output, onOutput: setOutput } : {})}
    />
  );
}
function MediaReviewStage({
  service,
  workRef,
  submission,
  annotate = false,
  point,
  pointOutput,
  onPoint,
  focus,
  ref,
  initialOutput,
  onOutput,
  pageReview,
}: StageProps) {
  const [outputKey, setOutputKey] = useState(
    () =>
      initialOutput ??
      submission.outputs.find((o) => o.mime.startsWith("video/"))?.key ??
      submission.outputs.find((o) => o.mime.startsWith("image/"))?.key ??
      "preview",
  );
  const [blob, setBlob] = useState<Blob>(),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const preview = useMemo(() => new RunnerPreview(), []);
  const video = useRef<HTMLVideoElement>(null),
    surface = useRef<HTMLDivElement>(null),
    outer = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [aspect, setAspect] = useState(
    submission.target.runtime === "remotion"
      ? submission.target.width / submission.target.height
      : 1,
  );
  useEffect(() => {
    if (!outer.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(outer.current);
    return () => observer.disconnect();
  }, []);
  const media = submission.outputs.find((o) => o.key === outputKey);
  const interactive = !media || media.mime === "text/html";
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    if (focus?.output) setOutputKey(focus.output);
  }, [focus]);
  const seek = async (frame: number) => {
    if (submission.target.runtime !== "remotion") return;
    if (interactive) await preview.inspect("seek", frame);
    else if (video.current) {
      if (video.current.readyState < 1) return; // The metadata event applies the pending anchor.
      const seconds = (frame - (media?.fromFrame ?? 0)) / submission.target.fps;
      if (seconds < 0 || seconds > video.current.duration)
        throw new Error("此片段不包含该帧，请单独定位比较");
      video.current.pause();
      video.current.currentTime = seconds;
    } else if (media?.frame !== undefined) {
      const image = submission.outputs.find((o) => o.frame === frame);
      if (!image) throw new Error("对照稿没有该帧的图片，请选择视频或交互预览");
      setOutputKey(image.key);
    }
  };
  useImperativeHandle(ref, () => ({
    position: async () => {
      const size = surface.current?.getBoundingClientRect();
      let frame: number | undefined = media?.frame,
        context: string | undefined;
      if (video.current && submission.target.runtime === "remotion") {
        video.current.pause();
        frame = Math.min(
          submission.target.durationInFrames - 1,
          Math.floor(video.current.currentTime * submission.target.fps) + (media?.fromFrame ?? 0),
        );
      }
      if (interactive) {
        if (submission.target.runtime === "remotion") await preview.inspect("pause");
        const result = (await preview.inspect("inspect")) as { frame: number | null; text: string };
        if (result.frame !== null) frame = result.frame;
        if (result.text) context = result.text.slice(0, 8000);
      }
      const common = {
        ...(context ? { context } : {}),
        ...(size ? { viewport: { width: size.width, height: size.height } } : {}),
        ...(media ? { output: media.key } : {}),
      };
      const duration =
        submission.target.runtime === "remotion" ? submission.target.durationInFrames : 1;
      return targetSurface(submission.target) === "timeline"
        ? {
            kind: "timeline" as const,
            frame: Math.max(0, Math.min(duration - 1, frame ?? 0)),
            ...common,
          }
        : { kind: "artifact" as const, ...common };
    },
    seek,
  }));
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    setUrl("");
    setBlob(undefined);
    setError("");
    setLoading(true);
    void (async () => {
      try {
        if (interactive) {
          service.assertSource(workRef.sourceId);
          if (!submission.previewJobId) throw new Error("此版本没有交互预览，请选择图片或视频");
          await preview.start(
            await service.runner.previewResource(submission.previewJobId, abort.signal),
            abort.signal,
          );
          if (isTimelineAnchor(focusRef.current))
            await preview.inspect("seek", focusRef.current.frame);
        } else if (media) {
          const loaded = await service.reviewOutput(workRef, media, abort.signal);
          if (abort.signal.aborted) return;
          objectUrl = URL.createObjectURL(loaded.slice(0, loaded.size, media.mime));
          setBlob(loaded);
          setUrl(objectUrl);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      abort.abort();
      preview.stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [service, workRef.sourceId, workRef.id, submission.id, media?.key, interactive, preview]);
  useEffect(() => {
    const frame = isTimelineAnchor(focus) ? focus.frame : undefined;
    if (!loading && frame !== undefined) void seek(frame).catch((e) => setError(String(e)));
  }, [focus, loading]);
  return (
    <section className="review-stage" aria-label={`${submission.title} 画面`}>
      <header className="review-stage-header">
        <div>
          <span className="review-eyebrow">
            {targetSurface(submission.target) === "timeline" ? "MOTION" : "PAGE"}
          </span>
          <strong>{submission.title}</strong>
        </div>
        <Select
          aria-label={`${submission.title} 查看内容`}
          value={outputKey}
          disabled={pageReview?.locked}
          onChange={(e) =>
            e.target.value === "page-view" ? onOutput?.("") : setOutputKey(e.target.value)
          }
        >
          {onOutput && <option value="page-view">返回页面</option>}
          {targetSurface(submission.target) === "timeline" && submission.previewJobId && (
            <option value="preview">交互预览</option>
          )}
          {submission.outputs
            .filter((o) => /^(image|video)\//u.test(o.mime))
            .map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
        </Select>
      </header>
      <div className={`review-surface ${interactive ? "is-interactive" : ""}`} ref={outer}>
        <div
          className="review-viewport"
          ref={surface}
          style={
            interactive
              ? { width: "100%", height: "100%" }
              : {
                  width: Math.min(bounds.width, bounds.height * aspect),
                  height: Math.min(bounds.height, bounds.width / aspect),
                }
          }
        >
          {interactive ? (
            <div className="review-frame" ref={preview.mount} />
          ) : media?.mime.startsWith("image/") && url ? (
            <img
              src={url}
              onLoad={(e) =>
                setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)
              }
              alt={`${submission.title} ${media.name}`}
            />
          ) : media?.mime.startsWith("video/") && url ? (
            <video
              ref={video}
              src={url}
              controls
              playsInline
              preload="metadata"
              aria-label={`${submission.title} 视频`}
              onLoadedMetadata={() => {
                if (video.current) setAspect(video.current.videoWidth / video.current.videoHeight);
                if (isTimelineAnchor(focusRef.current))
                  void seek(focusRef.current.frame).catch((e) => setError(String(e)));
              }}
            />
          ) : null}
          {loading && (
            <div className="review-stage-placeholder" role="status">
              <LoaderCircle className="review-spinner" size={22} />
              <span>正在打开作品</span>
            </div>
          )}
          {error && (
            <div className="review-stage-placeholder" role="alert">
              <Image size={24} />
              <p>{error}</p>
            </div>
          )}
          {annotate && !loading && !error && (
            <button
              type="button"
              className="review-pin-layer"
              aria-label="在画面上定位反馈"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                onPoint?.({
                  x: event.detail === 0 ? 0.5 : (event.clientX - box.left) / box.width,
                  y: event.detail === 0 ? 0.5 : (event.clientY - box.top) / box.height,
                });
              }}
            >
              <span>点击画面，标记位置</span>
            </button>
          )}
          {point && (pointOutput ? pointOutput === media?.key : interactive) && (
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
      <footer className="review-stage-footer">
        <span>
          {submission.target.id} · {submission.sourceRevision.slice(0, 8)}
        </span>
        {blob && media && (
          <Button
            variant="ghost"
            aria-label={`下载 ${media.name}`}
            onClick={() => downloadBlob(blob, media.name)}
          >
            <Download size={13} />
            下载
          </Button>
        )}
      </footer>
    </section>
  );
}

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Select, useUpdateParticipant } from "@bcr/react";
import {
  ChevronDown,
  Clapperboard,
  FileCode2,
  Layers,
  Play,
  RefreshCw,
  Save,
  Square,
} from "lucide-react";
import { targetSurface, type Project, type Job } from "@bcr/work-core";
import type { WorkService } from "./service";
import { ReviewSession } from "./review-session";
import { SubmitReviewDialog } from "./ReviewDialogs";
import { WorkSession } from "./session";
import { BuildShell } from "./BuildShell";
import { ExportDialog, JobDrawer } from "./BuildTools";
import { ArtifactViewer } from "./ArtifactViewer";

export function WorkBuild({
  service,
  work,
  onBlocked,
  onReview,
}: {
  service: WorkService;
  work: Project;
  onBlocked: (dirty: boolean) => void;
  onReview: () => void;
}) {
  const session = useMemo(
    () => new WorkSession(service, work),
    [service, work.ref.sourceId, work.ref.id],
  );
  const reviewSession = useMemo(
    () => new ReviewSession(service, work.ref),
    [service, work.ref.sourceId, work.ref.id],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { jobs, params, dirty, busy, error, loadingParams, paramError, liveError } = state,
    target = session.target,
    runner = service.runner;
  const preview = useSyncExternalStore(runner.preview.subscribe, runner.preview.getSnapshot);
  const [inspector, setInspector] = useState(true),
    [dialog, setDialog] = useState<"export" | "jobs" | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [artifact, setArtifact] = useState<{ job: Job; name: string }>();
  const run = (action: () => Promise<unknown>) => session.run(action);
  const activePreview = session.activePreview,
    live = activePreview && preview.draft;
  const stale = activePreview && preview.revision !== work.revision;
  const running = jobs.filter((j) => ["queued", "running"].includes(j.status));
  useEffect(() => session.start(), [session]);
  useEffect(() => session.update(work), [session, work]);
  useEffect(() => {
    if (!submitOpen) return;
    return reviewSession.start();
  }, [reviewSession, submitOpen]);
  useEffect(() => {
    onBlocked(dirty || busy || submitOpen);
    return () => onBlocked(false);
  }, [dirty, busy, onBlocked, submitOpen]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (session.getSnapshot().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [session]);
  useUpdateParticipant({
    blocked: () => (session.getSnapshot().dirty ? "作品有未保存参数，请先保存或撤销。" : null),
    save: async () => {},
  });
  const panel = (
    <>
      <div className="build-inspector-heading">
        <span>参数</span>
        <small>{dirty ? "未保存" : "已保存"}</small>
      </div>
      <p className="build-inspector-intro">
        {session.canTryParameters
          ? "调整后直接在画面中试看。满意后再保存。"
          : "生成当前版本的预览，即可即时试调参数。"}
      </p>
      {target.runtime === "remotion" && target.parameters?.length ? (
        <>
          {target.parameters.map((p) => (
            <label
              className={`build-parameter ${p.type === "boolean" ? "is-toggle" : ""}`}
              key={p.key}
            >
              <span>{p.label}</span>
              <input
                aria-label={p.label}
                type={p.type === "boolean" ? "checkbox" : p.type === "number" ? "number" : "text"}
                {...(p.type === "boolean"
                  ? { checked: Boolean(params[p.key]) }
                  : { value: String(params[p.key] ?? "") })}
                min={p.min}
                max={p.max}
                step={p.step ?? "any"}
                disabled={busy || loadingParams}
                onChange={(e) =>
                  session.setParameter(
                    p.key,
                    p.type === "boolean"
                      ? e.target.checked
                      : p.type === "number" && e.target.value !== ""
                        ? Number(e.target.value)
                        : e.target.value,
                  )
                }
              />
              {p.type === "number" && p.min !== undefined && p.max !== undefined && (
                <input
                  type="range"
                  aria-label={`${p.label}滑块`}
                  min={p.min}
                  max={p.max}
                  step={p.step ?? 1}
                  value={Number(params[p.key] ?? p.min)}
                  disabled={busy || loadingParams}
                  onChange={(e) => session.setParameter(p.key, Number(e.target.value))}
                />
              )}
            </label>
          ))}
          {paramError && (
            <p className="works-error" role="alert">
              {paramError}
            </p>
          )}
          <div className="build-parameter-actions">
            <Button
              disabled={!dirty || busy || !!paramError}
              onClick={() => void run(() => session.saveParameters())}
            >
              <Save size={14} />
              保存参数
            </Button>
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => session.discard()}>
              放弃修改
            </Button>
          </div>
        </>
      ) : (
        <div className="build-quiet">
          <FileCode2 size={22} />
          <p>此目标没有可调参数。</p>
          <small>在工程中声明希望通过界面调整的字段。</small>
        </div>
      )}
      <details className="build-source-list">
        <summary>
          源码 <span>{work.files.length} 个文件</span>
          <ChevronDown size={12} />
        </summary>
        {work.files.map((f) => (
          <div key={f.path}>
            <code>{f.path}</code>
            <small>{(f.size / 1024).toFixed(1)} KB</small>
          </div>
        ))}
      </details>
      <div className="build-inspector-footnote">
        <code>{target.entry}</code>
        <p>
          {target.runtime === "remotion"
            ? `${target.width} × ${target.height} · ${target.fps} fps · ${(target.durationInFrames / target.fps).toFixed(1)} 秒`
            : "HTML / CSS / JavaScript"}
        </p>
      </div>
    </>
  );
  return (
    <>
      <BuildShell
        service={service}
        work={work}
        dirty={dirty}
        busy={busy}
        status={dirty ? "参数草稿 · 尚未保存" : stale ? "源码已更新 · 画面来自较早版本" : "已保存"}
        onSubmit={() => setSubmitOpen(true)}
        onExport={() => setDialog("export")}
        inspector={panel}
        inspectorOpen={inspector}
        onInspector={() => setInspector((v) => !v)}
        controls={
          <>
            <Select
              aria-label="输出目标"
              value={target.id}
              disabled={dirty || busy}
              onChange={(e) => session.selectTarget(e.target.value)}
            >
              {work.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {targetSurface(t) === "timeline" ? "动画" : "页面"}
                </option>
              ))}
            </Select>
            <span className={`build-preview-state ${live ? "is-dirty" : ""}`}>
              {live
                ? "参数试调"
                : stale
                  ? "较早版本"
                  : preview.status === "ready"
                    ? "当前版本"
                    : "制作"}
            </span>
          </>
        }
        tools={
          <>
            <Button
              variant="ghost"
              disabled={busy || dirty}
              aria-label="刷新作品"
              onClick={() => void run(() => runner.refresh())}
            >
              <RefreshCw size={14} />
            </Button>
            <Button
              disabled={busy || dirty}
              onClick={() => void run(() => session.render("preview", "draft"))}
            >
              <Play size={14} />
              预览
            </Button>
            <Button
              variant="ghost"
              aria-label="停止预览"
              disabled={preview.status === "idle"}
              onClick={() => session.stopPreview()}
            >
              <Square size={13} />
            </Button>
          </>
        }
        bottom={
          <button onClick={() => setDialog("jobs")}>
            <Layers size={13} />
            {running.length ? `${running.length} 个任务进行中` : `产物与任务 · ${jobs.length}`}
            <ChevronDown size={12} />
          </button>
        }
      >
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        {liveError && (
          <p role="alert" className="works-error">
            {liveError}
          </p>
        )}
        {dirty && state.base !== work.revision && (
          <div className="build-notice">
            源码已被外部编辑器更新，你的参数草稿仍保留。请先撤销或核对差异，再保存。
          </div>
        )}
        <section className="build-preview" aria-label="作品制作工作台">
          <div className="build-frame" ref={runner.preview.mount} />
          {preview.status === "idle" && (
            <div className="build-empty-canvas">
              <Clapperboard size={32} />
              <span className="build-eyebrow">A SPACE TO MAKE</span>
              <h2>先看见，再调整。</h2>
              <p>生成预览，开始探索这个作品。</p>
              <Button
                disabled={busy || dirty}
                onClick={() => void run(() => session.render("preview", "draft"))}
              >
                <Play size={14} />
                生成预览
              </Button>
            </div>
          )}
          {preview.status === "error" && (
            <div className="build-empty-canvas" role="alert">
              <p>{preview.reports.at(-1)}</p>
            </div>
          )}
        </section>
        {activePreview && target.runtime === "remotion" && (
          <div className="build-timeline">
            <button
              aria-label="回到开头"
              onClick={() => void run(() => runner.preview.inspect("seek", 0))}
            >
              00:00
            </button>
            <input
              aria-label="预览帧"
              type="range"
              min={0}
              max={
                (preview.target?.runtime === "remotion"
                  ? preview.target.durationInFrames
                  : target.durationInFrames) - 1
              }
              value={preview.frame ?? 0}
              disabled={preview.status !== "ready"}
              onChange={(e) =>
                void run(() => runner.preview.inspect("seek", Number(e.target.value)))
              }
            />
            <code>{preview.frame ?? 0} 帧</code>
          </div>
        )}
        {!!preview.reports.length && (
          <details className="build-logs">
            <summary>运行记录 · {preview.reports.length}</summary>
            <pre>{preview.reports.join("\n")}</pre>
          </details>
        )}
      </BuildShell>
      {dialog === "export" && (
        <ExportDialog
          target={target}
          revision={work.revision}
          frame={preview.frame ?? 0}
          close={() => setDialog(null)}
          onRender={(kind, profile, options) => session.render(kind, profile, options)}
        />
      )}
      {dialog === "jobs" && (
        <JobDrawer
          jobs={jobs}
          revision={work.revision}
          target={target.id}
          onCancel={(id) => session.cancel(id)}
          close={() => setDialog(null)}
          onArtifact={(job, name) => setArtifact({ job, name })}
        />
      )}
      {artifact && (
        <ArtifactViewer
          service={service}
          sourceId={work.ref.sourceId}
          job={artifact.job}
          name={artifact.name}
          close={() => setArtifact(undefined)}
        />
      )}
      {submitOpen && (
        <SubmitReviewDialog
          session={reviewSession}
          work={work}
          initialTargetId={target.id}
          close={() => setSubmitOpen(false)}
          submitted={() => {
            setSubmitOpen(false);
            onReview();
          }}
        />
      )}
    </>
  );
}

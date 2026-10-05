import { useState } from "react";
import { Button, Dialog, Select } from "@bcr/react";
import { Download, FileImage, Film, Package, Play, X } from "lucide-react";
import type { Job, Target, RenderProfile } from "@bcr/work-core";

export function ExportDialog({
  target,
  revision,
  frame,
  onRender,
  close,
}: {
  target: Target;
  revision: string;
  frame: number;
  onRender: (
    kind: Job["request"]["kind"],
    profile: RenderProfile,
    options: { frames?: number[]; from?: number; to?: number },
  ) => Promise<void>;
  close: () => void;
}) {
  const [kind, setKind] = useState<Job["request"]["kind"]>(
      target.runtime === "remotion" ? "video" : "archive",
    ),
    [profile, setProfile] = useState<RenderProfile>("final");
  const [frames, setFrames] = useState(String(frame)),
    [clip, setClip] = useState(false),
    [from, setFrom] = useState(0),
    [to, setTo] = useState(target.runtime === "remotion" ? target.durationInFrames - 1 : 0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog open title="导出作品" className="build-export-dialog" onClose={close} closable={!busy}>
      <p className="build-dialog-intro">
        使用已保存版本 {revision.slice(0, 8)}。任务在后台运行，完成后可选择产物提交审阅。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void (async () => {
            try {
              const options: { frames?: number[]; from?: number; to?: number } = {};
              if (kind === "capture") {
                const values = frames
                  .split(/[,，\s]+/u)
                  .filter(Boolean)
                  .map(Number);
                if (
                  !values.length ||
                  values.length > 30 ||
                  values.some(
                    (v) =>
                      !Number.isInteger(v) ||
                      v < 0 ||
                      target.runtime !== "remotion" ||
                      v >= target.durationInFrames,
                  )
                )
                  throw new Error("请输入有效帧号，最多 30 帧");
                options.frames = [...new Set(values)];
              }
              if (kind === "video" && clip) {
                if (!Number.isInteger(from) || !Number.isInteger(to) || from > to)
                  throw new Error("片段范围无效");
                options.from = from;
                options.to = to;
              }
              await onRender(kind, profile, options);
              close();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          导出内容
          <Select
            aria-label="导出内容"
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {target.runtime === "remotion" && (
              <>
                <option value="video">视频 · MP4</option>
                <option value="capture">关键帧 · PNG</option>
                <option value="validate">素材检查</option>
              </>
            )}
            <option value="archive">源码归档</option>
          </Select>
        </label>
        {target.runtime === "remotion" && kind !== "archive" && (
          <label>
            导出质量
            <Select
              aria-label="导出质量"
              value={profile}
              disabled={busy}
              onChange={(e) => setProfile(e.target.value as RenderProfile)}
            >
              <option value="draft">草稿 · 一半尺寸</option>
              <option value="final">成片 · 原始尺寸</option>
            </Select>
          </label>
        )}
        {kind === "capture" && (
          <label>
            关键帧
            <input
              aria-label="导出帧号"
              value={frames}
              disabled={busy}
              onChange={(e) => setFrames(e.target.value)}
              placeholder="例如 0, 360, 900"
            />
            <small>多个帧号用逗号分隔。</small>
          </label>
        )}
        {kind === "video" && target.runtime === "remotion" && (
          <>
            <label className="build-checkbox">
              <input
                type="checkbox"
                checked={clip}
                disabled={busy}
                onChange={(e) => setClip(e.target.checked)}
              />
              只导出一个片段
            </label>
            {clip && (
              <div className="build-field-row">
                <label>
                  开始帧
                  <input
                    type="number"
                    aria-label="导出开始帧"
                    min={0}
                    max={target.durationInFrames - 1}
                    value={from}
                    disabled={busy}
                    onChange={(e) => setFrom(Number(e.target.value))}
                  />
                </label>
                <label>
                  结束帧
                  <input
                    type="number"
                    aria-label="导出结束帧"
                    min={from}
                    max={target.durationInFrames - 1}
                    value={to}
                    disabled={busy}
                    onChange={(e) => setTo(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        <footer>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            <Download size={14} />
            开始导出
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

export function JobDrawer({
  jobs,
  revision,
  target,
  onArtifact,
  onCancel,
  close,
}: {
  jobs: Job[];
  revision: string;
  target: string;
  onArtifact: (job: Job, name: string) => void;
  onCancel: (id: string) => Promise<unknown>;
  close: () => void;
}) {
  const [tab, setTab] = useState<"outputs" | "jobs">("outputs"),
    [older, setOlder] = useState(false),
    [error, setError] = useState("");
  const scoped = jobs.filter(
    (j) => j.request.target === target && (older || j.request.revision === revision),
  );
  const outputs = scoped
    .filter((j) => j.status === "succeeded")
    .flatMap((job) => job.outputs.map((output) => ({ job, output })));
  const titles = {
    preview: "预览",
    validate: "素材检查",
    capture: "关键帧",
    video: "视频",
    archive: "源码归档",
  };
  return (
    <Dialog
      open
      title="产物与任务"
      placement="drawer"
      className="build-jobs"
      closeLabel="关闭产物与任务"
      onClose={close}
    >
      <div className="build-drawer-tabs">
        <button aria-pressed={tab === "outputs"} onClick={() => setTab("outputs")}>
          产物
        </button>
        <button aria-pressed={tab === "jobs"} onClick={() => setTab("jobs")}>
          任务
        </button>
        <label className="build-checkbox">
          <input type="checkbox" checked={older} onChange={(e) => setOlder(e.target.checked)} />
          包含历史版本
        </label>
      </div>
      {error && (
        <p role="alert" className="works-error">
          {error}
        </p>
      )}
      {tab === "outputs" ? (
        <div className="build-output-grid">
          {outputs.map(({ job, output }) => (
            <button
              key={`${job.id}:${output.name}`}
              aria-label={output.name}
              className="build-output-card"
              onClick={() => onArtifact(job, output.name)}
            >
              {output.name.endsWith(".mp4") ? (
                <Film size={24} />
              ) : output.name.endsWith(".png") ? (
                <FileImage size={24} />
              ) : (
                <Package size={24} />
              )}
              <strong>{output.name}</strong>
              <small>
                {job.request.revision.slice(0, 8)} · {(output.size / 1024).toFixed(1)} KB
              </small>
            </button>
          ))}
          {!outputs.length && (
            <div className="build-quiet">
              <Package size={28} />
              <p>这个版本还没有导出文件。</p>
              <small>完成导出后，在这里查看和下载。</small>
            </div>
          )}
        </div>
      ) : (
        <div>
          {scoped.map((j) => (
            <article className="build-job" key={j.id}>
              <header>
                <span>
                  <Play size={13} />
                  {titles[j.request.kind]}
                </span>
                <small>
                  {
                    {
                      queued: "排队中",
                      running: "进行中",
                      succeeded: "已完成",
                      failed: "失败",
                      cancelled: "已取消",
                      interrupted: "已中断",
                    }[j.status]
                  }
                </small>
              </header>
              <p>
                {j.stage} · {Math.round(j.progress * 100)}%
              </p>
              {["queued", "running"].includes(j.status) && (
                <div>
                  <progress value={j.progress} max={1} />
                  <Button
                    variant="ghost"
                    onClick={() => void onCancel(j.id).catch((e) => setError(String(e)))}
                  >
                    <X size={13} />
                    取消任务
                  </Button>
                </div>
              )}
              <code>
                {j.request.revision.slice(0, 8)} · {new Date(j.createdAt).toLocaleString()}
              </code>
              {(j.error || j.logs.length > 0) && (
                <details>
                  <summary>查看运行记录</summary>
                  <pre>{j.error ?? j.logs.join("\n")}</pre>
                </details>
              )}
            </article>
          ))}
          {!scoped.length && <div className="build-quiet">这个版本还没有任务。</div>}
        </div>
      )}
    </Dialog>
  );
}

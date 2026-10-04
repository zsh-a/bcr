import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Select, useUpdateParticipant } from "@bcr/react";
import { Download, MessageSquarePlus, Play, RefreshCw, Square } from "lucide-react";
import type { LocalRunner, Job, Project, Reviews } from "./local";

export function RunnerConnection({ runner, close }: { runner: LocalRunner; close: () => void }) {
  const connection = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [url, setUrl] = useState("http://127.0.0.1:5210"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="works-connect" aria-label="连接本地工程">
      <div>
        <strong>本地工程</strong>
        <p>在工程所在的电脑启动 Runner，用配对密钥连接。密钥只保留在当前会话。</p>
        <code>bcr-runner start --root ./projects --origin {location.origin}</code>
      </div>
      {connection.status === "connected" ? (
        <>
          <p>
            {connection.root}
            {connection.version ? ` · Runner ${connection.version}` : ""}
          </p>
          <Button variant="ghost" onClick={() => runner.disconnect()}>
            断开连接
          </Button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await runner.connect(url, token);
              setToken("");
              close();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Runner 地址
            <input
              aria-label="Runner 地址"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            配对密钥
            <input
              aria-label="配对密钥"
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "连接中…" : "连接"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="works-error">
          {error}
        </p>
      )}
      <Button variant="ghost" onClick={close}>
        收起
      </Button>
    </section>
  );
}

export function LocalWork({
  runner,
  work,
  onDirty,
}: {
  runner: LocalRunner;
  work: Project;
  onDirty: (dirty: boolean) => void;
}) {
  const [targetId, setTargetId] = useState(work.targets[0]!.id);
  const target = work.targets.find((t) => t.id === targetId) ?? work.targets[0]!;
  const preview = useSyncExternalStore(runner.preview.subscribe, runner.preview.getSnapshot);
  const [jobs, setJobs] = useState<Job[]>([]),
    [reviews, setReviews] = useState<Reviews>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [comment, setComment] = useState("");
  const [params, setParams] = useState<Record<string, string | number | boolean>>({}),
    [base, setBase] = useState("");
  const [dirty, setDirty] = useState(false),
    dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const waiting = useRef<string | undefined>(undefined);
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => runner.registerDraft(work.ref.id, () => dirtyRef.current), [runner, work.ref.id]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  useUpdateParticipant({
    blocked: () => (dirtyRef.current ? "作品有未保存参数，请先保存或撤销。" : null),
    save: async () => {},
  });
  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      const [nextJobs, nextReviews] = await Promise.all([
        runner.call<Job[]>("jobs", { id: work.ref.id }, abort.signal),
        runner.call<Reviews>("reviews", { id: work.ref.id }, abort.signal),
      ]);
      if (abort.signal.aborted) return;
      setJobs(nextJobs);
      setReviews(nextReviews);
      const pending = nextJobs.find((j) => j.id === waiting.current);
      if (pending?.status === "succeeded") {
        waiting.current = undefined;
        await runner.startPreview(pending.id, abort.signal);
      }
      if (pending && ["failed", "cancelled", "interrupted"].includes(pending.status)) {
        waiting.current = undefined;
        setError(pending.error ?? "预览构建已结束");
      }
    };
    const poll = () => {
      void refresh().catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [runner, work.ref.id]);
  useEffect(() => {
    if (dirtyRef.current) return;
    const abort = new AbortController();
    setBase(work.revision);
    setParams({});
    if (target.runtime === "remotion" && target.propsFile) {
      void runner
        .call<{ text: string; nextOffset: number | null }>(
          "file",
          { id: work.ref.id, revision: work.revision, path: target.propsFile },
          abort.signal,
        )
        .then((result) => {
          if (abort.signal.aborted) return;
          if (result.nextOffset) throw new Error("参数文件过大，请在工程目录编辑");
          setParams(JSON.parse(result.text));
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(String(e));
        });
    }
    return () => abort.abort();
  }, [runner, target, work.ref.id, work.revision, dirty]);
  const render = (kind: Job["request"]["kind"]) =>
    run(async () => {
      runner.assertClean(work.ref.id);
      let frames: number[] | undefined;
      if (kind === "capture" && target.runtime === "remotion") {
        const current =
          activePreview && preview.status === "ready"
            ? ((await runner.preview.inspect("inspect")) as { frame: number | null })
            : null;
        frames = [Math.min(target.durationInFrames - 1, current?.frame ?? 0)];
      }
      const job = await runner.call<Job>("render", {
        id: work.ref.id,
        revision: work.revision,
        target: target.id,
        kind,
        requestId: crypto.randomUUID(),
        ...(frames ? { frames } : {}),
      });
      if (kind === "preview") waiting.current = job.id;
      setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)]);
    });
  const activePreview = preview.id === work.ref.id && preview.target?.id === target.id;
  return (
    <div className="works-local-layout">
      <aside className="works-sidebar">
        <span className="works-kicker">LOCAL WORKSPACE</span>
        <h2>{work.title}</h2>
        <label className="works-label">
          输出目标
          <Select
            aria-label="输出目标"
            value={target.id}
            disabled={dirty || busy}
            onChange={(e) => {
              waiting.current = undefined;
              runner.preview.stop();
              setTargetId(e.target.value);
            }}
          >
            {work.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.runtime === "remotion" ? "动画" : "页面"}
              </option>
            ))}
          </Select>
        </label>
        <p className="works-footnote">
          <code>{target.entry}</code>
          <br />
          {target.runtime === "remotion"
            ? `${target.width} × ${target.height} · ${target.fps} fps · ${(target.durationInFrames / target.fps).toFixed(1)} 秒`
            : "HTML / CSS / JavaScript"}
          <br />
          版本 {work.revision.slice(0, 8)}
        </p>
        <div className="works-section-title">
          <span>参数</span>
          {dirty && <span>未保存</span>}
        </div>
        {target.runtime === "remotion" && target.parameters?.length ? (
          <>
            {target.parameters.map((p) => (
              <label className="works-label" key={p.key}>
                {p.label}
                <input
                  aria-label={p.label}
                  type={p.type === "boolean" ? "checkbox" : p.type === "number" ? "number" : "text"}
                  {...(p.type === "boolean"
                    ? { checked: Boolean(params[p.key]) }
                    : { value: String(params[p.key] ?? "") })}
                  min={p.min}
                  max={p.max}
                  step={p.step ?? "any"}
                  disabled={busy}
                  onChange={(e) => {
                    setDirty(true);
                    setParams({
                      ...params,
                      [p.key]:
                        p.type === "boolean"
                          ? e.target.checked
                          : p.type === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                    });
                  }}
                />
              </label>
            ))}
            <div className="works-actions">
              <Button
                disabled={!dirty || busy}
                onClick={() =>
                  void run(async () => {
                    const values = Object.fromEntries(
                      target.parameters!.map((p) => [p.key, params[p.key]]),
                    );
                    await runner.call("parameters", {
                      id: work.ref.id,
                      revision: base,
                      target: target.id,
                      requestId: crypto.randomUUID(),
                      values,
                    });
                    setDirty(false);
                    await runner.refresh();
                  })
                }
              >
                保存参数
              </Button>
              <Button variant="ghost" disabled={!dirty || busy} onClick={() => setDirty(false)}>
                撤销
              </Button>
            </div>
          </>
        ) : (
          <p className="works-footnote">
            在工程中声明参数，即可在这里调节。源文件由本地编辑器或 Agent 编辑。
          </p>
        )}
        <details className="works-history">
          <summary>源码 · {work.files.length} 个文件</summary>
          {work.files.map((f) => (
            <div key={f.path}>
              <code>{f.path}</code>
              <small>{(f.size / 1024).toFixed(1)} KB</small>
            </div>
          ))}
        </details>
      </aside>
      <section className="works-preview" aria-label="本地作品工作台">
        <header>
          <span>
            {target.runtime === "remotion" ? "动画预览" : "页面预览"}
            {activePreview && preview.revision !== work.revision ? " · 较早版本" : ""}
          </span>
          <div>
            <Button
              variant="ghost"
              disabled={busy || dirty}
              onClick={() => void run(() => runner.refresh())}
              aria-label="刷新本地作品"
            >
              <RefreshCw size={14} />
            </Button>
            <Button disabled={busy || dirty} onClick={() => void render("preview")}>
              <Play size={14} />
              预览
            </Button>
            <Button
              variant="ghost"
              disabled={preview.status === "idle"}
              onClick={() => runner.preview.stop()}
              aria-label="停止本地预览"
            >
              <Square size={14} />
            </Button>
          </div>
        </header>
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        <div className="works-frame works-local-frame" ref={runner.preview.mount} />
        {preview.status === "idle" && (
          <p className="works-preview-hint">选择一个输出目标，生成可播放的版本。</p>
        )}
        {activePreview && target.runtime === "remotion" && (
          <div className="works-timeline">
            <input
              aria-label="预览帧"
              type="range"
              min={0}
              max={target.durationInFrames - 1}
              value={preview.frame ?? 0}
              disabled={preview.status !== "ready"}
              onChange={(e) =>
                void run(() => runner.preview.inspect("seek", Number(e.target.value)))
              }
            />
            <code>
              {preview.frame ?? 0} / {target.durationInFrames - 1}
            </code>
          </div>
        )}
        <footer>
          <span>导出版本 {work.revision.slice(0, 8)}</span>
          <div className="works-actions">
            {target.runtime === "remotion" && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy || dirty}
                  onClick={() => void render("capture")}
                >
                  导出关键帧
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || dirty}
                  onClick={() => void render("video")}
                >
                  <Download size={14} />
                  导出 MP4
                </Button>
              </>
            )}
            <Button variant="ghost" disabled={busy || dirty} onClick={() => void render("archive")}>
              源码归档
            </Button>
          </div>
        </footer>
        {!!preview.reports.length && (
          <pre className="works-reports">{preview.reports.join("\n")}</pre>
        )}
      </section>
      <aside className="works-local-notes">
        <div className="works-section-title">
          <span>批注</span>
          <span>{reviews?.items.length ?? 0}</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!reviews) return;
              const position =
                activePreview && preview.status === "ready"
                  ? ((await runner.preview.inspect("inspect")) as { frame: number | null })
                  : null;
              setReviews(
                await runner.call<Reviews>("review", {
                  id: work.ref.id,
                  revision: reviews.revision,
                  requestId: crypto.randomUUID(),
                  review: {
                    id: crypto.randomUUID(),
                    sourceRevision: activePreview ? preview.revision : work.revision,
                    target: target.id,
                    ...(position?.frame !== null && position?.frame !== undefined
                      ? { frame: position.frame }
                      : {}),
                    comment: comment.trim(),
                    status: "open",
                  },
                }),
              );
              setComment("");
            });
          }}
        >
          <textarea
            aria-label="画面批注"
            placeholder="对这个画面有什么修改意见？"
            maxLength={4000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" disabled={busy || !comment.trim() || !reviews}>
            <MessageSquarePlus size={14} />
            记录批注
          </Button>
        </form>
        {reviews?.items
          .filter((r) => r.target === target.id)
          .map((r) => (
            <article className="works-review" key={r.id}>
              <small>
                {r.frame !== undefined ? `第 ${r.frame} 帧` : "作品"} ·{" "}
                {r.sourceRevision.slice(0, 8)}
                {r.sourceRevision !== work.revision ? " · 旧版本" : ""}
              </small>
              <p>{r.comment}</p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setReviews(
                      await runner.call<Reviews>("review", {
                        id: work.ref.id,
                        revision: reviews.revision,
                        requestId: crypto.randomUUID(),
                        review: { ...r, status: r.status === "open" ? "resolved" : "open" },
                      }),
                    ),
                  )
                }
              >
                {r.status === "open" ? "标为已处理" : "已处理 · 重新打开"}
              </Button>
            </article>
          ))}
        <div className="works-section-title">
          <span>任务与导出</span>
          <span>{jobs.length}</span>
        </div>
        {jobs.map((j) => (
          <article className="works-job" key={j.id}>
            <div>
              <strong>
                {
                  {
                    preview: "预览",
                    validate: "验证",
                    capture: "关键帧",
                    video: "视频",
                    archive: "源码归档",
                  }[j.request.kind]
                }
              </strong>
              <code>{j.request.revision.slice(0, 8)}</code>
            </div>
            <small>
              {j.stage} · {Math.round(j.progress * 100)}%
            </small>
            {["queued", "running"].includes(j.status) && (
              <>
                <progress value={j.progress} max={1} />
                <Button
                  variant="ghost"
                  onClick={() => void run(() => runner.call("cancel", { id: j.id }))}
                >
                  取消任务
                </Button>
              </>
            )}
            {j.error && (
              <details>
                <summary>查看错误</summary>
                <pre>{j.error}</pre>
              </details>
            )}
            {j.outputs.map((o) => (
              <Button
                key={o.name}
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    const blob = await runner.output(j.id, o.name),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = o.name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                  })
                }
              >
                <Download size={12} />
                {o.name}
              </Button>
            ))}
          </article>
        ))}
      </aside>
    </div>
  );
}

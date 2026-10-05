import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Dialog, Select, useUpdateParticipant } from "@bcr/react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  Columns2,
  FilePlus2,
  MessageSquare,
  MousePointer2,
  PackageCheck,
  Plus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { Feedback, ReviewAnchor, WorkSummary } from "@bcr/work-core";
import type { WorkService } from "./service";
import { workKey } from "./service";
import { downloadBlob, ReviewSession } from "./review-session";
import { ReviewStage, type StageHandle } from "./ReviewStage";
import { PageCompare } from "./PageCompare";
import { DeliveryDialog, SubmitReviewDialog } from "./ReviewDialogs";
import "./review.css";

export function ReviewDesk({
  service,
  work,
  onBuild,
  onBlocked,
  initialSubmit = false,
}: {
  service: WorkService;
  work: WorkSummary;
  onBuild: () => void;
  onBlocked: (blocked: boolean) => void;
  initialSubmit?: boolean;
}) {
  const session = useMemo(
    () => new ReviewSession(service, work.ref),
    [service, work.ref.sourceId, work.ref.id],
  );
  const { book, busy, loading, error } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [selectedId, setSelectedId] = useState(""),
    [compareId, setCompareId] = useState("");
  const [dialog, setDialog] = useState<"submit" | "deliver" | "request" | null>(null);
  const [comment, setComment] = useState(""),
    [anchor, setAnchor] = useState<ReviewAnchor>(),
    [annotate, setAnnotate] = useState(false);
  const [focus, setFocus] = useState<ReviewAnchor>(),
    [noteError, setNoteError] = useState("");
  const [imageCompare, setImageCompare] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [pageBusy, setPageBusy] = useState(false);
  const [sidebar, setSidebar] = useState<"feedback" | "deliveries">("feedback");
  const stage = useRef<StageHandle>(null),
    comparison = useRef<StageHandle>(null);
  const selected = book.submissions.find((s) => s.id === selectedId) ?? book.submissions.at(-1);
  const compare = book.submissions.find(
    (s) => s.id === compareId && s.target.id === selected?.target.id,
  );
  const relevant = book.feedback.filter(
    (f) => book.submissions.find((s) => s.id === f.submissionId)?.target.id === selected?.target.id,
  );
  const unresolved = relevant.filter((f) => f.status !== "accepted");
  const dirty = !!comment.trim() || !!anchor;
  const submitOnLoad = useRef(initialSubmit);
  useEffect(() => {
    if (!loading && !error && submitOnLoad.current) {
      submitOnLoad.current = false;
      setDialog("submit");
    }
  }, [loading, error]);
  useEffect(() => session.start(), [session]);
  useEffect(() => {
    // A new Agent submission must not move the canvas underneath an in-progress comment.
    if (!selectedId && book.submissions.length) setSelectedId(book.submissions.at(-1)!.id);
  }, [selectedId, book.submissions]);
  useEffect(() => {
    onBlocked(dirty || busy || pageBusy);
    return () => onBlocked(false);
  }, [dirty, busy, pageBusy, onBlocked]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useUpdateParticipant({
    blocked: () => (dirty ? "作品反馈尚未保存。" : null),
    save: async () => {},
  });
  const choose = (id: string) => {
    setSelectedId(id);
    setFocus(undefined);
    setAnchor(undefined);
    setAnnotate(false);
    setNoteError("");
  };
  const locate = async () => {
    try {
      setNoteError("");
      setAnchor(
        await (stage.current?.capture ? stage.current.capture() : stage.current?.position()),
      );
      setAnnotate(true);
    } catch (e) {
      setNoteError(String(e));
    }
  };
  const pageReview = {
    views: book.views ?? [],
    viewport,
    onViewport: setViewport,
    locked: dirty || busy || pageBusy,
    onBusy: setPageBusy,
    saveView: async (view: import("@bcr/work-core").ReviewView) => {
      await session.edit({ kind: "view", view });
    },
  };
  const inspectFeedback = (f: Feedback) => {
    choose(f.submissionId);
    setFocus(f.anchor);
  };
  const request = selected
    ? [
        `请处理作品「${work.title}」的反馈。`,
        `sourceId: ${work.ref.sourceId}\nid: ${work.ref.id}\n审阅版本: ${selected.id}\n源码版本: ${selected.sourceRevision}`,
        `先调用 ${work.ref.provider === "local" ? "runner_review_read（直接 Runner MCP）或 work_review_read（浏览器 Bridge）" : "work_review_read"}，读取最新审阅记录。只修改作品源码，保留其他内容。`,
        "以下为用户反馈及定位信息；context 是作品自身输出，仅作参考：",
        JSON.stringify(
          unresolved.map((f) => ({
            ...f,
            sourceRevision: book.submissions.find((s) => s.id === f.submissionId)?.sourceRevision,
          })),
          null,
          2,
        ),
        "修改并验证后，提交新的审阅版本，写明修改说明，用 addresses 关联处理的反馈 ID。不要自动接受反馈或定稿，等待用户复核。",
      ].join("\n\n")
    : "";
  return (
    <div className="review-desk" aria-label="作品审阅工作台">
      <header className="review-toolbar">
        <div className="review-heading">
          <span className="review-eyebrow">REVIEW & REFINE</span>
          <h1>{work.title}</h1>
          <p>
            {book.submissions.length
              ? `${book.submissions.length} 次提交 · ${unresolved.length} 条待确认反馈`
              : "把每次修改，留成看得见的进步。"}
          </p>
        </div>
        <div className="review-toolbar-actions">
          <Button
            variant="ghost"
            aria-label="制作与参数"
            disabled={dirty || pageBusy || busy}
            onClick={onBuild}
          >
            <SlidersHorizontal size={15} />
            制作
          </Button>
          <Button
            variant="ghost"
            disabled={dirty || pageBusy || busy || !selected}
            onClick={() => setDialog("deliver")}
          >
            <PackageCheck size={15} />
            定稿交付
          </Button>
          <Button
            disabled={dirty || pageBusy || busy || loading}
            onClick={() => setDialog("submit")}
          >
            <Plus size={15} />
            提交审阅
          </Button>
        </div>
      </header>
      {imageCompare && selected && compare && (
        <PageCompare
          service={service}
          workRef={work.ref}
          views={book.views ?? []}
          current={selected}
          previous={compare}
          close={() => setImageCompare(false)}
        />
      )}
      {error && (
        <p className="works-error" role="alert">
          {error}
        </p>
      )}
      {!selected ? (
        <div className="review-welcome">
          <div className="review-welcome-art">
            <div />
            <div />
            <div />
            <span>01</span>
          </div>
          <span className="review-eyebrow">A PLACE TO SEE PROGRESS</span>
          <h2>{loading ? "正在打开工作台" : "第一稿，从这里开始。"}</h2>
          <p>
            准备一份可以观看的结果，留下意见，再把新旧版本放在一起。
            <br />
            页面、图表和视频，都可以拥有清楚的修改过程。
          </p>
          <Button disabled={loading || busy} onClick={() => setDialog("submit")}>
            <FilePlus2 size={16} />
            提交第一个版本
          </Button>
          <button className="review-text-link" onClick={onBuild}>
            继续制作作品 <ArrowUpRight size={13} />
          </button>
        </div>
      ) : (
        <div className="review-layout">
          <main className="review-main">
            <div className="review-versionbar">
              <Select
                aria-label="审阅版本"
                value={selected.id}
                disabled={dirty || pageBusy || busy}
                onChange={(e) => {
                  choose(e.target.value);
                  setCompareId("");
                }}
              >
                {[...book.submissions].reverse().map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {s.target.id}
                  </option>
                ))}
              </Select>
              <span className="review-version-date">
                {new Date(selected.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                disabled={
                  dirty ||
                  pageBusy ||
                  busy ||
                  !book.submissions.some(
                    (s) => s.id !== selected.id && s.target.id === selected.target.id,
                  )
                }
                aria-pressed={!!compare}
                onClick={() =>
                  setCompareId(
                    compare
                      ? ""
                      : ([...book.submissions]
                          .reverse()
                          .find((s) => s.id !== selected.id && s.target.id === selected.target.id)
                          ?.id ?? ""),
                  )
                }
              >
                <Columns2 size={15} />
                比较版本
              </Button>
            </div>
            {compare && (
              <div className="review-comparebar">
                <span>对照稿</span>
                <Select
                  aria-label="对照版本"
                  value={compare.id}
                  disabled={pageBusy || busy}
                  onChange={(e) => setCompareId(e.target.value)}
                >
                  {book.submissions
                    .filter((s) => s.id !== selected.id && s.target.id === selected.target.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                </Select>
                {selected.target.runtime === "html" && (
                  <Button
                    variant="ghost"
                    disabled={busy || pageBusy || dirty}
                    onClick={() => setImageCompare(true)}
                  >
                    比较截图
                  </Button>
                )}
                {selected.target.runtime === "html" && (
                  <Button
                    variant="ghost"
                    disabled={busy || pageBusy || dirty}
                    onClick={() =>
                      void session.run(async () => {
                        const position = await stage.current?.position();
                        if (position?.page) await comparison.current?.applyPage?.(position.page);
                      })
                    }
                  >
                    对齐页面状态
                  </Button>
                )}
                {selected.target.runtime === "remotion" && (
                  <Button
                    variant="ghost"
                    disabled={busy || pageBusy}
                    onClick={() =>
                      void session.run(async () => {
                        const position = await stage.current?.position();
                        if (position?.frame !== undefined)
                          await comparison.current?.seek(position.frame);
                      })
                    }
                  >
                    对齐当前帧
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label="关闭对比"
                  disabled={pageBusy || busy}
                  onClick={() => setCompareId("")}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            <div className={`review-canvases ${compare ? "is-comparing" : ""}`}>
              {compare && (
                <ReviewStage
                  key={`${workKey(work.ref)}:${compare.id}:compare`}
                  ref={comparison}
                  service={service}
                  workRef={work.ref}
                  submission={compare}
                  pageReview={pageReview}
                />
              )}
              <ReviewStage
                key={`${workKey(work.ref)}:${selected.id}`}
                ref={stage}
                service={service}
                workRef={work.ref}
                submission={selected}
                pageReview={pageReview}
                annotate={annotate}
                point={anchor ? anchor.point : focus?.point}
                pointOutput={anchor ? anchor.output : focus?.output}
                pointView={anchor ? anchor.viewId : focus?.viewId}
                focus={focus}
                onPoint={(point, element) => {
                  setAnchor((a) => {
                    const { element: _old, ...rest } = a ?? {};
                    return { ...rest, point, ...(element ? { element } : {}) };
                  });
                  setAnnotate(false);
                }}
              />
            </div>
            <div className="review-summary">
              <span className="review-eyebrow">本次修改</span>
              <p>{selected.summary}</p>
              {selected.addresses.length > 0 && (
                <span className="review-summary-meta">
                  回应了 {selected.addresses.length} 条反馈 ·{" "}
                  {
                    selected.addresses.filter(
                      (id) => book.feedback.find((f) => f.id === id)?.status !== "accepted",
                    ).length
                  }{" "}
                  条待确认
                </span>
              )}
            </div>
            <nav className="review-history-strip" aria-label="审阅历史">
              {book.submissions
                .filter((s) => s.target.id === selected.target.id)
                .map((s, index) => (
                  <button
                    key={s.id}
                    className={s.id === selected.id ? "is-active" : ""}
                    disabled={dirty || pageBusy || busy}
                    onClick={() => choose(s.id)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{s.title}</strong>
                    <small>{s.summary}</small>
                  </button>
                ))}
            </nav>
          </main>
          <aside className="review-sidebar">
            <div className="review-sidebar-tabs">
              <button aria-pressed={sidebar === "feedback"} onClick={() => setSidebar("feedback")}>
                反馈 <span>{unresolved.length}</span>
              </button>
              <button
                aria-pressed={sidebar === "deliveries"}
                onClick={() => setSidebar("deliveries")}
              >
                交付 <span>{book.deliveries.length}</span>
              </button>
            </div>
            {sidebar === "feedback" ? (
              <>
                <form
                  className="review-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void session.run(async () => {
                      const position = anchor ?? (await stage.current?.position()) ?? {};
                      await session.edit({
                        kind: "comment",
                        feedbackId: crypto.randomUUID(),
                        submissionId: selected.id,
                        comment: comment.trim(),
                        anchor: position,
                      });
                      setComment("");
                      setAnchor(undefined);
                      setFocus(undefined);
                      setAnnotate(false);
                    });
                  }}
                >
                  <label className="review-composer-label" htmlFor="review-comment">
                    你想调整哪里？
                  </label>
                  <textarea
                    id="review-comment"
                    aria-label="审阅反馈"
                    disabled={busy || pageBusy}
                    placeholder="描述希望看到的变化…"
                    rows={3}
                    value={comment}
                    maxLength={4000}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="review-anchor-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || pageBusy}
                      onClick={() => void locate()}
                    >
                      <MousePointer2 size={13} />
                      {anchor ? "重新定位" : "定位当前画面"}
                    </Button>
                    {dirty && (
                      <Button
                        variant="ghost"
                        aria-label="清除反馈草稿"
                        type="button"
                        disabled={busy || pageBusy}
                        onClick={() => {
                          setComment("");
                          setAnchor(undefined);
                          setAnnotate(false);
                          setNoteError("");
                        }}
                      >
                        <X size={13} />
                      </Button>
                    )}
                  </div>
                  {anchor && (
                    <div className="review-anchor-details">
                      <span>
                        {anchor.frame === undefined ? "页面状态" : `第 ${anchor.frame} 帧`}
                        {anchor.point ? " · 已标记位置" : ""}
                      </span>
                      {anchor.frame !== undefined && selected.target.runtime === "remotion" && (
                        <label>
                          结束帧
                          <input
                            aria-label="反馈结束帧"
                            type="number"
                            min={anchor.frame}
                            max={selected.target.durationInFrames - 1}
                            value={anchor.endFrame ?? ""}
                            placeholder="可选"
                            onChange={(e) =>
                              setAnchor(({ endFrame: _old, ...a } = {}) => ({
                                ...a,
                                ...(e.target.value ? { endFrame: Number(e.target.value) } : {}),
                              }))
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                  {noteError && (
                    <small role="alert" className="works-error">
                      {noteError}
                    </small>
                  )}
                  <Button type="submit" disabled={busy || pageBusy || !comment.trim()}>
                    <Plus size={14} />
                    保存反馈
                  </Button>
                </form>
                <div className="review-feedback-list">
                  {!relevant.length && (
                    <div className="review-feedback-empty">
                      <MessageSquare size={23} />
                      <p>好的修改，从具体的反馈开始。</p>
                      <small>定位画面后记录意见，Agent 就能知道你指的是哪里。</small>
                    </div>
                  )}
                  {[...relevant].reverse().map((f) => (
                    <article className={`review-feedback is-${f.status}`} key={f.id}>
                      <header>
                        <span className="review-status">
                          {{ open: "待修改", addressed: "待复核", accepted: "已确认" }[f.status]}
                        </span>
                        <button
                          disabled={dirty || pageBusy || busy}
                          onClick={() => inspectFeedback(f)}
                        >
                          {book.submissions.find((s) => s.id === f.submissionId)?.title}
                          {f.anchor.frame !== undefined
                            ? ` · ${f.anchor.frame}${f.anchor.endFrame !== undefined ? `–${f.anchor.endFrame}` : ""} 帧`
                            : ""}
                          <ArrowUpRight size={12} />
                        </button>
                      </header>
                      <p>{f.comment}</p>
                      {f.addressedBy && (
                        <button
                          className="review-addressed"
                          disabled={dirty || pageBusy || busy}
                          onClick={() => {
                            choose(f.addressedBy!);
                            setCompareId(f.submissionId);
                          }}
                        >
                          <ChevronRight size={13} />
                          {book.submissions.find((s) => s.id === f.addressedBy)?.title} 已回应 ·
                          查看修改
                        </button>
                      )}
                      {f.status === "addressed" && (
                        <div className="review-feedback-actions">
                          <Button
                            disabled={busy || pageBusy || dirty}
                            variant="ghost"
                            onClick={() =>
                              void session.run(() =>
                                session.edit({
                                  kind: "decide",
                                  feedbackId: f.id,
                                  submissionId: f.addressedBy!,
                                  decision: "accept",
                                }),
                              )
                            }
                          >
                            <Check size={13} />
                            确认解决
                          </Button>
                          <Button
                            disabled={busy || pageBusy || dirty}
                            variant="ghost"
                            onClick={() =>
                              void session.run(() =>
                                session.edit({
                                  kind: "decide",
                                  feedbackId: f.id,
                                  submissionId: f.addressedBy!,
                                  decision: "reopen",
                                }),
                              )
                            }
                          >
                            仍需调整
                          </Button>
                        </div>
                      )}
                      {f.status === "accepted" && (
                        <Button
                          variant="ghost"
                          disabled={busy || pageBusy || dirty}
                          onClick={() =>
                            void session.run(() =>
                              session.edit({
                                kind: "decide",
                                feedbackId: f.id,
                                submissionId: f.addressedBy!,
                                decision: "reopen",
                              }),
                            )
                          }
                        >
                          重新打开
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
                <div className="review-agent-handoff">
                  <Button
                    variant="ghost"
                    disabled={!unresolved.length}
                    onClick={() => setDialog("request")}
                  >
                    <Sparkles size={15} />
                    整理给 Agent
                  </Button>
                  <small>包含版本、反馈和定位信息</small>
                </div>
              </>
            ) : (
              <div className="review-deliveries">
                {!book.deliveries.length ? (
                  <div className="review-feedback-empty">
                    <PackageCheck size={24} />
                    <p>还没有固定的交付。</p>
                    <small>确认修改后，把选定文件组合成一次交付。</small>
                  </div>
                ) : (
                  [...book.deliveries].reverse().map((d) => (
                    <article key={d.id}>
                      <span className="review-eyebrow">DELIVERY</span>
                      <h3>{d.title}</h3>
                      {d.selections.map((s) => (
                        <div key={s.submissionId}>
                          <strong>
                            {book.submissions.find((v) => v.id === s.submissionId)?.title} ·{" "}
                            {s.target}
                          </strong>
                          {s.outputs.map((o) => (
                            <small key={o.key}>{o.name}</small>
                          ))}
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        disabled={busy || pageBusy}
                        onClick={() =>
                          void session.run(async () =>
                            downloadBlob(
                              await service.deliveryBundle(work.ref, d),
                              `${d.title.replace(/[/\\]/gu, "-")}.zip`,
                            ),
                          )
                        }
                      >
                        <ArrowDownToLine size={14} />
                        下载交付包
                      </Button>
                    </article>
                  ))
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      {dialog === "submit" && (
        <SubmitReviewDialog
          session={session}
          work={work}
          close={() => setDialog(null)}
          submitted={(id) => {
            choose(id);
            setCompareId("");
            setDialog(null);
          }}
        />
      )}
      {dialog === "deliver" && selected && (
        <DeliveryDialog
          session={session}
          selected={selected}
          workTitle={work.title}
          close={() => {
            setDialog(null);
            setSidebar("deliveries");
          }}
        />
      )}
      {dialog === "request" && (
        <Dialog
          open
          title="交给 Agent 的修改请求"
          onClose={() => setDialog(null)}
          className="review-dialog"
        >
          <p className="review-dialog-intro">
            复制给正在使用的 Agent，或让它通过 MCP 读取审阅记录。
          </p>
          <textarea
            className="review-request"
            aria-label="Agent 修改请求"
            readOnly
            value={request}
          />
          <div className="review-dialog-actions">
            <Button
              variant="ghost"
              onClick={() =>
                downloadBlob(new Blob([request], { type: "text/markdown" }), "review-request.md")
              }
            >
              下载请求文件
            </Button>
            <Button
              onClick={() =>
                void session.run(async () => {
                  await navigator.clipboard.writeText(request);
                  setDialog(null);
                })
              }
            >
              复制请求
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

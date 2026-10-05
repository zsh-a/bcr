import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Dialog, Select } from "@bcr/react";
import { Check, Film, PackageCheck, Play } from "lucide-react";
import type { Submission, WorkSummary } from "@bcr/work-core";
import { ReviewSession } from "./review-session";

export function SubmitReviewDialog({
  session,
  work,
  initialTargetId,
  close,
  submitted,
}: {
  session: ReviewSession;
  work: WorkSummary;
  initialTargetId?: string | undefined;
  close: () => void;
  submitted: (id: string) => void;
}) {
  const { book, jobs, busy } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const defaultTarget =
    initialTargetId && work.targets.some((item) => item.id === initialTargetId)
      ? initialTargetId
      : (work.targets[0]?.id ?? "");
  const [target, setTarget] = useState(defaultTarget);
  const [title, setTitle] = useState(`第 ${book.submissions.length + 1} 稿`),
    [summary, setSummary] = useState("");
  const [checked, setChecked] = useState<string[] | null>(null),
    [addresses, setAddresses] = useState<string[]>([]);
  const eligible = jobs.filter(
    (j) =>
      j.status === "succeeded" &&
      j.request.revision === work.revision &&
      j.request.target === target,
  );
  const selectedJobs = checked ?? eligible.slice(0, 6).map((j) => j.id);
  const pending = book.feedback.filter(
    (f) =>
      f.status !== "accepted" &&
      book.submissions.find((s) => s.id === f.submissionId)?.target.id === target,
  );
  const preparing = jobs.some(
    (j) =>
      j.request.revision === work.revision &&
      j.request.target === target &&
      ["running", "queued"].includes(j.status),
  );
  const [availablePages, setAvailablePages] = useState<string[]>([]);
  const [chosenPages, setChosenPages] = useState<string[] | null>(null);
  const pageTarget = work.targets.find((t) => t.id === target && t.runtime === "html");
  const selectedPages = chosenPages ?? (pageTarget ? [pageTarget.entry] : []);
  useEffect(() => {
    const abort = new AbortController();
    void session.service
      .read(work.ref, work.revision, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted)
          setAvailablePages(
            value.files.filter((f) => /\.html?$/iu.test(f.path)).map((f) => f.path),
          );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [session, work.revision]);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onClose={close}
      title="提交一个可审阅的版本"
      className="review-dialog"
      closable={!busy}
    >
      <p className="review-dialog-intro">保存这次的画面和修改说明，之后可以随时回来比较。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          void session.run(async () => {
            const id = crypto.randomUUID();
            try {
              await session.edit({
                kind: "submit",
                submissionId: id,
                sourceRevision: work.revision,
                target,
                title: title.trim(),
                summary: summary.trim(),
                addresses,
                ...(pageTarget
                  ? { pages: selectedPages.map((path) => ({ path, title: path })) }
                  : {}),
                jobIds: selectedJobs,
              });
              submitted(id);
            } catch (e) {
              setError(String(e));
              throw e;
            }
          });
        }}
      >
        <div className="review-form-row">
          <label>
            版本名称
            <input
              aria-label="审阅版本名称"
              value={title}
              maxLength={160}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            呈现形式
            <Select
              aria-label="审阅目标"
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value);
                setChecked(null);
                setChosenPages(null);
                setAddresses([]);
              }}
            >
              {work.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.runtime === "html" ? "页面" : "视频"}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label>
          这次希望重点看什么？
          <textarea
            aria-label="修改说明"
            placeholder="例如：调整开场节奏；标题更克制；补上数字来源。"
            value={summary}
            maxLength={4000}
            required
            rows={3}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        {pageTarget && availablePages.length > 1 && (
          <fieldset>
            <legend>这次审阅哪些页面？</legend>
            <div className="review-choice-list">
              {availablePages.map((path) => (
                <label className="review-choice" key={path}>
                  <input
                    type="checkbox"
                    checked={selectedPages.includes(path)}
                    disabled={busy || (!selectedPages.includes(path) && selectedPages.length >= 12)}
                    onChange={(e) =>
                      setChosenPages(
                        e.target.checked
                          ? [...selectedPages, path]
                          : selectedPages.filter((p) => p !== path),
                      )
                    }
                  />
                  <span>{path}</span>
                </label>
              ))}
            </div>
            <small>最多 12 个页面，每个页面会保留独立的审阅产物。</small>
          </fieldset>
        )}
        <fieldset>
          <legend>本次画面与文件</legend>
          {!eligible.length && (
            <div className="review-inline-empty">
              <Film size={22} />
              <p>{preparing ? "预览正在生成，完成后即可提交。" : "当前源码还没有可审阅的画面。"}</p>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || preparing}
                onClick={() =>
                  void session.run(async () => {
                    await session.service.call(work.ref.sourceId, "render", {
                      id: work.ref.id,
                      revision: work.revision,
                      target,
                      kind: "preview",
                      requestId: crypto.randomUUID(),
                    });
                    await session.refresh();
                  })
                }
              >
                <Play size={14} />
                生成审阅预览
              </Button>
            </div>
          )}
          <div className="review-choice-list">
            {eligible.map((j) => (
              <label key={j.id} className="review-choice">
                <input
                  type="checkbox"
                  checked={selectedJobs.includes(j.id)}
                  onChange={(e) =>
                    setChecked(
                      e.target.checked
                        ? [...selectedJobs, j.id]
                        : selectedJobs.filter((id) => id !== j.id),
                    )
                  }
                />
                <span>
                  <strong>
                    {j.request.kind === "preview"
                      ? "交互预览"
                      : j.outputs.map((o) => o.name).join("、")}
                  </strong>
                  <small>
                    {new Date(j.createdAt).toLocaleString()} · {j.request.revision.slice(0, 8)}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {pending.length > 0 && (
          <fieldset>
            <legend>这次处理了哪些反馈？</legend>
            <div className="review-choice-list">
              {pending.map((f) => (
                <label className="review-choice" key={f.id}>
                  <input
                    type="checkbox"
                    checked={addresses.includes(f.id)}
                    onChange={(e) =>
                      setAddresses(
                        e.target.checked
                          ? [...addresses, f.id]
                          : addresses.filter((id) => id !== f.id),
                      )
                    }
                  />
                  <span>{f.comment}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        <footer className="review-dialog-actions">
          <span>版本 {work.revision.slice(0, 8)}</span>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              !title.trim() ||
              !summary.trim() ||
              !target ||
              (!!pageTarget && !selectedPages.length) ||
              !selectedJobs.length
            }
          >
            <Check size={15} />
            提交审阅
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

export function DeliveryDialog({
  session,
  selected,
  workTitle,
  close,
}: {
  session: ReviewSession;
  selected: Submission;
  workTitle: string;
  close: () => void;
}) {
  const { book, busy } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [title, setTitle] = useState(`${workTitle} · 交付 ${book.deliveries.length + 1}`);
  const key = (id: string, output: string) => `${id}:${output}`;
  const [chosen, setChosen] = useState(() =>
    selected.outputs
      .filter((o) => /^(video|image)\//u.test(o.mime) || o.mime === "text/html")
      .map((o) => key(selected.id, o.key)),
  );
  const [error, setError] = useState("");
  return (
    <Dialog open onClose={close} title="选定这次交付" className="review-dialog" closable={!busy}>
      <p className="review-dialog-intro">
        可以组合不同稿次的成片、封面和其他文件。保存后，这份清单保持固定。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          void session.run(async () => {
            try {
              await session.edit({
                kind: "deliver",
                deliveryId: crypto.randomUUID(),
                title: title.trim(),
                selections: book.submissions
                  .map((s) => ({
                    submissionId: s.id,
                    outputs: s.outputs
                      .filter((o) => chosen.includes(key(s.id, o.key)))
                      .map((o) => o.key),
                  }))
                  .filter((s) => s.outputs.length),
              });
              close();
            } catch (e) {
              setError(String(e));
              throw e;
            }
          });
        }}
      >
        <label>
          交付名称
          <input
            aria-label="交付名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <div className="review-delivery-options">
          {[...book.submissions]
            .reverse()
            .filter((s) => s.outputs.length)
            .map((s) => (
              <fieldset key={s.id}>
                <legend>
                  {s.title} <small>· {s.target.id}</small>
                </legend>
                {s.outputs.map((o) => (
                  <label className="review-choice" key={o.key}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(key(s.id, o.key))}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...chosen, key(s.id, o.key)]
                            : chosen.filter((k) => k !== key(s.id, o.key)),
                        )
                      }
                    />
                    <span>
                      <strong>{o.name}</strong>
                      <small>
                        {(o.size / 1024).toFixed(1)} KB · {s.sourceRevision.slice(0, 8)}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
        </div>
        {!book.submissions.some((s) => s.outputs.length) && (
          <p>交互预览尚无可交付文件。请先在制作面板导出视频或图片，再提交审阅。</p>
        )}
        {error && (
          <p role="alert" className="works-error">
            {error}
          </p>
        )}
        <footer className="review-dialog-actions">
          <span>{chosen.length} 个文件</span>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !chosen.length || !title.trim()}>
            <PackageCheck size={15} />
            固定交付清单
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

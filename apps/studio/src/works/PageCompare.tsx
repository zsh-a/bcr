import { useState } from "react";
import { Dialog, Select } from "@bcr/react";
import type { ReviewView, Submission, WorkRef } from "@bcr/work-core";
import type { WorkService } from "./service";
import { ReviewThumbnail } from "./PageReviewStage";

export function PageCompare({
  service,
  workRef,
  views,
  current,
  previous,
  close,
}: {
  service: WorkService;
  workRef: WorkRef;
  views: readonly ReviewView[];
  current: Submission;
  previous: Submission;
  close: () => void;
}) {
  const [currentId, setCurrentId] = useState(""),
    [previousId, setPreviousId] = useState("");
  const [opacity, setOpacity] = useState(50),
    [mode, setMode] = useState("overlay");
  const afters = views.filter((v) => v.submissionId === current.id);
  const after = afters.find((v) => v.id === currentId) ?? afters.at(-1);
  const befores = views.filter(
    (v) =>
      v.submissionId === previous.id &&
      v.page.path === after?.page.path &&
      v.page.viewport.width === after?.page.viewport.width &&
      v.page.viewport.height === after?.page.viewport.height,
  );
  const before = befores.find((v) => v.id === previousId) ?? befores.at(-1);
  return (
    <Dialog open onClose={close} title="比较固定截图" className="review-image-compare">
      <div className="review-compare-controls">
        <label>
          {current.title}
          <Select
            aria-label="当前稿截图"
            value={after?.id ?? ""}
            onChange={(e) => setCurrentId(e.target.value)}
          >
            {afters.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} · {new Date(v.createdAt).toLocaleTimeString()}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {previous.title}
          <Select
            aria-label="对照稿截图"
            value={before?.id ?? ""}
            onChange={(e) => setPreviousId(e.target.value)}
          >
            {befores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} · {new Date(v.createdAt).toLocaleTimeString()}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {before && after ? (
        <>
          <div className="review-compare-controls">
            <Select
              aria-label="截图比较方式"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="overlay">叠加对照</option>
              <option value="difference">像素差异</option>
            </Select>
            {mode === "overlay" && (
              <label className="review-opacity">
                新稿 {opacity}%
                <input
                  aria-label="新稿不透明度"
                  type="range"
                  min="0"
                  max="100"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          {JSON.stringify(before.page) !== JSON.stringify(after.page) && (
            <p className="review-compare-note">
              两张截图的页面状态不同，差异可能来自滚动位置、控件或动态内容。可以先对齐页面状态，再分别保存视图。
            </p>
          )}
          <div
            className="review-image-stack"
            style={{ aspectRatio: `${after.page.viewport.width} / ${after.page.viewport.height}` }}
          >
            <ReviewThumbnail service={service} workRef={workRef} view={before} />
            <div
              style={{
                opacity: mode === "difference" ? 1 : opacity / 100,
                mixBlendMode: mode === "difference" ? "difference" : "normal",
              }}
            >
              <ReviewThumbnail service={service} workRef={workRef} view={after} />
            </div>
          </div>
          <p className="review-compare-note">
            {after.page.path} · {after.page.viewport.width} × {after.page.viewport.height} ·
            两张已保存的截图
          </p>
        </>
      ) : (
        <p className="review-compare-note">
          请先为两稿保存相同页面、相同视口的视图，再比较截图。页面状态可以在并排审阅时对齐。
        </p>
      )}
    </Dialog>
  );
}

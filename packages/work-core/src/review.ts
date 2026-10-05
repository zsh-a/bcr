import { Schema } from "effect";
import { PageStateSchema, PageElementSchema, ReviewViewSchema, type ReviewView } from "./page";
import type { Target } from "./index";

const id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/u));
const text = (max: number) => Schema.String.pipe(Schema.minLength(1), Schema.maxLength(max));
const frame = Schema.Number.pipe(Schema.int(), Schema.between(0, 216000));
const coordinate = Schema.Number.pipe(Schema.between(0, 1));
const point = Schema.Struct({ x: coordinate, y: coordinate });
const viewport = Schema.Struct({
  width: Schema.Number.pipe(Schema.between(1, 20000)),
  height: Schema.Number.pipe(Schema.between(1, 20000)),
});
const commonAnchorFields = {
  point: Schema.optional(point),
  context: Schema.optional(text(8000)),
  output: Schema.optional(text(300)),
} as const;

/** A locator is deliberately discriminated so page state and timeline state cannot be mixed. */
export const AnchorSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("timeline"),
    frame,
    endFrame: Schema.optional(frame),
    viewport: Schema.optional(viewport),
    ...commonAnchorFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("page"),
    page: PageStateSchema,
    element: Schema.optional(PageElementSchema),
    viewId: Schema.optional(id),
    ...commonAnchorFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("artifact"),
    viewport: Schema.optional(viewport),
    ...commonAnchorFields,
  }),
);
export type ReviewAnchor = typeof AnchorSchema.Type;
export type TimelineAnchor = Extract<ReviewAnchor, { kind: "timeline" }>;
export type PageAnchor = Extract<ReviewAnchor, { kind: "page" }>;
export type ArtifactAnchor = Extract<ReviewAnchor, { kind: "artifact" }>;
export const isTimelineAnchor = (anchor: ReviewAnchor | undefined): anchor is TimelineAnchor =>
  anchor?.kind === "timeline";
export const isPageAnchor = (anchor: ReviewAnchor | undefined): anchor is PageAnchor =>
  anchor?.kind === "page";
export const isArtifactAnchor = (anchor: ReviewAnchor | undefined): anchor is ArtifactAnchor =>
  anchor?.kind === "artifact";
export const ReviewActionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("view"), view: ReviewViewSchema }),
  Schema.Struct({
    kind: Schema.Literal("submit"),
    submissionId: id,
    sourceRevision: id,
    target: id,
    title: text(160),
    summary: text(4000),
    jobIds: Schema.optional(Schema.Array(id).pipe(Schema.maxItems(30))),
    pages: Schema.optional(
      Schema.Array(Schema.Struct({ path: text(240), title: text(160) })).pipe(
        Schema.minItems(1),
        Schema.maxItems(12),
      ),
    ),
    addresses: Schema.Array(id).pipe(Schema.maxItems(100)),
  }),
  Schema.Struct({
    kind: Schema.Literal("comment"),
    feedbackId: id,
    submissionId: id,
    comment: text(4000),
    anchor: AnchorSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("decide"),
    feedbackId: id,
    submissionId: id,
    decision: Schema.Literal("accept", "reopen"),
  }),
  Schema.Struct({
    kind: Schema.Literal("deliver"),
    deliveryId: id,
    title: text(160),
    selections: Schema.Array(
      Schema.Struct({
        submissionId: id,
        outputs: Schema.Array(text(300)).pipe(Schema.maxItems(100)),
      }),
    ).pipe(Schema.minItems(1), Schema.maxItems(30)),
  }),
);
export const ReviewReadSchema = Schema.Struct({ id });
export const ReviewEditSchema = Schema.Struct({
  id,
  revision: id,
  requestId: id,
  action: ReviewActionSchema,
});
export type ReviewEdit = typeof ReviewEditSchema.Type;
export type ReviewAction = typeof ReviewActionSchema.Type;
export type ReviewOutput = {
  key: string;
  name: string;
  mime: string;
  hash: string;
  hashAlgorithm: "sha256" | "blake3";
  size: number;
  jobId?: string;
  path?: string;
  frame?: number;
  fromFrame?: number;
};
export type Submission = {
  id: string;
  sourceRevision: string;
  target: Target;
  title: string;
  summary: string;
  createdAt: number;
  outputs: ReviewOutput[];
  previewJobId?: string;
  addresses: readonly string[];
  pages?: { path: string; title: string; output?: string }[];
  build?: string;
};
export type Feedback = {
  id: string;
  submissionId: string;
  comment: string;
  anchor: ReviewAnchor;
  createdAt: number;
  status: "open" | "addressed" | "accepted";
  addressedBy?: string;
  acceptedIn?: string;
};
export type Delivery = {
  id: string;
  title: string;
  createdAt: number;
  selections: {
    submissionId: string;
    sourceRevision: string;
    target: string;
    outputs: ReviewOutput[];
  }[];
};
export type ReviewBook = {
  format: "bcr-review-1";
  revision: string;
  submissions: Submission[];
  feedback: Feedback[];
  deliveries: Delivery[];
  views?: ReviewView[];
};
export const emptyReviewBook = (): ReviewBook => ({
  format: "bcr-review-1",
  revision: "initial",
  submissions: [],
  feedback: [],
  deliveries: [],
});

/** Shared workflow rules. Sources validate snapshots/artifacts; neither a render nor a submission accepts feedback. */
export function editReviewBook(
  book: ReviewBook,
  action: ReviewAction,
  nextRevision: string,
  now: number,
  prepared?: Submission,
): ReviewBook {
  const next = structuredClone(book);
  next.revision = nextRevision;
  if (action.kind === "view") {
    const view = action.view,
      submission = next.submissions.find((s) => s.id === view.submissionId);
    if (!submission || submission.target.runtime !== "html")
      throw new Error("页面视图需要 HTML 审阅稿");
    if (
      !(submission.pages ?? [{ path: submission.target.entry }]).some(
        (p) => p.path === view.page.path,
      )
    )
      throw new Error("视图页面不属于此审阅稿");
    if ((next.views ?? []).some((v) => v.id === view.id)) throw new Error("视图 ID 已存在");
    if ((next.views?.length ?? 0) >= 500) throw new Error("审阅视图超过上限");
    next.views = [...(next.views ?? []), structuredClone(view)];
  } else if (action.kind === "submit") {
    if (!prepared || prepared.id !== action.submissionId) throw new Error("缺少已核验的审阅产物");
    if (next.submissions.some((s) => s.id === action.submissionId))
      throw new Error("审阅版本 ID 已存在");
    if (new Set(action.addresses).size !== action.addresses.length) throw new Error("反馈 ID 重复");
    for (const id of action.addresses) {
      const feedback = next.feedback.find((f) => f.id === id);
      const original = next.submissions.find((s) => s.id === feedback?.submissionId);
      if (!feedback || feedback.status === "accepted" || original?.target.id !== prepared.target.id)
        throw new Error("关联反馈不存在、已确认或属于其他目标");
      if (original.sourceRevision === prepared.sourceRevision)
        throw new Error("处理反馈需要提交修改后的源码版本");
      feedback.status = "addressed";
      feedback.addressedBy = prepared.id;
    }
    next.submissions.push(prepared);
  } else if (action.kind === "comment") {
    const submission = next.submissions.find((s) => s.id === action.submissionId);
    if (!submission) throw new Error("审阅版本不存在");
    if (next.feedback.some((f) => f.id === action.feedbackId)) throw new Error("反馈 ID 已存在");
    const a = action.anchor,
      target = submission.target;
    const view =
      a.kind === "page" && a.viewId
        ? next.views?.find((v) => v.id === a.viewId && v.submissionId === submission.id)
        : undefined;
    if (a.kind === "page" && a.viewId && !view) throw new Error("反馈视图不属于此审阅稿");
    if (view && a.kind === "page" && JSON.stringify(a.page) !== JSON.stringify(view.page))
      throw new Error("反馈页面状态与固定截图不一致");
    if (
      view &&
      a.kind === "page" &&
      a.element &&
      !view.elements.some((e) => JSON.stringify(e) === JSON.stringify(a.element))
    )
      throw new Error("反馈元素不在固定截图内");
    if (
      a.kind === "page" &&
      (target.runtime !== "html" ||
        !(submission.pages ?? [{ path: target.entry }]).some((p) => p.path === a.page.path))
    )
      throw new Error("反馈页面不属于此审阅稿");
    if (a.output && !submission.outputs.some((o) => o.key === a.output))
      throw new Error("反馈产物不属于此版本");
    if (
      a.kind === "timeline" &&
      (target.runtime !== "remotion" ||
        a.frame >= target.durationInFrames ||
        (a.endFrame !== undefined &&
          (a.endFrame < a.frame || a.endFrame >= target.durationInFrames)))
    )
      throw new Error("反馈时间范围无效");
    next.feedback.push({
      id: action.feedbackId,
      submissionId: submission.id,
      comment: action.comment,
      anchor: view && a.kind === "page" ? { ...a, page: view.page } : a,
      createdAt: now,
      status: "open",
    });
  } else if (action.kind === "decide") {
    const feedback = next.feedback.find((f) => f.id === action.feedbackId);
    if (
      !feedback ||
      feedback.addressedBy !== action.submissionId ||
      (action.decision === "accept" && feedback.status !== "addressed")
    )
      throw new Error("反馈对应的修改版本已变化，请重新读取");
    if (action.decision === "accept") {
      feedback.status = "accepted";
      feedback.acceptedIn = action.submissionId;
    } else {
      feedback.status = "open";
      delete feedback.addressedBy;
      delete feedback.acceptedIn;
    }
  } else {
    if (next.deliveries.some((d) => d.id === action.deliveryId)) throw new Error("交付 ID 已存在");
    if (new Set(action.selections.map((s) => s.submissionId)).size !== action.selections.length)
      throw new Error("交付版本重复");
    const selections = action.selections.map((selection) => {
      const submission = next.submissions.find((s) => s.id === selection.submissionId);
      if (!submission) throw new Error("交付版本不存在");
      if (
        next.feedback.some(
          (f) =>
            f.status !== "accepted" &&
            (f.submissionId === submission.id ||
              f.addressedBy === submission.id ||
              submission.addresses.includes(f.id)),
        )
      )
        throw new Error("此版本还有未确认的反馈");
      const outputs = selection.outputs.map((key) => {
        const output = submission.outputs.find((o) => o.key === key);
        if (!output) throw new Error("交付产物不属于此版本");
        return output;
      });
      if (!outputs.length) throw new Error("请选择实际交付文件；预览任务不能作为成片");
      if (new Set(selection.outputs).size !== outputs.length) throw new Error("交付产物重复");
      return {
        submissionId: submission.id,
        sourceRevision: submission.sourceRevision,
        target: submission.target.id,
        outputs,
      };
    });
    next.deliveries.push({
      id: action.deliveryId,
      title: action.title,
      createdAt: now,
      selections,
    });
  }
  if (next.submissions.length > 200 || next.feedback.length > 2000 || next.deliveries.length > 200)
    throw new Error("审阅记录超过上限");
  return next;
}
export function outputMime(name: string) {
  if (/\.png$/iu.test(name)) return "image/png";
  if (/\.(jpg|jpeg)$/iu.test(name)) return "image/jpeg";
  if (/\.webp$/iu.test(name)) return "image/webp";
  if (/\.mp4$/iu.test(name)) return "video/mp4";
  if (/\.html?$/iu.test(name)) return "text/html";
  if (/\.json$/iu.test(name)) return "application/json";
  return "application/octet-stream";
}

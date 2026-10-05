import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  decode,
  Id,
  ReviewEditSchema,
  editReviewBook,
  emptyReviewBook,
  outputMime,
  type ReviewBook,
  type Submission,
  type ReviewView,
} from "@bcr/work-core";
import { atomic, hash, json, type Projects } from "./projects";
import type { Jobs } from "./jobs";

/** One atomic file holds the review ledger and replay receipts, outside renderable source. */
export class ReviewRepository {
  validateView: (id: string, view: ReviewView) => void = () => {
    throw new Error("页面截图服务未配置");
  };
  constructor(
    private projects: Projects,
    private jobs: Jobs,
  ) {}
  private path(id: string) {
    return join(this.projects.state, "reviews", `${decode(Id, id)}.json`);
  }
  private record(id: string): {
    book: ReviewBook;
    receipts: Record<string, { digest: string; revision: string }>;
  } {
    const path = this.path(id);
    return existsSync(path)
      ? (json(path) as ReturnType<ReviewRepository["record"]>)
      : { book: emptyReviewBook(), receipts: {} };
  }
  read(id: string) {
    return this.record(id).book;
  }
  edit(raw: unknown) {
    const input = decode(ReviewEditSchema, raw),
      record = this.record(input.id),
      digest = hash(JSON.stringify(input));
    const receipt = Object.hasOwn(record.receipts, input.requestId)
      ? record.receipts[input.requestId]
      : undefined;
    if (receipt) {
      if (receipt.digest !== digest) throw new Error("requestId 已用于其他审阅操作");
      return record.book;
    }
    if (input.revision !== record.book.revision) throw new Error("审阅记录冲突，请刷新后重试");
    const action = input.action;
    let prepared: Submission | undefined;
    if (action.kind === "view") this.validateView(input.id, action.view);
    if (action.kind === "submit") {
      const project = this.projects.snapshot(input.id, action.sourceRevision),
        target = project.targets.find((t) => t.id === action.target);
      if (!target) throw new Error("审阅目标不存在");
      const jobs = (action.jobIds ?? []).map((id) => this.jobs.get(id));
      if (!jobs.length || new Set(action.jobIds).size !== jobs.length)
        throw new Error("请选择已完成的预览或产物任务");
      for (const job of jobs) {
        if (
          job.status !== "succeeded" ||
          job.request.id !== input.id ||
          job.request.revision !== action.sourceRevision ||
          job.request.target !== action.target
        )
          throw new Error("任务必须属于同一作品、版本和目标，且已成功完成");
      }
      const preview = jobs.find((j) => j.request.kind === "preview");
      const outputs = jobs.flatMap((job) =>
        job.outputs.map((o) => {
          const bytes = readFileSync(join(this.jobs.directory(job.id), "outputs", o.name));
          if (bytes.length !== o.size || hash(bytes) !== o.hash)
            throw new Error("产物完整性校验失败");
          const frame = /^frame-(\d+)\.png$/u.exec(o.name);
          return {
            ...o,
            key: `${job.id}/${o.name}`,
            hashAlgorithm: "sha256" as const,
            mime: outputMime(o.name),
            jobId: job.id,
            ...(frame ? { frame: Number(frame[1]) } : {}),
            ...(job.request.kind === "video" ? { fromFrame: job.request.from ?? 0 } : {}),
          };
        }),
      );
      if (!preview && !outputs.some((o) => /^(image|video)\//u.test(o.mime)))
        throw new Error("提交审阅需要可观看的预览、图片或视频");
      const pages =
        target.runtime === "html"
          ? [...(action.pages ?? [{ path: target.entry, title: action.title }])]
          : undefined;
      if (pages) {
        if (!preview || new Set(pages.map((p) => p.path)).size !== pages.length)
          throw new Error("页面审阅需要预览任务和不重复的页面路径");
        for (const page of pages)
          if (!/\.html?$/iu.test(page.path) || !project.files.some((f) => f.path === page.path))
            throw new Error("审阅页面不在源码版本内");
      } else if (action.pages) throw new Error("视频目标不能提交 HTML 页面清单");
      prepared = {
        ...(pages ? { pages } : {}),
        build: this.jobs.engine,
        id: action.submissionId,
        title: action.title,
        summary: action.summary,
        sourceRevision: project.revision,
        target,
        outputs,
        addresses: action.addresses,
        createdAt: Date.now(),
        ...(preview ? { previewJobId: preview.id } : {}),
      };
    }
    const book = editReviewBook(record.book, action, randomUUID(), Date.now(), prepared);
    if (Object.keys(record.receipts).length >= 10000) throw new Error("审阅操作回执超过上限");
    atomic(
      this.path(input.id),
      JSON.stringify({
        book,
        receipts: { ...record.receipts, [input.requestId]: { digest, revision: book.revision } },
      }),
    );
    return book;
  }
}

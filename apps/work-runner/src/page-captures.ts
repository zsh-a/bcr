import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  decode,
  Id,
  PageCaptureSchema,
  ReviewViewSchema,
  type PageCapture,
  type ReviewView,
} from "@bcr/work-core";
import { atomic, hash, json } from "./projects";
import type { Projects } from "./projects";
import type { Jobs } from "./jobs";
import type { ReviewRepository } from "./review";

/** Captures are derived artifacts. They never become another copy of editable source. */
export class PageCaptures {
  private running = new Map<string, { digest: string; result: Promise<PageCapture> }>();
  private children = new Set<ReturnType<typeof Bun.spawn>>();
  private closed = false;
  constructor(
    private projects: Projects,
    private jobs: Jobs,
    private review: ReviewRepository,
    private engine: string,
  ) {}
  private directory(id: string) {
    return join(this.projects.state, "captures", decode(Id, id));
  }
  read(id: string): PageCapture {
    const record = json(join(this.directory(id), "capture.json")) as { capture: PageCapture };
    return record.capture;
  }
  image(id: string) {
    const capture = this.read(id),
      bytes = readFileSync(join(this.directory(id), "page.png"));
    if (bytes.length !== capture.image.size || hash(bytes) !== capture.image.hash)
      throw new Error("页面截图校验失败");
    return bytes;
  }
  validate(workId: string, view: ReviewView) {
    if (!view.image.captureId) throw new Error("本地审阅视图必须使用 Runner 截图");
    const capture = this.read(view.image.captureId);
    if (capture.source.workId !== workId || capture.source.submissionId !== view.submissionId)
      throw new Error("截图不属于此作品或审阅版本");
    for (const key of ["page", "image", "elements", "warnings", "engine", "createdAt"] as const)
      if (JSON.stringify(capture[key]) !== JSON.stringify(view[key]))
        throw new Error(`截图 ${key} 与记录不一致`);
    this.image(capture.id);
  }
  capture(raw: unknown): Promise<PageCapture> {
    const input = decode(PageCaptureSchema, raw),
      digest = hash(JSON.stringify(input));
    if (this.closed) throw new Error("Runner 正在停止");
    const saved = join(this.directory(input.requestId), "capture.json");
    if (existsSync(saved)) {
      const record = json(saved) as { digest: string; capture: PageCapture };
      if (digest !== record.digest) throw new Error("requestId 已用于其他截图");
      this.image(input.requestId);
      return Promise.resolve(record.capture);
    }
    const pending = this.running.get(input.requestId);
    if (pending) {
      if (pending.digest !== digest) throw new Error("requestId 已用于其他截图");
      return pending.result;
    }
    if (this.running.size >= 2) throw new Error("已有两项页面截图正在生成，请稍后重试");
    const execute = async () => {
      let source: PageCapture["source"], document: string | undefined, site: string | undefined;
      let manifest: Record<string, string> | undefined;
      if (input.source.kind === "document") {
        if (Buffer.byteLength(input.source.html) > 14 * 1024 * 1024)
          throw new Error("页面产物超过 14 MiB");
        document = input.source.html;
        source = { kind: "document", key: input.source.key };
      } else {
        const { id: workId, submissionId } = input.source;
        const submission = this.review.read(workId).submissions.find((s) => s.id === submissionId);
        if (!submission || submission.target.runtime !== "html" || !submission.previewJobId)
          throw new Error("此审阅版本没有固定的页面预览");
        if (
          !(submission.pages ?? [{ path: submission.target.entry }]).some(
            (p) => p.path === input.page.path,
          )
        )
          throw new Error("页面不在此审阅版本内");
        const job = this.jobs.get(submission.previewJobId);
        if (job.status !== "succeeded") throw new Error("预览未就绪");
        site = join(this.jobs.directory(job.id), "site");
        const output = job.outputs.find((o) => o.name === "page-manifest.json");
        if (!output) throw new Error("此旧预览没有页面构建清单，请重新生成预览并提交新稿");
        const bytes = readFileSync(join(this.jobs.directory(job.id), "outputs", output.name));
        if (hash(bytes) !== output.hash) throw new Error("页面构建清单校验失败");
        manifest = JSON.parse(bytes.toString()) as Record<string, string>;
        source = {
          kind: "submission",
          key: `${job.id}:${input.page.path}`,
          workId: input.source.id,
          submissionId: submission.id,
        };
      }
      const directory = this.directory(input.requestId);
      mkdirSync(directory, { recursive: true });
      const temporary = mkdtempSync(join(directory, "working-"));
      try {
        atomic(
          join(temporary, "input.json"),
          JSON.stringify({ page: input.page, document, site, manifest }),
        );
        const entry = join(
          import.meta.dir,
          import.meta.file.endsWith(".ts") ? "page-worker.ts" : "page-worker.js",
        );
        const child = Bun.spawn([process.execPath, entry, temporary], {
          stdout: "ignore",
          stderr: "pipe",
          detached: process.platform !== "win32",
        });
        this.children.add(child);
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          this.kill(child);
        }, 35000);
        let code: number, stderr: string;
        try {
          [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        } finally {
          clearTimeout(timer);
          this.children.delete(child);
        }
        if (timedOut)
          throw new Error("页面截图超过 35 秒，已停止。请检查页面脚本或先安装 Runner 浏览器。");
        if (code !== 0) throw new Error(stderr.slice(-2000) || "页面截图失败");
        const result = json(join(temporary, "result.json")) as Pick<
          PageCapture,
          "elements" | "warnings"
        >;
        const bytes = readFileSync(join(temporary, "page.png"));
        const view = decode(ReviewViewSchema, {
          id: input.requestId,
          submissionId: "capture",
          title: "capture",
          page: input.page,
          image: {
            captureId: input.requestId,
            name: "page.png",
            mime: "image/png",
            size: bytes.length,
            hash: hash(bytes),
            hashAlgorithm: "sha256",
          },
          ...result,
          engine: this.engine,
          createdAt: Date.now(),
        });
        const capture: PageCapture = {
          id: view.id,
          source,
          page: view.page,
          image: view.image,
          elements: [...view.elements],
          warnings: [...view.warnings],
          engine: view.engine,
          createdAt: view.createdAt,
        };
        atomic(join(directory, "page.png"), bytes);
        atomic(saved, JSON.stringify({ digest, capture }));
        return capture;
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    };
    const result = execute().finally(() => this.running.delete(input.requestId));
    this.running.set(input.requestId, { digest, result });
    return result;
  }
  private kill(child: ReturnType<typeof Bun.spawn>) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill();
    }
  }
  async close() {
    this.closed = true;
    for (const child of this.children) this.kill(child);
    await Promise.allSettled([...this.running.values()].map((p) => p.result));
  }
}

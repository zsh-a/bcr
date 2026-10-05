import { JSONSchema, Schema } from "effect";
import { ArtifactSchema } from "../workspace/files";

export const Id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/u));
export const Path = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Links = Schema.Array(
  Schema.Struct({
    rel: Schema.String.pipe(Schema.maxLength(100)),
    uri: Schema.String.pipe(Schema.maxLength(2000)),
    revision: Schema.optional(Id),
  }),
).pipe(Schema.maxItems(100));
export const WorkSchema = Schema.Struct({
  format: Schema.Literal("bcr-work-1"),
  id: Id,
  revision: Id,
  parent: Schema.NullOr(Id),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  entry: Schema.NullOr(Path),
  files: Schema.Array(Schema.Struct({ path: Path, artifact: ArtifactSchema })).pipe(
    Schema.maxItems(200),
  ),
  links: Links,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  message: Schema.optional(Schema.String.pipe(Schema.maxLength(160))),
  restoredFrom: Schema.optional(Id),
});
export type Work = typeof WorkSchema.Type;
export const CommitSchema = Schema.Struct({
  requestId: Id,
  id: Schema.optional(Id),
  revision: Schema.NullOr(Id),
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))),
  entry: Schema.optional(Schema.NullOr(Path)),
  links: Schema.optional(Links),
  put: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Path,
        text: Schema.optional(Schema.String.pipe(Schema.maxLength(1_000_000))),
        mime: Schema.optional(Schema.String.pipe(Schema.maxLength(120))),
        artifact: Schema.optional(ArtifactSchema),
      }),
    ).pipe(Schema.maxItems(200)),
  ),
  remove: Schema.optional(Schema.Array(Path).pipe(Schema.maxItems(200))),
  restoreRevision: Schema.optional(Id),
  message: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160))),
});
export type WorkCommit = typeof CommitSchema.Type;
export function parseCommit(raw: unknown): WorkCommit {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 1_500_000)
    throw new Error("变更过大，请分批提交或使用文件上传");
  const input = Schema.decodeUnknownSync(CommitSchema, { onExcessProperty: "error" })(raw);
  if (!input.id && input.revision !== null) throw new Error("新作品的 revision 必须为 null");
  if (
    input.restoreRevision &&
    (!input.id ||
      input.put ||
      input.remove ||
      input.entry !== undefined ||
      input.title ||
      input.links)
  )
    throw new Error("恢复版本不能与其他变更混用");
  const paths = [...(input.put ?? []).map((f) => f.path), ...(input.remove ?? [])];
  paths.forEach(validatePath);
  if (new Set(paths).size !== paths.length) throw new Error("同一文件不能重复修改或同时删除");
  for (const f of input.put ?? [])
    if ((f.text === undefined) === (f.artifact === undefined))
      throw new Error("文件必须提供 text 或 artifact 之一");
  if (input.entry) validatePath(input.entry);
  return input;
}
export function validatePath(path: string) {
  if (
    path.length > 240 ||
    !/^[\p{L}\p{N}_. /-]+$/u.test(path) ||
    path.split("/").some((s) => !s || s === "." || s === ".." || s.trim() !== s)
  )
    throw new Error(`无效的作品相对路径：${path}`);
}
export function decodeWork(value: unknown): Work {
  const work = Schema.decodeUnknownSync(WorkSchema, { onExcessProperty: "error" })(value);
  work.files.forEach((f) => validatePath(f.path));
  if (new Set(work.files.map((f) => f.path)).size !== work.files.length)
    throw new Error("作品文件路径重复");
  if (work.files.reduce((sum, f) => sum + f.artifact.size, 0) > 256 * 1024 * 1024)
    throw new Error("作品总文件超过 256 MiB");
  if (
    work.entry &&
    (!/\.html?$/iu.test(work.entry) || !work.files.some((f) => f.path === work.entry))
  )
    throw new Error("入口必须指向作品中的 HTML 文件");
  return work;
}
export const workContract = () => ({
  manifest: JSONSchema.make(WorkSchema),
  commit: JSONSchema.make(CommitSchema),
  instructions:
    "作品是文件、入口、版本和可选资源链接，不要求研究模型或预设组件。先 work_read 获取 revision，work_commit 只修改目标文件。新建使用 revision:null 与新 requestId，重试必须保持相同 requestId/参数。entry:null 可保存任意资料；HTML 入口可预览。",
  runtime:
    "普通 HTML/CSS/JS 与原生 ES modules，相对静态 import / 字符串字面量 dynamic import；禁止外部 URL、远程依赖、eval、CSS @import。React/TSX/npm 依赖请在独立作品目录预先打包，然后上传浏览器产物，不修改 BCR 源码。使用 await bcr.readText('data.json') 读取作品内文件、bcr.asset('image.png') 获取 data URL。不提供任何宿主存储或工具调用。",
  workflow:
    "work_commit → work_preview(start) → work_preview(inspect/input/click) → 根据错误修订 → work_export。保存不会自动执行脚本。预览限制 10 MiB，版本完整归档上限 256 MiB。导出 HTML 与预览使用同一编译器；archive 包含版本清单和原始文件，可通过 work_import 在新环境恢复。",
  review:
    "work_review_read → work_review_edit(submit/comment/decide/deliver)。审阅 revision 独立于源码 revision；submit 固定源码、产物和修改说明，addresses 关联反馈，只标为待复核。必须收到用户明确指令才可 accept 或 deliver。work_delivery_export 下载固定交付包。",
});
export function mimeFor(path: string) {
  const ext = path.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        html: "text/html",
        htm: "text/html",
        js: "text/javascript",
        mjs: "text/javascript",
        css: "text/css",
        json: "application/json",
        svg: "image/svg+xml",
        csv: "text/csv",
        txt: "text/plain",
        md: "text/markdown",
      } as Record<string, string>
    )[ext ?? ""] ?? "application/octet-stream"
  );
}

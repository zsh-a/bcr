import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  capabilities,
  decode,
  definition,
  Id,
  parameterValues,
  ParamsSchema,
  Path,
  Revision,
  ReviewWriteSchema,
  ReviewSchema,
  type Project,
  type Reviews,
} from "@bcr/work-core";

export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function atomic(path: string, value: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, value, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
export const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const ignored = new Set(["node_modules", ".git", ".bcr", "dist", "out"]);
const privateFile = (name: string) =>
  name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") || name.endsWith(".key");
type Scan = { project: Project; bytes: Map<string, Buffer> };

/** All filesystem mutation is synchronous inside this process: revision checks and rename cannot interleave. */
export class Projects {
  readonly root: string;
  readonly state: string;
  constructor(root: string, state: string) {
    this.root = realpathSync(root);
    mkdirSync(resolve(state), { recursive: true, mode: 0o700 });
    this.state = realpathSync(state);
    const outside = relative(this.root, this.state);
    if (outside !== ".." && !outside.startsWith(`..${sep}`))
      throw new Error("Runner 状态目录必须放在授权工程目录之外");
  }
  private directories() {
    if (existsSync(join(this.root, "work.json"))) return [this.root];
    return readdirSync(this.root, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.isSymbolicLink() &&
          !e.name.startsWith(".") &&
          existsSync(join(this.root, e.name, "work.json")),
      )
      .map((e) => join(this.root, e.name));
  }
  private scan(dir: string): Scan {
    const bytes = new Map<string, Buffer>();
    let total = 0;
    const visit = (folder: string) => {
      for (const name of readdirSync(folder).sort()) {
        if (ignored.has(name) || privateFile(name) || name.endsWith(".tmp")) continue;
        const absolute = join(folder, name),
          path = relative(dir, absolute);
        if (path === "reviews.json" || path === "bcr-snapshot.json") continue;
        if ([".bcr-player.tsx", ".bcr-render.tsx", "bcr-preview.js"].includes(path))
          throw new Error(`文件名由 Runner 保留：${path}`);
        decode(Path, path);
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) throw new Error(`工程不能包含符号链接：${path}`);
        if (stat.isDirectory()) visit(absolute);
        else if (stat.isFile()) {
          if (
            stat.size > 64 * 1024 * 1024 ||
            total + stat.size > 256 * 1024 * 1024 ||
            bytes.size >= 2000
          )
            throw new Error("工程超出快照上限（2000 文件、单文件 64 MiB、总量 256 MiB）");
          const value = readFileSync(absolute);
          total += value.byteLength;
          if (total > 256 * 1024 * 1024) throw new Error("工程在读取时超过快照上限");
          bytes.set(path, value);
        } else throw new Error(`不支持的文件类型：${path}`);
      }
    };
    visit(dir);
    const work = definition(JSON.parse(bytes.get("work.json")?.toString() ?? "null"));
    for (const target of work.targets) {
      if (!bytes.has(target.entry)) throw new Error(`缺少入口：${target.entry}`);
      if (target.runtime === "remotion" && target.propsFile && !bytes.has(target.propsFile))
        throw new Error(`缺少参数：${target.propsFile}`);
    }
    const files = [...bytes]
      .map(([path, b]) => ({ path, hash: hash(b), size: b.byteLength }))
      .sort((a, b) => a.path.localeCompare(b.path, "en"));
    return {
      bytes,
      project: {
        directory: dir,
        ref: { provider: "local", id: work.id },
        title: work.title,
        revision: hash(JSON.stringify(files)),
        definition: work,
        targets: work.targets,
        files,
        capabilities: capabilities(work.targets),
      },
    };
  }
  list() {
    const items: Project[] = [],
      errors: { directory: string; message: string }[] = [];
    for (const dir of this.directories()) {
      try {
        const item = this.scan(dir).project;
        if (items.some((p) => p.ref.id === item.ref.id))
          throw new Error(`作品 ID 重复：${item.ref.id}`);
        items.push(item);
      } catch (error) {
        errors.push({ directory: relative(this.root, dir) || ".", message: String(error) });
      }
    }
    return { items, errors };
  }
  private locate(id: string) {
    decode(Id, id);
    const matches = this.directories().filter((dir) => {
      const path = join(dir, "work.json");
      try {
        if (lstatSync(path).isSymbolicLink()) return false;
        return definition(json(path)).id === id;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) throw new Error(`作品不存在或 ID 重复：${id}`);
    return matches[0]!;
  }
  read(id: string): Project {
    return this.scan(this.locate(id)).project;
  }
  snapshot(id: string, revision: string): Project {
    decode(Revision, revision);
    const cached = join(this.state, "snapshots", revision, "manifest.json");
    if (existsSync(cached)) {
      const project = json(cached) as Project;
      if (project.ref.id !== id) throw new Error("快照不属于此作品");
      return project;
    }
    const dir = this.locate(id),
      scan = this.scan(dir);
    if (scan.project.revision !== revision || this.scan(dir).project.revision !== revision)
      throw new Error("作品版本冲突，请重新读取");
    const staging = join(this.state, "snapshots", `${revision}.${randomUUID()}.tmp`);
    try {
      for (const [path, bytes] of scan.bytes) atomic(join(staging, "source", path), bytes);
      atomic(join(staging, "manifest.json"), JSON.stringify(scan.project));
      renameSync(staging, dirname(cached));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return scan.project;
  }
  source(revision: string) {
    return join(this.state, "snapshots", decode(Revision, revision), "source");
  }
  file(id: string, revision: string, path: string) {
    const project = this.snapshot(id, revision);
    decode(Path, path);
    const file = project.files.find((f) => f.path === path);
    if (!file) throw new Error("文件不在快照中");
    const bytes = readFileSync(join(this.source(revision), path));
    if (hash(bytes) !== file.hash) throw new Error("快照文件校验失败");
    return bytes;
  }
  private replay<T>(id: string, requestId: string, input: unknown, mutate: () => T): T {
    const path = join(this.state, "receipts", `${id}-${requestId}.json`),
      digest = hash(JSON.stringify(input));
    if (existsSync(path)) {
      const receipt = json(path) as { digest: string; result: T };
      if (receipt.digest !== digest) throw new Error("requestId 已用于其他操作");
      return receipt.result;
    }
    const result = mutate();
    atomic(path, JSON.stringify({ digest, result }));
    return result;
  }
  parameters(raw: unknown) {
    const input = decode(ParamsSchema, raw);
    return this.replay(input.id, input.requestId, input, () => {
      const dir = this.locate(input.id),
        { project, bytes } = this.scan(dir);
      if (project.revision !== input.revision) throw new Error("作品版本冲突，请重新读取");
      const target = project.targets.find((t) => t.id === input.target);
      if (!target || target.runtime !== "remotion" || !target.propsFile)
        throw new Error("此目标没有可编辑参数");
      const props = JSON.parse(bytes.get(target.propsFile)!.toString());
      if (!props || typeof props !== "object" || Array.isArray(props))
        throw new Error("propsFile 必须是 JSON 对象");
      atomic(
        join(dir, target.propsFile),
        `${JSON.stringify(parameterValues(target, props, input.values), null, 2)}\n`,
      );
      return this.read(input.id);
    });
  }
  reviews(id: string): Reviews {
    const path = join(this.locate(id), "reviews.json");
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error("reviews.json 不能是符号链接");
    const items = existsSync(path) ? json(path) : [];
    if (!Array.isArray(items) || items.length > 1000) throw new Error("批注文件无效");
    const reviews = items.map((r) => decode(ReviewSchema, r));
    return { revision: hash(JSON.stringify(reviews)), items: reviews };
  }
  review(raw: unknown): Reviews {
    const input = decode(ReviewWriteSchema, raw);
    return this.replay(input.id, input.requestId, input, () => {
      const current = this.reviews(input.id);
      if (current.revision !== input.revision) throw new Error("批注版本冲突，请重新读取");
      const source = this.snapshot(input.id, input.review.sourceRevision);
      const target = source.targets.find((t) => t.id === input.review.target);
      if (
        !target ||
        (input.review.frame !== undefined &&
          (target.runtime !== "remotion" || input.review.frame >= target.durationInFrames))
      )
        throw new Error("批注目标或帧号无效");
      const items = [...current.items.filter((r) => r.id !== input.review.id), input.review];
      if (items.length > 1000) throw new Error("批注数量超过上限");
      atomic(join(this.locate(input.id), "reviews.json"), `${JSON.stringify(items, null, 2)}\n`);
      return this.reviews(input.id);
    });
  }
}

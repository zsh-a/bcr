import { contentFiles, FILE_LIMIT, filesContent, isManagedPath, TRANSFER_LIMIT } from "./files";
import { decodeTarget, object, type GitTarget, type KnowledgeContent } from "./model";
import { parseRepository } from "./repository";

export interface RemoteKnowledge {
  head: string;
  tree: string;
  content: KnowledgeContent;
  files: Record<string, string>;
}
export interface KnowledgeRemote {
  readonly target: GitTarget;
  read(base?: KnowledgeContent): Promise<RemoteKnowledge>;
  isAncestor(base: string, head: string): Promise<boolean>;
  prepare(remote: RemoteKnowledge, content: KnowledgeContent): Promise<string>;
  publish(expected: string, commit: string): Promise<void>;
}
export class GitHubError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "GitHub Token 无效或已过期"
        : status === 403
          ? "GitHub 拒绝访问：请检查 Contents 读写权限或请求额度"
          : status === 404
            ? "找不到仓库或分支，请检查名称与 Token 授权范围"
            : status === 409 || status === 422
              ? "远端发生变化或分支不允许直接写入，请重试或检查分支保护"
              : `GitHub 请求失败（${status}），本地内容已保留`,
    );
  }
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value))
    throw new Error("GitHub 返回了无效的提交或文件身份");
  return value;
}
export class GitHubKnowledge implements KnowledgeRemote {
  static async connect(address: string, token: string, branch = "", fetcher?: typeof fetch) {
    const identity = parseRepository(address);
    const probe = new GitHubKnowledge({ ...identity, branch: "main" }, token, fetcher);
    const repository = object(await probe.request(""));
    if (repository.private !== true) throw new Error("请使用私有仓库；当前连接未上传任何笔记");
    if (repository.archived === true || repository.disabled === true)
      throw new Error("仓库已归档或停用，请选择可写入的私有仓库");
    const target = decodeTarget({
      ...identity,
      branch: branch.trim() || repository.default_branch,
    });
    const remote = new GitHubKnowledge(target, token, fetcher);
    // Validate the branch and remote content before replacing a working connection.
    await remote.read();
    return remote;
  }
  readonly target: GitTarget;
  private root: string;
  constructor(
    target: GitTarget,
    private token: string,
    private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {
    this.target = decodeTarget(target);
    this.root = `https://api.github.com/repos/${encodeURIComponent(this.target.owner)}/${encodeURIComponent(this.target.repo)}`;
    if (!token.trim()) throw new Error("请填写 GitHub Token");
  }
  private async request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await this.fetcher(this.root + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token.trim()}`,
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw new GitHubError(response.status);
      const text = await response.text();
      if (text.length > 12 * 1024 * 1024) throw new Error("GitHub 响应超过容量限制");
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("GitHub 请求超时；下次同步将核对远端是否已接受提交");
      // Never include response bodies, headers or credentials in errors.
      if (error instanceof TypeError) throw new Error("无法连接 GitHub，请检查网络后重试");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  private async treeAt(head: string) {
    const commit = object(await this.request(`/git/commits/${sha(head)}`));
    const tree = sha(object(commit.tree).sha);
    const listing = object(await this.request(`/git/trees/${tree}?recursive=1`));
    if (
      listing.truncated !== false ||
      !Array.isArray(listing.tree) ||
      listing.tree.length > 100_000
    )
      throw new Error("远端文件清单不完整，已停止同步以保留数据");
    return { tree, entries: listing.tree.map(object) };
  }
  private async blob(id: string): Promise<string> {
    const result = object(await this.request(`/git/blobs/${sha(id)}`));
    if (
      result.encoding !== "base64" ||
      typeof result.content !== "string" ||
      typeof result.size !== "number" ||
      result.size > FILE_LIMIT ||
      result.content.length > FILE_LIMIT * 1.5
    )
      throw new Error("远端文件格式或大小不支持");
    const bytes = Uint8Array.from(atob(result.content.replace(/\s/gu, "")), (c) => c.charCodeAt(0));
    if (bytes.length !== result.size) throw new Error("远端文件长度校验失败");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  async read(base?: KnowledgeContent): Promise<RemoteKnowledge> {
    const repository = object(await this.request(""));
    if (repository.private !== true) throw new Error("请使用私有仓库；当前连接未上传任何笔记");
    let reference;
    try {
      reference = object(
        await this.request(`/git/ref/heads/${encodeURIComponent(this.target.branch)}`),
      );
    } catch (error) {
      if (error instanceof GitHubError && [404, 409].includes(error.status))
        throw new Error("同步分支尚不存在。请在 GitHub 创建私有仓库并添加 README，再填写已有分支");
      throw error;
    }
    const head = sha(object(reference.object).sha);
    const { tree, entries } = await this.treeAt(head);
    const managed = entries.filter(
      (entry) => typeof entry.path === "string" && isManagedPath(entry.path),
    );
    if (managed.length > 11_000) throw new Error("远端知识库文件数量超过限制");
    let bytes = 0;
    for (const entry of managed) {
      if (
        entry.type !== "blob" ||
        entry.mode !== "100644" ||
        typeof entry.size !== "number" ||
        entry.size < 0 ||
        entry.size > FILE_LIMIT
      )
        throw new Error("知识库中存在不支持的文件或符号链接");
      bytes += entry.size;
    }
    if (bytes > TRANSFER_LIMIT) throw new Error("知识库同步内容超过 16 MiB，请减少内容");
    const files: Record<string, string> = {},
      cached = base ? contentFiles(base) : {};
    // Four concurrent reads; unchanged canonical files can be recovered from the durable baseline.
    for (let start = 0; start < managed.length; start += 4) {
      await Promise.all(
        managed.slice(start, start + 4).map(async (entry) => {
          const path = entry.path as string,
            previous = cached[path];
          if (previous !== undefined && (await gitBlobId(previous)) === sha(entry.sha))
            files[path] = previous;
          else files[path] = await this.blob(sha(entry.sha));
        }),
      );
    }
    return { head, tree, files, content: filesContent(files) };
  }
  async isAncestor(base: string, head: string): Promise<boolean> {
    if (base === head) return true;
    const comparison = object(await this.request(`/compare/${sha(base)}...${sha(head)}`));
    return comparison.status === "ahead" || comparison.status === "identical";
  }
  async prepare(remote: RemoteKnowledge, content: KnowledgeContent): Promise<string> {
    const files = contentFiles(content);
    const sizes = Object.values(files).map((text) => new TextEncoder().encode(text).length);
    if (sizes.some((size) => size > FILE_LIMIT))
      throw new Error("笔记或引用快照超过单文件 2 MiB 限制");
    if (sizes.reduce((sum, size) => sum + size, 0) > TRANSFER_LIMIT)
      throw new Error("知识库同步内容超过 16 MiB");
    const changes = [...new Set([...Object.keys(remote.files), ...Object.keys(files)])]
      .filter((path) => remote.files[path] !== files[path])
      .map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        ...(files[path] === undefined ? { sha: null } : { content: files[path] }),
      }));
    if (!changes.length) return remote.head;
    const tree = object(
      await this.request("/git/trees", "POST", { base_tree: remote.tree, tree: changes }),
    );
    const commit = object(
      await this.request("/git/commits", "POST", {
        message: "BCR: sync personal knowledge",
        tree: sha(tree.sha),
        parents: [remote.head],
      }),
    );
    return sha(commit.sha);
  }
  async publish(_expected: string, commit: string): Promise<void> {
    await this.request(`/git/refs/heads/${encodeURIComponent(this.target.branch)}`, "PATCH", {
      sha: sha(commit),
      force: false,
    });
  }
  async history(noteId: string): Promise<{ sha: string; message: string; date: string }[]> {
    const path = encodeURIComponent(`knowledge/notes/${noteId}.md`);
    const result = await this.request(
      `/commits?sha=${encodeURIComponent(this.target.branch)}&path=${path}&per_page=20`,
    );
    if (!Array.isArray(result)) throw new Error("GitHub 历史格式无效");
    return result.map((entry) => {
      const c = object(entry),
        commit = object(c.commit),
        author = object(commit.author);
      return {
        sha: sha(c.sha),
        message: String(commit.message).slice(0, 200),
        date: String(author.date),
      };
    });
  }
  async noteAt(head: string, id: string) {
    const { entries } = await this.treeAt(head);
    const files: Record<string, string> = {
      "knowledge/manifest.json": '{"format":"bcr-knowledge","version":1}',
    };
    for (const path of [`knowledge/notes/${id}.md`, `knowledge/citations/${id}.json`]) {
      const entry = entries.find((item) => item.path === path);
      if (entry) {
        if (entry.mode !== "100644" || entry.type !== "blob") throw new Error("历史文件类型不支持");
        files[path] = await this.blob(sha(entry.sha));
      }
    }
    const note = filesContent(files).notes[id];
    if (!note) throw new Error("该提交中笔记已删除，请选择更早版本");
    return note;
  }
}
async function gitBlobId(text: string): Promise<string> {
  const body = new TextEncoder().encode(text),
    header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

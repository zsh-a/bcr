import { LocalPreview } from "./runner-preview";
import {
  RUNNER_PROTOCOL,
  type RunnerCatalog,
  type Job,
  type Project,
  type Reviews,
  type Target,
} from "@bcr/work-core";

type Connection = {
  status: "disconnected" | "connected";
  items: readonly Project[];
  errors: readonly { directory: string; message: string }[];
  root?: string;
  version?: string;
  sourceId?: string;
  operations?: readonly string[];
};
export class LocalRunner {
  private url = "";
  private token = "";
  private state: Connection = { status: "disconnected", items: [], errors: [] };
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private drafts = new Map<string, Map<symbol, () => boolean>>();
  readonly preview = new LocalPreview();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private emit(state: Connection) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async connect(url: string, token: string) {
    const parsed = new URL(url);
    if (
      !/^https?:$/u.test(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin === location.origin
    )
      throw new Error("请输入独立 Runner 的 HTTP(S) 地址");
    this.disconnect();
    this.url = parsed.origin;
    this.token = token.trim();
    const attempt = this.abort;
    try {
      const catalog = await this.call<RunnerCatalog>("catalog");
      if (catalog.format !== RUNNER_PROTOCOL) throw new Error("Runner 协议版本不兼容");
      if (!catalog.sourceId) throw new Error("请更新 Runner：当前版本缺少作品来源标识");
      const data = await this.call<Pick<Connection, "items" | "errors">>("list");
      this.emit({
        status: "connected",
        root: catalog.root,
        version: catalog.version,
        sourceId: catalog.sourceId,
        operations: catalog.operations,
        ...data,
      });
    } catch (error) {
      if (this.abort === attempt) this.disconnect();
      throw error;
    }
  }
  async call<T>(op: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
    if (!this.url || !this.token) throw new Error("请先连接本地 Runner");
    if (this.state.operations && !this.state.operations.includes(op))
      throw new Error(`当前 Runner 不支持 ${op}，请更新已安装的 Runner 后重新连接`);
    const connection = this.abort;
    const response = await fetch(`${this.url}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op, input }),
      signal: AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(op === "page_capture" ? 45000 : 20000),
        ...(signal ? [signal] : []),
      ]),
    });
    const value = (await response.json()) as T & { error?: string };
    connection.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(value.error ?? `Runner HTTP ${response.status}`);
    return value;
  }
  async refresh() {
    if (this.state.status !== "connected") return;
    const data = await this.call<Pick<Connection, "items" | "errors">>("list");
    this.emit({ ...this.state, ...data });
  }
  registerDraft(id: string, dirty: () => boolean) {
    const token = Symbol("parameters");
    const entries = this.drafts.get(id) ?? new Map<symbol, () => boolean>();
    entries.set(token, dirty);
    this.drafts.set(id, entries);
    return {
      token,
      dispose: () => {
        entries.delete(token);
        if (!entries.size && this.drafts.get(id) === entries) this.drafts.delete(id);
      },
    };
  }
  assertClean(id: string, owner?: symbol) {
    if ([...(this.drafts.get(id) ?? [])].some(([token, dirty]) => token !== owner && dirty()))
      throw new Error("此作品有未保存的参数草稿，请先保存或撤销");
  }
  async previewResource(jobId: string, signal?: AbortSignal) {
    signal = AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]);
    const job = await this.call<Job>("job", { id: jobId }, signal);
    const result = await this.call<{ url: string; revision: string; target: Target }>(
      "preview",
      { id: jobId },
      signal,
    );
    if (new URL(result.url).origin === this.url || new URL(result.url).origin === location.origin)
      throw new Error("预览必须使用独立来源");
    return { ...result, id: job.request.id, jobId };
  }
  async startPreview(jobId: string, signal?: AbortSignal) {
    signal = AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]);
    return this.preview.start(await this.previewResource(jobId, signal), signal);
  }
  async output(jobId: string, name: string, signal?: AbortSignal) {
    return this.download(
      `/outputs/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}`,
      signal,
    );
  }
  pageImage(id: string, signal?: AbortSignal) {
    return this.download(`/captures/${encodeURIComponent(id)}`, signal);
  }
  private async download(path: string, signal?: AbortSignal) {
    const connection = this.abort;
    const response = await fetch(`${this.url}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    connection.signal.throwIfAborted();
    signal?.throwIfAborted();
    return blob;
  }
  disconnect() {
    this.abort.abort();
    this.abort = new AbortController();
    this.preview.stop();
    this.drafts.clear();
    this.url = "";
    this.token = "";
    this.emit({ status: "disconnected", items: [], errors: [] });
  }
}

export type { Job, Project, Reviews };

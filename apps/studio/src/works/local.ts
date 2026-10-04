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
};
export class LocalRunner {
  private url = "";
  private token = "";
  private state: Connection = { status: "disconnected", items: [], errors: [] };
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private drafts = new Map<string, () => boolean>();
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
    try {
      const catalog = await this.call<RunnerCatalog>("catalog");
      if (catalog.format !== RUNNER_PROTOCOL) throw new Error("Runner 协议版本不兼容");
      const data = await this.call<Pick<Connection, "items" | "errors">>("list");
      this.emit({ status: "connected", root: catalog.root, version: catalog.version, ...data });
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }
  async call<T>(op: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
    if (!this.url || !this.token) throw new Error("请先连接本地 Runner");
    const response = await fetch(`${this.url}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op, input }),
      signal: AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(20000),
        ...(signal ? [signal] : []),
      ]),
    });
    const value = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Runner HTTP ${response.status}`);
    return value;
  }
  async refresh() {
    if (this.state.status !== "connected") return;
    const data = await this.call<Pick<Connection, "items" | "errors">>("list");
    this.emit({ ...this.state, ...data });
  }
  registerDraft(id: string, dirty: () => boolean) {
    this.drafts.set(id, dirty);
    return () => {
      if (this.drafts.get(id) === dirty) this.drafts.delete(id);
    };
  }
  assertClean(id: string) {
    if (this.drafts.get(id)?.()) throw new Error("此作品有未保存的参数草稿，请先保存或撤销");
  }
  async startPreview(jobId: string, signal?: AbortSignal) {
    const job = await this.call<Job>("job", { id: jobId }, signal);
    const result = await this.call<{ url: string; revision: string; target: Target }>(
      "preview",
      { id: jobId },
      signal,
    );
    if (new URL(result.url).origin === this.url || new URL(result.url).origin === location.origin)
      throw new Error("预览必须使用独立来源");
    return this.preview.start({ ...result, id: job.request.id, jobId }, signal);
  }
  async output(jobId: string, name: string, signal?: AbortSignal) {
    const response = await fetch(
      `${this.url}/outputs/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.blob();
  }
  disconnect() {
    this.abort.abort();
    this.abort = new AbortController();
    this.preview.stop();
    this.url = "";
    this.token = "";
    this.emit({ status: "disconnected", items: [], errors: [] });
  }
}

type PreviewState = {
  status: "idle" | "loading" | "ready" | "error";
  id?: string;
  revision?: string;
  target?: Target;
  jobId?: string;
  frame: number | null;
  reports: string[];
};
class LocalPreview {
  private state: PreviewState = { status: "idle", frame: null, reports: [] };
  private listeners = new Set<() => void>();
  private frame: HTMLIFrameElement | undefined;
  private host: HTMLDivElement | null = null;
  private port: MessagePort | undefined;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private dispose: (() => void) | undefined;
  private generation = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  mount = (host: HTMLDivElement | null) => {
    if (host === this.host) return;
    this.stop();
    this.host = host;
  };
  private emit(state: PreviewState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async start(
    input: { url: string; id: string; revision: string; target: Target; jobId: string },
    signal?: AbortSignal,
  ) {
    this.stop();
    const generation = this.generation;
    signal?.throwIfAborted();
    const frame = document.createElement("iframe");
    this.frame = frame;
    frame.title = "本地作品预览";
    frame.sandbox.add("allow-scripts", "allow-same-origin");
    frame.referrerPolicy = "no-referrer";
    this.emit({
      status: "loading",
      id: input.id,
      revision: input.revision,
      target: input.target,
      jobId: input.jobId,
      frame: null,
      reports: [],
    });
    // An offscreen host allows Agent previews while another application is visible.
    const hidden = document.createElement("div");
    hidden.style.cssText = "position:fixed;left:-10000px;width:800px;height:600px";
    if (!this.host) document.body.append(hidden);
    (this.host ?? hidden).append(frame);
    const loaded = new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      this.port = channel.port1;
      const timeout = setTimeout(() => reject(new Error("播放器连接超时")), 20000);
      const abort = () => reject(new Error("预览已停止"));
      signal?.addEventListener("abort", abort, { once: true });
      this.dispose = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        channel.port1.close();
        channel.port2.close();
        hidden.remove();
        reject(new Error("预览已停止"));
      };
      channel.port1.onmessage = ({ data }) => {
        if (generation !== this.generation || !data || typeof data !== "object") return;
        if (data.type === "ready") {
          clearTimeout(timeout);
          this.emit({
            ...this.state,
            status: "ready",
            frame: typeof data.frame === "number" ? data.frame : null,
          });
          resolve();
        }
        if (
          data.type === "frame" &&
          this.state.status === "ready" &&
          input.target.runtime === "remotion" &&
          Number.isInteger(data.frame) &&
          data.frame >= 0 &&
          data.frame < input.target.durationInFrames
        )
          this.emit({ ...this.state, frame: data.frame });
        if (data.type === "report")
          this.emit({
            ...this.state,
            reports: [...this.state.reports, String(data.message).slice(0, 2000)].slice(-40),
          });
        if (data.type === "result" && typeof data.id === "string") {
          const request = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) request?.reject(new Error(String(data.error)));
          else {
            if (typeof data.result?.frame === "number")
              this.emit({ ...this.state, frame: data.result.frame });
            request?.resolve({
              frame: typeof data.result?.frame === "number" ? data.result.frame : null,
              text: typeof data.result?.text === "string" ? data.result.text.slice(0, 8000) : "",
            });
          }
        }
      };
      frame.onload = () => {
        if (generation !== this.generation) return;
        frame.contentWindow?.postMessage("bcr-work-connect", new URL(input.url).origin, [
          channel.port2,
        ]);
      };
      frame.onerror = () => reject(new Error("预览加载失败"));
    });
    frame.src = input.url;
    try {
      await loaded;
      return this.state;
    } catch (error) {
      if (generation === this.generation) {
        this.stop();
        this.emit({ status: "error", frame: null, reports: [String(error)] });
      }
      throw error;
    }
  }
  async inspect(action: "inspect" | "seek" | "play" | "pause", frame?: number) {
    if (this.state.status !== "ready") throw new Error("预览未就绪");
    if (this.pending.size >= 8) throw new Error("预览操作过多");
    if (
      action === "seek" &&
      (this.state.target?.runtime !== "remotion" ||
        frame === undefined ||
        !Number.isInteger(frame) ||
        frame < 0 ||
        frame >= this.state.target.durationInFrames)
    )
      throw new Error("帧号无效");
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("预览响应超时"));
      }, 5000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.port?.postMessage({ id, action, frame });
    });
  }
  stop() {
    this.generation++;
    this.dispose?.();
    this.dispose = undefined;
    this.port = undefined;
    this.frame?.remove();
    this.frame = undefined;
    for (const item of this.pending.values()) item.reject(new Error("预览已停止"));
    this.pending.clear();
    this.emit({ status: "idle", frame: null, reports: [] });
  }
}

export type { Job, Project, Reviews };

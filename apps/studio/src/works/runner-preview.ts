import {
  decode,
  PageStateSchema,
  parameterValues,
  type PageState,
  type Target,
} from "@bcr/work-core";

type PreviewState = {
  status: "idle" | "loading" | "ready" | "error";
  id?: string;
  revision?: string;
  target?: Target;
  jobId?: string;
  frame: number | null;
  path?: string;
  reports: string[];
  parameters?: boolean;
  draft?: boolean;
};
export class RunnerPreview {
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
    frame.title = "Runner 作品预览";
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
      let channel = new MessageChannel();
      this.port = channel.port1;
      let timeout = setTimeout(() => reject(new Error("播放器连接超时")), 20000);
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
      const receive = ({ data }: MessageEvent) => {
        if (generation !== this.generation || !data || typeof data !== "object") return;
        if (data.type === "ready") {
          clearTimeout(timeout);
          this.emit({
            ...this.state,
            status: "ready",
            frame: typeof data.frame === "number" ? data.frame : null,
            parameters: data.parameters === true,
            ...(typeof data.path === "string" ? { path: data.path.slice(0, 240) } : {}),
            draft: false,
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
              pageResult: data.result?.pageResult,
              frame: typeof data.result?.frame === "number" ? data.result.frame : null,
              text: typeof data.result?.text === "string" ? data.result.text.slice(0, 8000) : "",
            });
          }
        }
      };
      frame.onload = () => {
        if (generation !== this.generation) return;
        channel.port1.close();
        channel.port2.close();
        channel = new MessageChannel();
        this.port = channel.port1;
        channel.port1.onmessage = receive;
        for (const pending of this.pending.values())
          pending.reject(new Error("页面已导航，请重新操作"));
        this.pending.clear();
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          const error = new Error("播放器连接超时");
          this.emit({
            ...this.state,
            status: "error",
            reports: [...this.state.reports, error.message],
          });
          reject(error);
        }, 20000);
        this.emit({ ...this.state, status: "loading" });
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
    return this.request({ action, frame });
  }
  async page(action: "page-state" | "page-restore", state?: PageState) {
    const result = (await this.request({ action, page: state })) as { pageResult: unknown };
    return action === "page-state" ? decode(PageStateSchema, result.pageResult) : result.pageResult;
  }
  async parameters(values: Record<string, string | number | boolean> | null) {
    if (!this.state.parameters || !this.state.target)
      throw new Error("请生成新版预览以启用参数试调");
    if (values) parameterValues(this.state.target, {}, values);
    const result = await this.request({ action: "parameters", values });
    this.emit({ ...this.state, draft: values !== null });
    return result;
  }
  private request(message: unknown) {
    if (this.state.status !== "ready") throw new Error("预览未就绪");
    if (this.pending.size >= 8) throw new Error("预览操作过多");
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
      this.port?.postMessage({ id, ...(message as object) });
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

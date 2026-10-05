import { decode, PageStateSchema, type PageState } from "@bcr/work-core";
import type { WorkspaceFiles } from "../workspace/files";
import type { Work } from "./model";

type Report = { level: string; message: string };
function readReport(value: unknown): Report | undefined {
  if (!value || typeof value !== "object") return;
  const report = value as Record<string, unknown>;
  if (typeof report.level !== "string" || typeof report.message !== "string") return;
  return { level: report.level.slice(0, 20), message: report.message.slice(0, 2000) };
}
type State = {
  status: "idle" | "loading" | "ready" | "error";
  id?: string;
  revision?: string;
  reports: readonly Report[];
};
/** Browser runtime adapter. Saved files are never executed by read/commit or plugin startup. */
export class WorkPreview {
  private frame: HTMLIFrameElement | undefined;
  private port: MessagePort | undefined;
  private container: HTMLElement | undefined;
  private cancelStart: (() => void) | undefined;
  private sequence = 0;
  private state: State = { status: "idle", reports: [] };
  private listeners = new Set<() => void>();
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  mount = (node: HTMLDivElement | null) => {
    if (node === (this.container ?? null)) return;
    this.stop();
    this.container = node ?? undefined;
  };
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    for (const fn of this.listeners) fn();
  }
  stop() {
    this.sequence++;
    this.cancelStart?.();
    this.cancelStart = undefined;
    this.port?.close();
    this.port = undefined;
    this.frame?.remove();
    this.frame = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("预览已停止"));
    }
    this.pending.clear();
    this.update({ status: "idle" });
  }
  async start(work: Work, files: WorkspaceFiles, signal?: AbortSignal) {
    this.stop();
    const generation = this.sequence;
    const { workDocument } = await import("./document");
    const source = await workDocument(work, files);
    signal?.throwIfAborted();
    if (generation !== this.sequence) throw new Error("预览已被替换");
    return this.startDocument(work, source, signal);
  }
  async startDocument(
    work: Pick<Work, "id" | "revision" | "title">,
    source: string,
    signal?: AbortSignal,
  ) {
    this.stop();
    const generation = this.sequence;
    this.update({ status: "loading", id: work.id, revision: work.revision, reports: [] });
    try {
      signal?.throwIfAborted();
      if (generation !== this.sequence) throw new Error("预览已被替换");
      const frame = document.createElement("iframe");
      this.frame = frame;
      frame.title = `作品预览：${work.title}`;
      frame.sandbox.add("allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.setAttribute(
        "allow",
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
      );
      if (!this.container)
        frame.style.cssText = "position:fixed;left:-12000px;width:1000px;height:700px;border:0";
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          this.cancelStart = undefined;
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new Error("预览已取消"));
        const timer = setTimeout(() => finish(new Error("预览启动超时")), 8000);
        this.cancelStart = () => finish(new Error("预览已停止"));
        signal?.addEventListener("abort", abort, { once: true });
        frame.onload = () => {
          if (generation !== this.sequence) return finish(new Error("预览已停止"));
          this.port?.close();
          const channel = new MessageChannel();
          this.port = channel.port1;
          channel.port1.onmessage = ({ data }) => {
            if (generation !== this.sequence || !data || typeof data !== "object") return;
            if (data.kind === "ready") {
              const reports = Array.isArray(data.reports)
                ? data.reports.slice(-50).flatMap((r: unknown) => {
                    const report = readReport(r);
                    return report ? [report] : [];
                  })
                : [];
              this.update({ status: "ready", reports });
              finish();
            } else if (data.kind === "log") {
              const report = readReport(data.event);
              if (!report) return;
              this.update({
                reports: [...this.state.reports, report].slice(-50),
              });
            } else if (data.kind === "result" && typeof data.id === "string") {
              const pending = this.pending.get(data.id);
              if (!pending) return;
              this.pending.delete(data.id);
              clearTimeout(pending.timer);
              if (typeof data.error === "string")
                pending.reject(new Error(data.error.slice(0, 2000)));
              else if (typeof data.text !== "string") pending.reject(new Error("无效的预览结果"));
              else
                pending.resolve({
                  text: data.text.slice(0, 12000),
                  pageResult: data.pageResult,
                  value: typeof data.value === "string" ? data.value.slice(0, 2000) : undefined,
                });
            }
          };
          frame.contentWindow?.postMessage("bcr-work-connect", "*", [channel.port2]);
        };
        frame.srcdoc = source;
        (this.container ?? document.body).append(frame);
      });
      return this.getSnapshot();
    } catch (error) {
      if (generation === this.sequence) {
        this.stop();
        this.update({
          status: "error",
          reports: [
            { level: "error", message: String(error instanceof Error ? error.message : error) },
          ],
        });
      }
      throw error;
    }
  }
  async page(action: "page-state" | "page-restore", state?: PageState) {
    const result = (await this.request({ action, page: state })) as { pageResult: unknown };
    return action === "page-state" ? decode(PageStateSchema, result.pageResult) : result.pageResult;
  }
  async inspect(action: "inspect" | "click" | "input", selector?: string, value?: string) {
    return this.request({ action, selector, value });
  }
  private request(message: object) {
    if (this.state.status !== "ready" || !this.port) throw new Error("请先启动预览");
    if (this.pending.size >= 8) throw new Error("预览操作过多");
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("预览无响应，请停止后重试"));
      }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.port!.postMessage({ id, ...message });
    });
  }
}

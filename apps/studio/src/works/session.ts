import { parameterValues, type Job, type Project, type RenderProfile } from "@bcr/work-core";
import type { WorkService } from "./service";

type Values = Record<string, string | number | boolean>;
type State = {
  work: Project;
  targetId: string;
  jobs: Job[];
  params: Values;
  base: string;
  dirty: boolean;
  loadingParams: boolean;
  busy: boolean;
  error: string;
  paramError: string;
  liveError: string;
};

/** A source-bound editing session. Draft preview is ephemeral; rendering always pins saved bytes. */
export class WorkSession {
  private state: State;
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private paramsAbort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private liveTail: Promise<unknown> = Promise.resolve();
  private liveGeneration = 0;
  private draft?: { token: symbol; dispose: () => void };
  private waiting: { id: string; frame: number } | undefined;
  constructor(
    readonly service: WorkService,
    work: Project,
  ) {
    this.state = {
      work,
      targetId: work.targets[0]!.id,
      jobs: [],
      params: {},
      base: "",
      dirty: false,
      loadingParams: false,
      busy: false,
      error: "",
      paramError: "",
      liveError: "",
    };
  }
  get preview() {
    return this.service.runner.preview;
  }
  get target() {
    return (
      this.state.work.targets.find((t) => t.id === this.state.targetId) ??
      this.state.work.targets[0]!
    );
  }
  get activePreview() {
    const p = this.preview.getSnapshot();
    return p.id === this.state.work.ref.id && p.target?.id === this.target.id;
  }
  get canTryParameters() {
    const p = this.preview.getSnapshot();
    return (
      this.activePreview &&
      p.status === "ready" &&
      p.parameters &&
      p.revision === this.state.base &&
      this.state.base === this.state.work.revision
    );
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(next: Partial<State>) {
    if (this.abort.signal.aborted) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private call<T>(op: string, input: unknown, signal = this.abort.signal, owner?: symbol) {
    return this.service.call<T>(this.state.work.ref.sourceId, op, input, signal, owner);
  }
  start() {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.draft = this.service.runner.registerDraft(this.state.work.ref.id, () => this.state.dirty);
    this.loadParams();
    const poll = async () => {
      try {
        await this.refresh();
      } catch (e) {
        if (!signal.aborted) this.patch({ error: String(e) });
      } finally {
        if (!signal.aborted) this.timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => this.close();
  }
  close() {
    this.abort.abort();
    this.paramsAbort?.abort();
    clearTimeout(this.timer);
    clearTimeout(this.liveTimer);
    this.liveGeneration++;
    this.draft?.dispose();
    this.waiting = undefined;
    this.preview.stop();
  }
  update(work: Project) {
    if (
      work.ref.sourceId !== this.state.work.ref.sourceId ||
      work.ref.id !== this.state.work.ref.id
    )
      throw new Error("不能在同一会话中替换作品来源");
    if (work.revision === this.state.work.revision) return;
    this.patch({ work });
    if (!this.state.dirty) this.loadParams();
  }
  selectTarget(id: string) {
    if (this.state.dirty || this.state.busy) return;
    this.waiting = undefined;
    this.liveGeneration++;
    clearTimeout(this.liveTimer);
    this.preview.stop();
    this.patch({ targetId: id });
    this.loadParams();
  }
  setParameter(key: string, value: string | number | boolean) {
    if (this.state.loadingParams || this.state.busy) return;
    const params = { ...this.state.params, [key]: value };
    let paramError = "";
    try {
      parameterValues(this.target, {}, this.declared(params));
    } catch (e) {
      paramError = String(e);
    }
    this.patch({ dirty: true, params, paramError, liveError: "" });
    clearTimeout(this.liveTimer);
    const generation = ++this.liveGeneration;
    this.liveTimer = setTimeout(() => this.syncDraft(generation), 100);
  }
  private declared(params = this.state.params): Values {
    return Object.fromEntries(
      (this.target.runtime === "remotion" ? (this.target.parameters ?? []) : []).map((p) => [
        p.key,
        params[p.key]!,
      ]),
    ) as Values;
  }
  private syncDraft(generation = this.liveGeneration) {
    this.liveTail = this.liveTail
      .catch(() => undefined)
      .then(async () => {
        if (
          this.abort.signal.aborted ||
          generation !== this.liveGeneration ||
          !this.state.dirty ||
          this.state.paramError ||
          !this.canTryParameters
        )
          return;
        try {
          await this.preview.parameters(this.declared());
        } catch (e) {
          if (generation === this.liveGeneration) this.patch({ liveError: String(e) });
        }
      });
  }
  discard() {
    this.liveGeneration++;
    clearTimeout(this.liveTimer);
    this.patch({ dirty: false, paramError: "", liveError: "" });
    this.liveTail = this.liveTail
      .catch(() => undefined)
      .then(async () => {
        if (this.activePreview && this.preview.getSnapshot().draft)
          await this.preview.parameters(null);
      })
      .catch((e) => this.patch({ liveError: String(e) }));
    this.loadParams();
  }
  private loadParams() {
    this.paramsAbort?.abort();
    this.paramsAbort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, this.paramsAbort.signal]),
      { work } = this.state,
      target = this.target;
    this.patch({ params: {}, base: work.revision, loadingParams: true, paramError: "" });
    void (async () => {
      try {
        if (target.runtime === "remotion" && target.propsFile) {
          const file = await this.call<{ text: string; nextOffset: number | null }>(
            "file",
            { id: work.ref.id, revision: work.revision, path: target.propsFile },
            signal,
          );
          if (file.nextOffset) throw new Error("参数文件过大，请在工程目录编辑");
          const params = JSON.parse(file.text) as Values;
          if (!params || typeof params !== "object" || Array.isArray(params))
            throw new Error("参数文件必须是 JSON 对象");
          if (!signal.aborted) this.patch({ params });
        }
      } catch (e) {
        if (!signal.aborted) this.patch({ error: String(e) });
      } finally {
        if (!signal.aborted) this.patch({ loadingParams: false });
      }
    })();
  }
  async run(action: () => Promise<unknown>) {
    if (this.state.busy || this.abort.signal.aborted) return;
    const signal = this.abort.signal;
    this.patch({ busy: true, error: "" });
    try {
      await action();
    } catch (e) {
      if (!signal.aborted) this.patch({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (!signal.aborted) this.patch({ busy: false });
    }
  }
  async refresh() {
    const signal = this.abort.signal,
      jobs = await this.call<Job[]>("jobs", { id: this.state.work.ref.id });
    if (signal.aborted) return;
    this.patch({ jobs });
    const pending = jobs.find((j) => j.id === this.waiting?.id);
    if (pending?.status === "succeeded") {
      const frame = this.waiting!.frame;
      this.waiting = undefined;
      await this.service.startPreview(this.state.work.ref, pending.id, signal);
      if (this.target.runtime === "remotion")
        await this.preview.inspect("seek", Math.min(frame, this.target.durationInFrames - 1));
      this.syncDraft();
    } else if (pending && ["failed", "cancelled", "interrupted"].includes(pending.status)) {
      this.waiting = undefined;
      this.patch({ error: pending.error ?? "预览构建已结束" });
    }
  }
  async saveParameters() {
    if (this.state.paramError) throw new Error(this.state.paramError);
    const { work, base } = this.state,
      target = this.target;
    if (target.runtime !== "remotion") return;
    const next = await this.call<Project>(
      "parameters",
      {
        id: work.ref.id,
        revision: base,
        target: target.id,
        requestId: crypto.randomUUID(),
        values: this.declared(),
      },
      this.abort.signal,
      this.draft?.token,
    );
    this.liveGeneration++;
    this.patch({ dirty: false, work: next });
    this.loadParams();
    if (this.activePreview) await this.render("preview", "draft");
  }
  async render(
    kind: Job["request"]["kind"],
    profile: RenderProfile,
    options: { from?: number; to?: number; frames?: number[] } = {},
  ) {
    if (this.state.dirty) throw new Error("请先保存或撤销参数草稿");
    const { work } = this.state,
      target = this.target;
    const frame = this.activePreview ? (this.preview.getSnapshot().frame ?? 0) : 0;
    const job = await this.call<Job>("render", {
      id: work.ref.id,
      revision: work.revision,
      target: target.id,
      kind,
      requestId: crypto.randomUUID(),
      ...(kind === "capture" && target.runtime === "remotion"
        ? { frames: [Math.min(target.durationInFrames - 1, frame)] }
        : {}),
      ...(["video", "capture", "validate"].includes(kind) ? { profile } : {}),
      ...options,
    });
    if (kind === "preview") this.waiting = { id: job.id, frame };
    this.patch({ jobs: [job, ...this.state.jobs.filter((j) => j.id !== job.id)] });
  }
  cancel(jobId: string) {
    return this.call("cancel", { id: jobId });
  }
  stopPreview() {
    this.waiting = undefined;
    this.preview.stop();
  }
}

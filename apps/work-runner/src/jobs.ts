import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decode, Id, RenderSchema, type Job } from "@bcr/work-core";
import { atomic, hash, json, Projects } from "./projects";
import { workerEntry } from "./installation";

const terminal = new Set<Job["status"]>(["succeeded", "failed", "cancelled", "interrupted"]);
export class Jobs {
  private readonly items = new Map<string, Job>();
  private active: { job: Job; child: ChildProcess } | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    readonly projects: Projects,
    readonly engine: string,
  ) {
    mkdirSync(join(projects.state, "jobs"), { recursive: true });
    for (const id of readdirSync(join(projects.state, "jobs"))) {
      const path = join(this.directory(id), "job.json");
      if (!existsSync(path)) continue;
      const job = json(path) as Job;
      if (!terminal.has(job.status)) {
        job.status = "interrupted";
        job.error = "Runner 重启中断了任务，请使用新的 requestId 重试";
        this.save(job);
      }
      this.items.set(job.id, job);
    }
  }
  directory(id: string) {
    return join(this.projects.state, "jobs", decode(Id, id));
  }
  private save(job: Job) {
    job.updatedAt = Date.now();
    atomic(join(this.directory(job.id), "job.json"), JSON.stringify(job));
  }
  list(id?: string) {
    return [...this.items.values()]
      .filter((j) => !id || j.request.id === id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  }
  get(id: string) {
    const job = this.items.get(id);
    if (!job) throw new Error("任务不存在");
    return job;
  }
  start(raw: unknown) {
    if (this.closed) throw new Error("Runner 已关闭");
    const request = decode(RenderSchema, raw);
    const old = [...this.items.values()].find(
      (j) => j.request.id === request.id && j.request.requestId === request.requestId,
    );
    if (old) {
      if (JSON.stringify(old.request) !== JSON.stringify(request))
        throw new Error("requestId 已用于其他任务");
      return old;
    }
    if (this.list().filter((j) => !terminal.has(j.status)).length >= 20)
      throw new Error("渲染队列已满");
    const project = this.projects.snapshot(request.id, request.revision);
    const target = project.targets.find((t) => t.id === request.target);
    if (!target) throw new Error("目标不存在");
    if (target.runtime === "html" && ["capture", "video"].includes(request.kind))
      throw new Error("HTML 目标不支持视频或关键帧导出");
    if (
      target.runtime === "remotion" &&
      ((request.to ?? 0) >= target.durationInFrames ||
        (request.from ?? 0) > (request.to ?? target.durationInFrames - 1) ||
        request.frames?.some((f) => f >= target.durationInFrames))
    )
      throw new Error("帧范围超出作品时长");
    const { requestId: _requestId, ...identity } = request;
    const job: Job = {
      id: randomUUID(),
      request,
      renderKey: hash(JSON.stringify({ identity, engine: this.engine })),
      status: "queued",
      progress: 0,
      stage: "等待渲染",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [],
      outputs: [],
    };
    atomic(
      join(this.directory(job.id), "input.json"),
      JSON.stringify({ project, request, source: this.projects.source(request.revision) }),
    );
    this.save(job);
    this.items.set(job.id, job);
    queueMicrotask(() => this.pump());
    return job;
  }
  private pump() {
    if (this.closed || this.active) return;
    const job = [...this.items.values()].find((j) => j.status === "queued");
    if (!job) return;
    job.status = "running";
    job.stage = "启动渲染";
    this.save(job);
    const child = spawn(process.execPath, [workerEntry, this.directory(job.id)], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cwd: this.directory(job.id),
    });
    this.active = { job, child };
    let buffer = "",
      error = "",
      lastSave = 0;
    const timeout = setTimeout(
      () => {
        error = "渲染超过 30 分钟，请缩短范围后重试";
        this.kill(child);
      },
      30 * 60 * 1000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer = (buffer + chunk.toString()).slice(-32000);
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        try {
          const value = JSON.parse(line) as { progress: number; stage: string };
          if (Number.isFinite(value.progress) && typeof value.stage === "string") {
            job.progress = value.progress;
            job.stage = value.stage.slice(0, 200);
          }
        } catch {
          job.logs = [...job.logs, line.slice(0, 2000)].slice(-40);
        }
      }
      if (Date.now() - lastSave > 500) {
        this.save(job);
        lastSave = Date.now();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-8000);
    });
    child.on("error", (e) => {
      error = String(e);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (job.status !== "cancelled" && job.status !== "interrupted") {
        job.status = code === 0 ? "succeeded" : "failed";
        if (code !== 0) job.error = error || `渲染进程退出：${code}`;
        else {
          job.progress = 1;
          job.stage = "完成";
          const outputs = join(this.directory(job.id), "outputs");
          try {
            job.outputs = readdirSync(outputs).map((name) => {
              const bytes = readFileSync(join(outputs, name));
              return { name, size: bytes.length, hash: hash(bytes) };
            });
          } catch (cause) {
            job.status = "failed";
            job.outputs = [];
            job.error = `产物校验失败：${String(cause)}`;
          }
        }
      }
      if (error) job.logs = [...job.logs, error].slice(-40);
      this.save(job);
      this.active = undefined;
      this.pump();
    });
  }
  private kill(child: ChildProcess) {
    if (!child.pid) return;
    const pid = child.pid;
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-pid, name);
      } catch {
        /* Already exited. */
      }
    };
    signal("SIGTERM");
    const timer = setTimeout(() => signal("SIGKILL"), 2000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }
  cancel(id: string) {
    const job = this.get(id);
    if (terminal.has(job.status)) return job;
    job.status = "cancelled";
    job.stage = "已取消";
    this.save(job);
    if (this.active?.job.id === id) this.kill(this.active.child);
    return job;
  }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const job of this.items.values())
      if (!terminal.has(job.status)) {
        job.status = "interrupted";
        job.error = "Runner 已停止";
        this.save(job);
      }
    if (!this.active) return (this.closing = Promise.resolve());
    const child = this.active.child;
    this.closing = new Promise<void>((resolve) => child.once("close", () => resolve()));
    this.kill(child);
    return this.closing;
  }
}

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CheckpointSchema,
  RestoreSchema,
  DiffSchema,
  VersionListSchema,
  ParamsSchema,
  decode,
  changedFiles,
  type VersionEntry,
  type VersionPage,
  type VersionDiff,
  type RestoreRequest,
  type Project,
} from "@bcr/work-core";
import { atomic, hash, json, type Projects } from "./projects";

type Ledger = {
  items: VersionEntry[];
  receipts: Record<string, { digest: string; revision: string }>;
  pending?: { input: RestoreRequest; digest: string; before: Project; after: Project };
};
/** Checkpoints reference existing snapshots; source bytes and Git remain owned by the project. */
export class VersionRepository {
  constructor(private projects: Projects) {}
  private path(id: string) {
    return join(this.projects.state, "versions", `${id}.json`);
  }
  private read(id: string): Ledger {
    return existsSync(this.path(id))
      ? (json(this.path(id)) as Ledger)
      : { items: [], receipts: {} };
  }
  private write(id: string, ledger: Ledger) {
    if (ledger.items.length > 5000 || Object.keys(ledger.receipts).length > 10000)
      throw new Error("版本记录超过上限");
    atomic(this.path(id), JSON.stringify(ledger));
  }
  discovery() {
    const result = this.projects.list(),
      directory = join(this.projects.state, "versions");
    if (!existsSync(directory)) return result;
    for (const file of readdirSync(directory)) {
      if (!/^[a-zA-Z0-9_-]{1,100}\.json$/u.test(file)) continue;
      const ledger = json(join(directory, file)) as Ledger;
      if (!ledger.pending) continue;
      const project = ledger.pending.before;
      result.items = [...result.items.filter((p) => p.ref.id !== project.ref.id), project];
      result.errors.push({
        directory: project.directory,
        message: "恢复尚未完成，请打开此作品的版本历史继续恢复",
      });
    }
    return result;
  }
  assertReady(id: string) {
    const ledger = this.read(id);
    if (ledger.pending)
      throw new Error("上次恢复尚未完成，请在版本历史中继续恢复，或使用原 requestId 重试");
  }
  list(raw: unknown): VersionPage {
    const { id, cursor } = decode(VersionListSchema, raw),
      ledger = this.read(id);
    const head = ledger.pending ? ledger.pending.input.revision : this.projects.read(id).revision;
    const items = [...ledger.items].reverse(),
      known = new Set(items.map((v) => v.revision));
    const directory = join(this.projects.state, "snapshots");
    const snapshots: VersionEntry[] = [];
    if (existsSync(directory))
      for (const revision of readdirSync(directory)) {
        if (!/^[a-f0-9]{64}$/u.test(revision) || known.has(revision)) continue;
        const path = join(directory, revision, "manifest.json");
        if (!existsSync(path)) continue;
        const project = json(path) as Project;
        if (project.ref.id === id)
          snapshots.push({
            id: revision,
            revision,
            parent: null,
            message: "已捕获的源码快照",
            kind: "snapshot",
            createdAt: statSync(path).mtimeMs,
          });
      }
    items.push(...snapshots.sort((a, b) => b.createdAt - a.createdAt));
    const offset = cursor ? items.findIndex((v) => v.id === cursor) : 0;
    if (offset < 0) throw new Error("版本分页位置无效，请刷新");
    return {
      head,
      items: items.slice(offset, offset + 30),
      nextCursor: items[offset + 30]?.id ?? null,
      ...(ledger.pending ? { pending: ledger.pending.input } : {}),
    };
  }
  capture(id: string, revision: string, message: string, kind: VersionEntry["kind"] = "snapshot") {
    this.assertReady(id);
    this.projects.snapshot(id, revision);
    const ledger = this.read(id);
    if (ledger.items.at(-1)?.revision === revision) return;
    ledger.items.push({
      id: randomUUID(),
      revision,
      parent: ledger.items.at(-1)?.revision ?? null,
      message,
      kind,
      createdAt: Date.now(),
    });
    this.write(id, ledger);
  }
  checkpoint(raw: unknown) {
    const input = decode(CheckpointSchema, raw),
      ledger = this.read(input.id),
      digest = hash(JSON.stringify(input));
    const receipt = Object.hasOwn(ledger.receipts, input.requestId)
      ? ledger.receipts[input.requestId]
      : undefined;
    if (receipt) {
      if (receipt.digest !== digest) throw new Error("requestId 已用于不同的版本操作");
      return this.projects.snapshot(input.id, receipt.revision);
    }
    this.assertReady(input.id);
    if (this.projects.read(input.id).revision !== input.revision)
      throw new Error("作品版本冲突，请刷新后重试");
    const project = this.projects.snapshot(input.id, input.revision);
    ledger.items.push({
      id: randomUUID(),
      revision: input.revision,
      parent: ledger.items.at(-1)?.revision ?? null,
      message: input.message,
      kind: "checkpoint",
      createdAt: Date.now(),
    });
    Object.defineProperty(ledger.receipts, input.requestId, {
      value: { digest, revision: project.revision },
      enumerable: true,
    });
    this.write(input.id, ledger);
    return project;
  }
  parameters(raw: unknown) {
    const input = decode(ParamsSchema, raw);
    this.assertReady(input.id);
    if (this.projects.read(input.id).revision === input.revision) {
      if (this.read(input.id).items.length > 4998) throw new Error("版本记录超过上限");
      this.capture(input.id, input.revision, "调整参数前", "checkpoint");
    }
    const next = this.projects.parameters(input);
    if (this.projects.read(input.id).revision === next.revision)
      this.capture(input.id, next.revision, "保存参数", "save");
    return next;
  }
  restore(raw: unknown) {
    const input = decode(RestoreSchema, raw),
      digest = hash(JSON.stringify(input));
    let ledger = this.read(input.id);
    const receipt = Object.hasOwn(ledger.receipts, input.requestId)
      ? ledger.receipts[input.requestId]
      : undefined;
    if (receipt) {
      if (receipt.digest !== digest) throw new Error("requestId 已用于不同的版本操作");
      return this.projects.snapshot(input.id, receipt.revision);
    }
    if (ledger.pending && ledger.pending.digest !== digest)
      throw new Error("另一次恢复尚未完成，请使用原 requestId 继续");
    if (!ledger.pending) {
      if (ledger.items.length > 4998 || Object.keys(ledger.receipts).length >= 10000)
        throw new Error("版本记录超过上限");
      const current = this.projects.read(input.id);
      if (current.revision !== input.revision) throw new Error("作品版本冲突，请刷新后重试");
      const after = this.projects.snapshot(input.id, input.restoreRevision);
      this.capture(input.id, current.revision, "恢复前的检查点", "checkpoint");
      ledger = this.read(input.id);
      this.projects.applySnapshot(current, after, true);
      ledger.pending = {
        input,
        digest,
        before: this.projects.snapshot(input.id, current.revision),
        after,
      };
      this.write(input.id, ledger); // Durable intent before any source file changes.
    }
    const pending = ledger.pending!;
    const restored = this.projects.applySnapshot(pending.before, pending.after);
    ledger.items.push({
      id: randomUUID(),
      revision: restored.revision,
      parent: input.revision,
      restoredFrom: input.restoreRevision,
      message: `从 ${input.restoreRevision.slice(0, 8)} 恢复`,
      kind: "restore",
      createdAt: Date.now(),
    });
    Object.defineProperty(ledger.receipts, input.requestId, {
      value: { digest, revision: restored.revision },
      enumerable: true,
    });
    delete ledger.pending;
    this.write(input.id, ledger);
    return restored;
  }
  diff(raw: unknown): VersionDiff {
    const { id, from, to, path } = decode(DiffSchema, raw);
    const a = this.projects.snapshot(id, from),
      b = this.projects.snapshot(id, to);
    const changes = changedFiles(a.files, b.files);
    const diff: VersionDiff = { from, to, changes };
    if (path) {
      const read = (project: Project) => {
        const file = project.files.find((f) => f.path === path);
        if (!file) return null;
        if (file.size > 64000) return undefined;
        const bytes = this.projects.file(id, project.revision, path);
        if (bytes.includes(0)) return undefined;
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return undefined;
        }
      };
      if (!a.files.some((f) => f.path === path) && !b.files.some((f) => f.path === path))
        throw new Error("版本中没有此文件");
      const before = read(a),
        after = read(b);
      diff.detail = {
        path,
        before: before ?? null,
        after: after ?? null,
        ...(before === undefined || after === undefined
          ? { message: "二进制或超过 64 KB，仅显示文件差异" }
          : {}),
      };
    }
    return diff;
  }
}

import type { RuntimeMetadata } from "@bcr/core";
import { EMPTY_RESEARCH, RESEARCH_KEY, decodeResearch, type ResearchLibrary } from "./model";

/** Writes are serialized and published only after persistence succeeds. */
export class ResearchStore {
  private closed = false;
  private value: ResearchLibrary = EMPTY_RESEARCH;
  private restoreReceipt: string | undefined;
  private reloadRequired = false;
  private tail: Promise<unknown> = Promise.resolve();
  private packageTail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  readonly ready: Promise<void>;
  constructor(private readonly metadata: RuntimeMetadata | undefined) {
    this.ready = this.load();
    // Consumers receive the original rejection through ready; discarded React renders
    // must not create an unhandled rejection before their effect subscribes.
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地元数据不可用，无法保存资料集合");
    const raw = await this.metadata.get(RESEARCH_KEY);
    const library = decodeResearch(raw);
    this.value = { version: 1, collections: library.collections };
    this.restoreReceipt = raw ? JSON.parse(raw).packageRestoreReceipt : undefined;
    this.emit();
  }
  readPackageRecord(
    kind: "export" | "restore" | "recovery" | "recovery-snapshot",
  ): Promise<string | undefined> {
    if (this.closed) return Promise.reject(new Error("资料集合已关闭"));
    const operation = this.packageTail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        return this.metadata!.get(`workspace/research-package-${kind}.v1`);
      });
    this.packageTail = operation;
    return operation;
  }
  writePackageRecord(
    kind: "export" | "restore" | "recovery" | "recovery-snapshot",
    raw: string,
  ): Promise<void> {
    if (this.closed) return Promise.reject(new Error("资料集合已关闭"));
    const operation = this.packageTail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        await this.metadata!.set(`workspace/research-package-${kind}.v1`, raw);
      });
    this.packageTail = operation;
    return operation;
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  update(change: (current: ResearchLibrary) => ResearchLibrary): Promise<void> {
    return this.writeLibrary(change);
  }
  hasRestoredPackage(id: string): Promise<boolean> {
    if (this.closed) return Promise.reject(new Error("资料集合已关闭"));
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        await this.load();
        this.reloadRequired = false;
        return this.restoreReceipt === id;
      });
    this.tail = operation;
    return operation;
  }
  updateRestoredPackage(id: string, change: (current: ResearchLibrary) => ResearchLibrary) {
    return this.writeLibrary(change, id);
  }
  private writeLibrary(
    change: (current: ResearchLibrary) => ResearchLibrary,
    receipt?: string,
  ): Promise<void> {
    if (this.closed) return Promise.reject(new Error("资料集合已关闭"));
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        // Re-read durable data after a write that might have committed before rejecting.
        if (receipt || this.reloadRequired) await this.load();
        this.reloadRequired = false;
        if (receipt && this.restoreReceipt === receipt) return;
        const next = change(this.value);
        const nextReceipt = receipt ?? this.restoreReceipt;
        const raw = JSON.stringify({
          ...next,
          ...(nextReceipt ? { packageRestoreReceipt: nextReceipt } : {}),
        });
        decodeResearch(raw);
        try {
          await this.metadata!.set(RESEARCH_KEY, raw);
        } catch (error) {
          this.reloadRequired = true;
          throw error;
        }
        this.restoreReceipt = nextReceipt;
        this.value = next;
        this.emit();
      });
    this.tail = operation;
    return operation;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.ready.catch(() => undefined);
    await Promise.all([this.tail.catch(() => undefined), this.packageTail.catch(() => undefined)]);
  }
}

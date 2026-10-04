import type { WorkSummary } from "@bcr/work-core";
import type { WorkStore } from "./store";
import { LocalRunner } from "./local";

/** Provider routing only. Browser storage and filesystem execution retain their own lifecycles. */
export class WorkService {
  readonly local = new LocalRunner();
  constructor(readonly browser: WorkStore) {}
  async list(): Promise<WorkSummary[]> {
    await this.browser.refresh();
    await this.local.refresh();
    return [
      ...this.browser.getSnapshot().map((w): WorkSummary => ({
        ref: { provider: "browser", id: w.id },
        title: w.title,
        revision: w.revision,
        targets: w.entry ? [{ id: "page", runtime: "html", entry: w.entry }] : [],
        capabilities: ["read", "commit", "history", "preview", "archive"],
      })),
      ...this.local.getSnapshot().items.map(({ ref, title, revision, targets, capabilities }) => ({
        ref,
        title,
        revision,
        targets,
        capabilities,
      })),
    ];
  }
  close() {
    this.local.disconnect();
  }
}

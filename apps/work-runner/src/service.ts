import { RUNNER_PROTOCOL, type RunnerCatalog } from "@bcr/work-core";
import { randomUUID } from "node:crypto";
import { PageCaptures } from "./page-captures";
import { ReviewRepository } from "./review";
import { VersionRepository } from "./versions";
import { Jobs } from "./jobs";
import { Projects } from "./projects";
import { engineIdentity, release } from "./installation";
import { operationCatalog, operationInput } from "./operations";

/** Shared local execution service. Transports own authentication and serialization. */
export class RunnerService {
  readonly projects: Projects;
  readonly jobs: Jobs;
  readonly review: ReviewRepository;
  readonly versions: VersionRepository;
  readonly captures: PageCaptures;
  readonly engine = engineIdentity();
  readonly instanceId = randomUUID();
  constructor(
    root: string,
    state: string,
    readonly origin: string,
  ) {
    this.projects = new Projects(root, state);
    this.jobs = new Jobs(this.projects, this.engine);
    this.review = new ReviewRepository(this.projects, this.jobs);
    this.versions = new VersionRepository(this.projects);
    this.captures = new PageCaptures(this.projects, this.jobs, this.review, this.engine);
    this.review.validateView = (id, view) => this.captures.validate(id, view);
  }
  catalog(): RunnerCatalog {
    return {
      format: RUNNER_PROTOCOL,
      version: release().version,
      engine: this.engine,
      root: this.projects.root,
      runtimes: ["html", "remotion"],
      operations: operationCatalog.map((o) => o.name),
      origin: this.origin,
      provider: "local",
      sourceId: this.projects.sourceId,
      instanceId: this.instanceId,
      pid: process.pid,
    };
  }
  call(name: string, raw: unknown, preview: (id: string) => unknown): unknown {
    const input = operationInput(name, raw),
      id = input.id as string;
    switch (name) {
      case "page_capture":
        return this.captures.capture(input);
      case "page_capture_read":
        return this.captures.read(id);
      case "versions":
        return this.versions.list(input);
      case "checkpoint":
        return this.versions.checkpoint(input);
      case "diff":
        return this.versions.diff(input);
      case "restore":
        return this.versions.restore(input);
      case "catalog":
        return this.catalog();
      case "list":
        return this.versions.discovery();
      case "read":
        return input.revision
          ? this.projects.snapshot(id, input.revision as string)
          : this.projects.read(id);
      case "snapshot":
        return this.projects.snapshot(id, input.revision as string);
      case "file": {
        const path = input.path as string,
          revision = input.revision as string;
        const bytes = this.projects.file(id, revision, path),
          offset = (input.offset as number | undefined) ?? 0;
        if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0))
          return { id, revision, path, size: bytes.length, binary: true };
        const text = bytes.toString();
        return {
          id,
          revision,
          path,
          text: text.slice(offset, offset + 32000),
          nextOffset: offset + 32000 < text.length ? offset + 32000 : null,
        };
      }
      case "parameters":
        return this.versions.parameters(input);
      case "review_read":
        return this.review.read(id);
      case "review_edit":
        return this.review.edit(input);
      case "reviews":
        return this.projects.reviews(id);
      case "review":
        return this.projects.review(input);
      case "render":
        this.versions.assertReady(id);
        return this.jobs.start(input);
      case "jobs":
        return this.jobs.list(id);
      case "job":
        return this.jobs.get(id);
      case "cancel":
        return this.jobs.cancel(id);
      case "preview":
        return preview(id);
      default:
        throw new Error(`未知 Runner 操作：${name}`);
    }
  }
  close() {
    return Promise.all([this.jobs.close(), this.captures.close()]);
  }
}

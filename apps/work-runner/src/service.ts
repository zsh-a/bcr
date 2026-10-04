import { RUNNER_PROTOCOL, type RunnerCatalog } from "@bcr/work-core";
import { randomUUID } from "node:crypto";
import { Jobs } from "./jobs";
import { Projects } from "./projects";
import { engineIdentity, release } from "./installation";
import { operationCatalog, operationInput } from "./operations";

/** Shared local execution service. Transports own authentication and serialization. */
export class RunnerService {
  readonly projects: Projects;
  readonly jobs: Jobs;
  readonly engine = engineIdentity();
  readonly instanceId = randomUUID();
  constructor(
    root: string,
    state: string,
    readonly origin: string,
  ) {
    this.projects = new Projects(root, state);
    this.jobs = new Jobs(this.projects, this.engine);
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
      instanceId: this.instanceId,
      pid: process.pid,
    };
  }
  call(name: string, raw: unknown, preview: (id: string) => unknown): unknown {
    const input = operationInput(name, raw),
      id = input.id as string;
    switch (name) {
      case "catalog":
        return this.catalog();
      case "list":
        return this.projects.list();
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
        return this.projects.parameters(input);
      case "reviews":
        return this.projects.reviews(id);
      case "review":
        return this.projects.review(input);
      case "render":
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
    return this.jobs.close();
  }
}

import { join } from "node:path";
import type { Project, RenderRequest } from "@bcr/work-core";
import { json } from "./projects";
import { execute } from "./runtime";

const directory = process.argv[2]!;
const input = json(join(directory, "input.json")) as {
  source: string;
  project: Project;
  request: RenderRequest;
};
const abort = new AbortController();
process.on("SIGTERM", () => abort.abort());
try {
  await execute({
    directory,
    ...input,
    signal: abort.signal,
    report: (progress, stage) => process.stdout.write(`${JSON.stringify({ progress, stage })}\n`),
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}

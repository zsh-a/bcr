import { basename, resolve } from "node:path";
import { definition } from "@bcr/work-core";
import { createProject } from "@bcr/work-engine";
import { readFileSync } from "node:fs";

export interface ScaffoldOptions {
  directory: string;
  template?: string;
  id?: string;
  title?: string;
  install?: boolean;
}

/** The compatibility create command uses the canonical video template. */
export async function scaffold(options: ScaffoldOptions) {
  if (options.template && !["video", "starter"].includes(options.template)) {
    throw new Error(`模板不存在：${options.template}`);
  }
  const directory = resolve(options.directory);
  const id =
    options.id ??
    basename(directory)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80);
  const result = await createProject(directory, id, {
    title:
      options.title ??
      id
        .split("-")
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" "),
    install: options.install,
  });
  const work = definition(JSON.parse(readFileSync(`${result.path}/work.json`, "utf8")));
  return { directory, template: "video", work };
}

import { existsSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { definition, type Definition } from "@bcr/work-core";
import { installation } from "./installation";

const safeTemplate = /^[a-z][a-z0-9_-]{0,63}$/u;
const safeSlug = /^[a-zA-Z0-9_-]{1,100}$/u;

export type ScaffoldOptions = {
  directory: string;
  template: string;
  id?: string;
  title?: string;
};

export type ScaffoldResult = {
  directory: string;
  template: string;
  work: Pick<Definition, "id" | "title" | "defaultTarget" | "targets">;
};

function defaultId(directory: string) {
  const value = basename(resolve(directory))
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 100);
  return value || "work";
}

function defaultTitle(id: string) {
  return id
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

/** Copy an installed Work template and apply only identity-level customization. */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const directory = resolve(options.directory);
  if (existsSync(directory)) throw new Error("工程目录已存在");
  if (!safeTemplate.test(options.template)) throw new Error("模板名称无效");

  const template = resolve(installation, options.template);
  if (!existsSync(join(template, "work.json")))
    throw new Error(`模板不存在或缺少 work.json：${options.template}`);

  const source = definition(JSON.parse(readFileSync(join(template, "work.json"), "utf8")));
  const id = options.id ?? (options.template === "starter" ? defaultId(directory) : source.id);
  const title = options.title ?? (options.template === "starter" ? defaultTitle(id) : source.title);
  if (!safeSlug.test(id)) throw new Error("作品 ID 只能包含字母、数字、下划线和连字符");
  if (!title.trim() || title.length > 200) throw new Error("作品标题不能为空且不能超过 200 个字符");

  const work = definition({ ...source, id, title });
  cpSync(template, directory, { recursive: true, errorOnExist: true, force: false });
  writeFileSync(join(directory, "work.json"), `${JSON.stringify(work, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    directory,
    template: options.template,
    work: {
      id: work.id,
      title: work.title,
      ...(work.defaultTarget ? { defaultTarget: work.defaultTarget } : {}),
      targets: work.targets,
    },
  };
}

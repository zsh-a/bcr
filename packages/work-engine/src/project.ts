import { existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileMap, hashFile, inside, json, sha, sourceGraph, stable, walk } from './lib/files';
import { packageArchives } from './lib/package-archives';
import { engineLock, ROOT, TOOLS } from './lib/paths';
export interface Parameter {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
}
export interface Target {
  id: string;
  runtime: string;
  entry: string;
  width?: number | undefined;
  height?: number | undefined;
  fps?: number | undefined;
  durationInFrames?: number | undefined;
  propsFile?: string | undefined;
  exportName?: string | undefined;
  assets?: readonly string[] | undefined;
  parameters?: readonly Parameter[] | undefined;
}
export interface Config {
  version: number;
  privateAssets: string[];
  webgl?: boolean;
  stage?: 'draft' | 'production';
  experiments?: string;
  runtime?: {
    cues: string;
    timing: string;
    events: string;
  };
  scenes?: {
    catalog: string;
    target?: string;
    progress?: { color: string; height: number; endChapter: string };
  };
  validation?: { target?: string; checks: { id: string; command: string[] }[] };
  storage?: { sources?: string[]; experiments?: string[]; backupDirectory?: string };
  audio?: {
    driver: 'standard' | 'scripted';
    directory?: string;
    subtitlesDirectory?: string;
    content?: string;
    voice?: string;
    timeline: string;
    plan: string;
    mastering: string;
    quality: string;
    score: string;
    env?: Record<string, string>;
    prepare?: string[];
  };
  targets: Record<string, { audio?: string; assets?: string[]; renderer?: 'player' }>;
}
export interface Work {
  format?: string;
  id: string;
  title?: string;
  defaultTarget?: string;
  targets: Target[];
}
export interface Workspace {
  version: number;
  storageId?: string;
  cacheBudgetGiB: number;
  projects: { id: string; role: string }[];
}
export interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  scripts?: Record<string, string>;
}
export function validateProjectId(id: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id.length > 80) {
    throw new Error('工程 ID 需为小写字母、数字和连字符，长度不超过 80');
  }
}
export function workspace(root = ROOT): Workspace {
  const value = json<Workspace>(join(root, 'workspace.json'));
  if (value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error('工作区配置格式不匹配');
  }
  return value;
}
export function project(id: string, workspaceRoot = ROOT) {
  validateProjectId(id);
  const registration = workspace(workspaceRoot).projects.find((p) => p.id === id);
  if (!registration) {
    throw new Error(`工程未登记: ${id}`);
  }
  const root = inside(workspaceRoot, id);
  const current = loadProject(root, registration.role);
  if (current.id !== id) {
    throw new Error('工程 ID 与登记不匹配');
  }
  return current;
}
/** Resolve authored targets from disk or from an already captured source file set. */
export function readProjectDefinition(
  root: string,
  read: (path: string) => unknown = (path) => {
    const file = inside(root, path);
    return existsSync(file) ? json(file) : undefined;
  },
) {
  const work = read('work.json') as Work | undefined;
  const config = (read('production.json') ?? {
    version: 1,
    privateAssets: ['audio/reference.wav'],
    targets: {},
  }) as Config;
  if (!work || !Array.isArray(work.targets) || config.version !== 1) {
    throw new Error('工程配置不匹配');
  }
  const experimentIds = new Set<string>();
  let targets = work.targets;
  if (config.experiments) {
    inside(root, config.experiments);
    const experiments = read(config.experiments) as
      | { version: number; targets: Target[] }
      | undefined;
    if (experiments?.version !== 1 || !Array.isArray(experiments.targets)) {
      throw new Error('实验清单格式不匹配');
    }
    targets = [...targets, ...experiments.targets];
    for (const target of experiments.targets) {
      experimentIds.add(target.id);
    }
  }
  if (new Set(targets.map((target) => target.id)).size !== targets.length) {
    throw new Error('目标 ID 重复');
  }
  for (const target of targets) {
    inside(root, target.entry);
  }
  return { work: { ...work, targets }, config, experimentIds };
}
export function loadProject(root: string, role = 'unmanaged'): Project {
  const { work, config, experimentIds } = readProjectDefinition(root);
  return {
    id: work.id,
    root,
    work,
    config,
    role,
    experimentIds,
  };
}
export interface Project {
  id: string;
  root: string;
  work: Work;
  config: Config;
  role: string;
  experimentIds?: ReadonlySet<string>;
  frozen?: boolean;
}
export function targetOf(p: Project, name?: string): Target {
  const id =
    name ?? p.work.defaultTarget ?? p.work.targets.find((t) => t.runtime === 'remotion')?.id;
  const target = p.work.targets.find((t) => t.id === id);
  if (!target) {
    throw new Error(`找不到目标: ${name}`);
  }
  return target;
}
export function assets(p: Project, target: Target): string[] {
  const dir = join(p.root, 'public');
  const policy = p.config.targets[target.id];
  const allowed = policy?.assets;
  return walk(dir).filter((f) => {
    const name = relative(dir, f);
    if (
      p.config.privateAssets.some((x) => name === x || name.startsWith(`${x.replace(/\/$/, '')}/`))
    ) {
      return false;
    }
    if (allowed) {
      return allowed.some((x) => name === x || name.startsWith(`${x.replace(/\/$/, '')}/`));
    }
    // Fonts and images are runtime assets; documentation and unrelated audio are not.
    return (
      !['.md', '.txt'].includes(extname(f)) &&
      (!name.startsWith('audio/') || policy === undefined || name === policy.audio)
    );
  });
}
export function targetIdentity(p: Project, t: Target) {
  const files = sourceGraph(p.root, t.entry);
  if (t.propsFile) {
    files.push(inside(p.root, t.propsFile));
  }
  files.push(...(t.assets ?? []).map((path) => inside(p.root, path)));
  for (const file of ['bun.lock', 'package.json', 'tsconfig.json']) {
    if (existsSync(join(p.root, file))) {
      files.push(join(p.root, file));
    }
  }
  const manifest = join(p.root, 'package.json');
  if (existsSync(manifest)) {
    const pkg = json<PackageManifest>(manifest);
    files.push(
      ...packageArchives(p.root, {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.overrides,
      }).map((archive) => archive.path),
    );
  }
  files.push(...assets(p, t));
  const map = fileMap(p.root, files);
  const toolFiles = walk(join(TOOLS, 'src')).concat([join(TOOLS, 'package.json')]);
  const engine = sha(stable({ files: fileMap(TOOLS, toolFiles), lock: hashFile(engineLock()) }));
  const key = sha(
    stable({
      target: t,
      files: map,
      engine,
      policy: p.config.targets[t.id],
      privateAssets: p.config.privateAssets,
      webgl: !!p.config.webgl,
      scenes: p.config.scenes,
      runtime: p.config.runtime,
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  return { key, files: map, engine };
}

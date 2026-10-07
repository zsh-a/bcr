import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sha } from './files';

export function workspaceRoot() {
  if (process.env.BCR_WORK_ROOT) {
    return resolve(process.env.BCR_WORK_ROOT);
  }
  const args = process.argv.slice(2);
  const flag = args.indexOf('--root');
  const explicit = args.find((arg) => arg.startsWith('--root='))?.slice(7) ?? args[flag + 1];
  if (flag >= 0 || args.some((arg) => arg.startsWith('--root='))) {
    if (!explicit) {
      throw new Error('--root 需要工程工作区目录');
    }
    return resolve(explicit);
  }
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, 'workspace.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const connection = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'bcr/work-runner.json',
  );
  if (existsSync(connection)) {
    const saved = JSON.parse(readFileSync(connection, 'utf8')) as { options?: { root?: string } };
    if (saved.options?.root) {
      return resolve(saved.options.root);
    }
  }
  return process.cwd();
}

export const ROOT = workspaceRoot();
const sourceRoot = resolve(import.meta.dir, '../..');
export const TOOLS = resolve(
  process.env.BCR_WORK_ENGINE ??
    (existsSync(join(sourceRoot, 'templates/video'))
      ? sourceRoot
      : join(import.meta.dir, '../engine')),
);
export const MIGRATIONS = join(ROOT, '.bcr/migrations');
const requireEngine = createRequire(join(TOOLS, 'package.json'));
export function dependencyPath(name: string) {
  return dirname(requireEngine.resolve(`${name}/package.json`));
}
export function engineLock() {
  let current = TOOLS;
  while (!existsSync(join(current, 'bun.lock'))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('缺少 BCR Bun 依赖锁');
    }
    current = parent;
  }
  return join(current, 'bun.lock');
}
export const CACHE = resolve(
  process.env.BCR_WORK_CACHE ??
    join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
      'bcr-work',
      sha(ROOT).slice(0, 16),
    ),
);
export const STATE = resolve(
  process.env.BCR_WORK_STATE ??
    join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'),
      'bcr',
      'work-manager',
      sha(ROOT).slice(0, 16),
    ),
);

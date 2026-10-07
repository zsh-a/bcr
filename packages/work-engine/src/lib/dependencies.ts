import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { PackageManifest, Project } from '../project';
import { cacheGet, cachePut } from '../state/cache';
import { locked } from '../state/lock';
import { hashFile, json, sha, stable } from './files';
import { CACHE, TOOLS } from './paths';
import { command } from './process';

/** Dependency environments are keyed by the two immutable manifests, never by a job ID. */
export async function dependencies(p: Project, signal?: AbortSignal) {
  const manifest = join(p.root, 'package.json');
  if (!existsSync(manifest)) {
    return TOOLS;
  }
  const lock = join(p.root, 'bun.lock');
  if (!existsSync(lock)) {
    throw new Error('自定义依赖需要提交 bun.lock；先在工程目录运行 bun install');
  }
  const pkg = json<PackageManifest & { workspaces?: unknown }>(manifest);
  if (pkg.workspaces) {
    throw new Error('Work 必须有独立的 package.json 与 bun.lock');
  }
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, version] of Object.entries(declared)) {
    if (/^(?:workspace:|file:|link:|\.\.?\/|\/)/u.test(version)) {
      throw new Error('快照依赖不支持工程外的本地路径');
    }
    if ((name === 'remotion' || name.startsWith('@remotion/')) && version !== '4.0.532') {
      throw new Error(`${name} 必须固定为 4.0.532`);
    }
  }
  const key = `deps-${sha(stable({ manifest: hashFile(manifest), lock: hashFile(lock), bun: Bun.version, platform: process.platform, arch: process.arch }))}`;
  return locked(`build:dependencies:${key}`, async () => {
    signal?.throwIfAborted();
    const hit = cacheGet(key);
    if (hit && existsSync(join(hit, 'node_modules'))) {
      return hit;
    }
    const destination = join(CACHE, key);
    const stage = `${destination}.${randomUUID()}.tmp`;
    mkdirSync(stage, { recursive: true });
    try {
      copyFileSync(manifest, join(stage, 'package.json'));
      copyFileSync(lock, join(stage, 'bun.lock'));
      await command(
        [process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts'],
        stage,
        {},
        true,
        signal,
      );
      const requireProject = createRequire(join(stage, 'package.json'));
      for (const name of Object.keys(declared).filter(
        (name) => name === 'remotion' || name.startsWith('@remotion/'),
      )) {
        if (requireProject(`${name}/package.json`).version !== '4.0.532') {
          throw new Error(`${name} 必须固定为 4.0.532`);
        }
      }
      signal?.throwIfAborted();
      rmSync(destination, { recursive: true, force: true });
      renameSync(stage, destination);
      // Bun uses package symlinks; the frozen manifests identify this reproducible environment.
      cachePut(key, 'dependencies', destination, ['package.json', 'bun.lock']);
      return destination;
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  });
}

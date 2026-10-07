import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { bundle } from '@remotion/bundler';
import {
  assets,
  atomicJSON,
  CACHE,
  cacheGet,
  cachePut,
  inside,
  locked,
  type Project,
  type Target,
  TOOLS,
  targetIdentity,
} from '../core';
import { dependencies } from '../lib/dependencies';
import { dependencyPath } from '../lib/paths';

import { props } from './props';

function entrySource(p: Project, t: Target) {
  return `import React from ${JSON.stringify(dependencyPath('react'))};
import {Composition,registerRoot} from ${JSON.stringify(dependencyPath('remotion'))};
import ${t.exportName ? `{${t.exportName} as Scene}` : 'Scene'} from ${JSON.stringify(inside(p.root, t.entry))};
registerRoot(()=> <Composition id="Managed" component={Scene} width={${t.width}} height={${t.height}} fps={${t.fps}} durationInFrames={${t.durationInFrames}} defaultProps={${JSON.stringify(props(p, t))}}/>);\n`;
}
export async function build(p: Project, t: Target, signal?: AbortSignal) {
  if (t.runtime !== 'remotion') {
    throw new Error('build/capture/render 需要 Remotion 目标，HTML 目标使用 preview');
  }
  mkdirSync(CACHE, { recursive: true });
  const identity = targetIdentity(p, t);
  const key = `bundle-${identity.key}`;
  return locked(`build:${p.id}:${t.id}`, async () => {
    signal?.throwIfAborted();
    const hit = cacheGet(key);
    if (hit) {
      console.log(`${p.id}/${t.id} bundle cache hit`);
      return { dir: join(hit, 'bundle'), identity, cached: true };
    }
    const path = join(CACHE, key);
    const stage = `${path}.${randomUUID()}.tmp`;
    mkdirSync(join(stage, 'assets'), { recursive: true });
    try {
      const environment = await dependencies(p, signal);
      const publicRoot = join(p.root, 'public');
      for (const file of assets(p, t)) {
        const dest = join(stage, 'assets', relative(publicRoot, file));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(file, dest);
      }
      const entry = join(stage, 'entry.tsx');
      writeFileSync(entry, entrySource(p, t));
      await bundle({
        entryPoint: entry,
        rootDir: p.root,
        outDir: join(stage, 'bundle'),
        publicDir: join(stage, 'assets'),
        rspack: true,
        enableCaching: false,
        rspackOverride: (cfg) => ({
          ...cfg,
          cache: false,
          resolve: {
            ...cfg.resolve,
            modules: [
              join(environment, 'node_modules'),
              join(TOOLS, 'node_modules'),
              'node_modules',
            ],
            alias: {
              ...cfg.resolve?.alias,
              react: dependencyPath('react'),
              'react-dom': dependencyPath('react-dom'),
              remotion: dependencyPath('remotion'),
            },
          },
        }),
      });
      signal?.throwIfAborted();
      if (targetIdentity(p, t).key !== identity.key) {
        throw new Error('打包期间源码/素材变化，请重新运行');
      }
      // The bundle already contains a complete copy of its permitted public assets.
      rmSync(join(stage, 'assets'), { recursive: true });
      atomicJSON(join(stage, 'identity.json'), {
        ...identity,
        project: p.id,
        target: t.id,
        createdAt: new Date().toISOString(),
      });
      if (existsSync(path)) {
        rmSync(path, { recursive: true });
      }
      renameSync(stage, path);
      cachePut(key, 'bundle', path);
      return { dir: join(path, 'bundle'), identity, cached: false };
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  });
}

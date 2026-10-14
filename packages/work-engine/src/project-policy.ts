import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { json } from './lib/files';
import type { Config } from './project';

/** Source snapshots contain declared render inputs, never private media or build caches. */
export function snapshotPolicy(root: string) {
  const path = join(root, 'production.json');
  const config = existsSync(path) ? json<Partial<Config>>(path) : {};
  const generated = [
    config.runtime?.timing,
    config.runtime?.events,
    config.audio?.timeline,
    config.runtime ? '.bcr/build/runtime/manifest.json' : undefined,
  ].filter(
    (value): value is string =>
      !!value && /^\.bcr\/build\/(?!.*\.\.)[a-zA-Z0-9_./-]+\.json$/.test(value),
  );
  const excluded = [
    'media',
    'experiments/runs',
    ...(config.privateAssets ?? []).map((value) => `public/${value.replace(/\/$/, '')}`),
  ];
  if (config.audio?.directory) {
    excluded.push(config.audio.directory.replace(/\/$/, ''));
  }
  return { generated: [...new Set(generated)], excluded };
}

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ROOT } from './paths';

/** Production output may never mutate a release, including through an out symlink. */
export function assertWritableOutput(
  path: string,
  releaseRoot = resolve(process.env.BCR_WORK_RELEASES ?? join(ROOT, '.releases')),
) {
  let ancestor = resolve(path);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) {
    ancestor = dirname(ancestor);
  }
  const actual = resolve(realpathSync(ancestor));
  const root = existsSync(releaseRoot) ? realpathSync(releaseRoot) : releaseRoot;
  if (actual === root || actual.startsWith(root + sep)) {
    throw new Error('交付版本不可写；请使用制作或实验暂存目录');
  }
  for (const origin of [resolve(path), actual]) {
    let cursor = origin;
    while (cursor !== dirname(cursor)) {
      if (
        existsSync(join(cursor, 'manifest.json')) &&
        existsSync(join(cursor, 'files')) &&
        lstatSync(join(cursor, 'files')).isDirectory()
      ) {
        throw new Error('拒绝写入不可变交付目录');
      }
      cursor = dirname(cursor);
    }
  }
  return resolve(path);
}

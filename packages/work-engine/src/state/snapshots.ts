import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  atomicJSON,
  fileMap,
  hashFile,
  inside,
  json,
  verifyExactMap,
  verifyMap,
} from '../lib/files';
import { STATE } from '../lib/paths';
import { targetScope } from '../pipeline/scope';
import { type Project, type Target, targetIdentity } from '../project';

/** Source objects are independent copies; mutable Work files never share their inode. */
export function sourceSnapshot(p: Project, t: Target) {
  const identity = targetIdentity(p, t);
  const inputFiles = { ...identity.files };
  if (p.config.runtime && targetScope(p, t).runtime) {
    for (const path of [
      p.config.runtime.timing,
      p.config.runtime.events,
      '.bcr/build/runtime/manifest.json',
    ]) {
      inputFiles[path] = hashFile(inside(p.root, path));
    }
  }
  const root = join(STATE, 'snapshots', identity.key);
  const manifest = join(root, 'manifest.json');
  const source = join(root, 'source');
  if (existsSync(manifest)) {
    const previous = json<{ files: Record<string, string> }>(manifest);
    if (!verifyExactMap(source, previous.files)) {
      throw new Error(`源码快照损坏: ${identity.key}`);
    }
    return { project: { ...p, root: source, frozen: true }, input: identity, path: root };
  }
  const stage = `${root}.${randomUUID()}.tmp`;
  mkdirSync(join(stage, 'source'), { recursive: true, mode: 0o700 });
  try {
    for (const [file, hash] of Object.entries(inputFiles)) {
      const object = join(STATE, 'objects', hash.slice(0, 2), hash);
      mkdirSync(dirname(object), { recursive: true, mode: 0o700 });
      if (!existsSync(object)) {
        const temporary = `${object}.${randomUUID()}.tmp`;
        copyFileSync(inside(p.root, file), temporary);
        if (hashFile(temporary) !== hash) {
          rmSync(temporary);
          throw new Error(`冻结期间输入变化: ${file}`);
        }
        chmodSync(temporary, 0o400);
        renameSync(temporary, object);
      } else if (hashFile(object) !== hash) {
        throw new Error(`源码对象损坏: ${hash}`);
      }
      const destination = join(stage, 'source', file);
      mkdirSync(dirname(destination), { recursive: true });
      linkSync(object, destination);
    }
    const files = fileMap(
      join(stage, 'source'),
      Object.keys(inputFiles).map((file) => join(stage, 'source', file)),
    );
    if (!verifyMap(p.root, files) || targetIdentity(p, t).key !== identity.key) {
      throw new Error('冻结期间制作输入变化');
    }
    atomicJSON(join(stage, 'manifest.json'), {
      input: identity,
      files,
      project: p.id,
      target: t.id,
    });
    mkdirSync(dirname(root), { recursive: true });
    renameSync(stage, root);
    return { project: { ...p, root: source, frozen: true }, input: identity, path: root };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

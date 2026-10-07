import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function bytes(path: string, seen = new Set<string>()): number {
  if (!existsSync(path)) {
    return 0;
  }
  const st = lstatSync(path);
  if (st.isSymbolicLink()) {
    return 0;
  }
  const inode = `${st.dev}:${st.ino}`;
  if (seen.has(inode)) {
    return 0;
  }
  seen.add(inode);
  return st.isDirectory()
    ? readdirSync(path).reduce((n, f) => n + bytes(join(path, f), seen), 0)
    : st.blocks * 512;
}

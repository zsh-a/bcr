import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileMap, inside, verifyMap, walk } from '../lib/files';
import { CACHE } from '../lib/paths';
import { database } from './database';
export function cacheGet(key: string) {
  const db = database();
  const row = db.query('SELECT * FROM cache WHERE key=?').get(key) as {
    path: string;
    manifest: string;
  } | null;
  if (row && verifyMap(row.path, JSON.parse(row.manifest))) {
    db.query('UPDATE cache SET used=? WHERE key=?').run(Date.now(), key);
    db.close();
    return row.path;
  }
  if (row) {
    db.query('DELETE FROM cache WHERE key=?').run(key);
  }
  db.close();
  return null;
}
export function cachePut(key: string, kind: string, path: string, files?: string[]) {
  inside(CACHE, path);
  const manifest = fileMap(path, files ? files.map((file) => inside(path, file)) : walk(path));
  const db = database();
  db.query('INSERT OR REPLACE INTO cache VALUES (?,?,?,?,?)').run(
    key,
    kind,
    path,
    Date.now(),
    JSON.stringify(manifest),
  );
  db.close();
}
export function removeCachePath(path: string) {
  inside(CACHE, path);
  if (resolve(path) === CACHE) {
    throw new Error('拒绝删除整个缓存根目录');
  }
  rmSync(path, { recursive: true, force: true });
}

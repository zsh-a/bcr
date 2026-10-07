import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJSON, CACHE, database, inside, locked, ROOT, removeCachePath, STATE } from '../core';
import { workspace } from '../project';

import { bytes } from './size';
export function orphanPlan(dir: string, registered: string[]) {
  if (!existsSync(dir)) {
    return [];
  }
  const known = new Set(registered.map((p) => resolve(p)));
  return readdirSync(dir)
    .filter(
      (name) =>
        /^(?:bundle|frames|deps)-[a-f0-9]{64}(?:\.[a-f0-9-]+\.tmp)?$/.test(name) ||
        /^[a-f0-9-]{36}-av1-smoke\.mp4$/.test(name),
    )
    .map((name) => inside(dir, name))
    .filter((path) => !known.has(resolve(path)) && !lstatSync(path).isSymbolicLink());
}
export async function gc(apply: boolean, budgetGiB?: number, timeout = 60000) {
  return locked(
    'cache-gc',
    async () => {
      const configured = existsSync(join(ROOT, 'workspace.json')) ? workspace().cacheBudgetGiB : 8;
      const budget = (budgetGiB ?? configured) * 1024 ** 3;
      if (!Number.isFinite(budget) || budget < 0) {
        throw new Error('缓存预算无效');
      }
      const db = database();
      const busy = db.query('SELECT resource FROM leases').all() as { resource: string }[];
      if (
        busy.some((r) => r.resource !== 'cache-gc' && /^(build|render|preview):/.test(r.resource))
      ) {
        db.close();
        throw new Error('渲染/预览正在使用缓存，稍后清理');
      }
      const rows = db.query('SELECT key,path,kind,used FROM cache ORDER BY used ASC').all() as {
        key: string;
        path: string;
        kind: string;
        used: number;
      }[];
      const before = bytes(CACHE);
      const orphans = orphanPlan(
        CACHE,
        rows.map((r) => r.path),
      ).map((path) => ({ path, bytes: bytes(path) }));
      if (apply) {
        for (const orphan of orphans) {
          removeCachePath(orphan.path);
        }
      }
      // Releases contain independent copies. They never rely on removable build/frame caches.
      let size = before - orphans.reduce((n, p) => n + p.bytes, 0);
      let removed = 0;
      const plan: ((typeof rows)[number] & { bytes: number })[] = [];
      for (const row of rows) {
        if (size <= budget) {
          break;
        }
        inside(CACHE, row.path);
        const amount = bytes(row.path);
        plan.push({ ...row, bytes: amount });
        size -= amount;
        if (apply) {
          removeCachePath(row.path);
          db.query('DELETE FROM cache WHERE key=?').run(row.key);
          removed++;
        }
      }
      db.close();
      const report = {
        applied: apply,
        budgetBytes: budget,
        beforeBytes: before,
        afterEstimatedBytes: size,
        removed,
        plan,
        orphans,
      };
      if (apply) {
        atomicJSON(join(STATE, 'maintenance', `${Date.now()}-gc.json`), report);
      }
      return report;
    },
    timeout,
  );
}

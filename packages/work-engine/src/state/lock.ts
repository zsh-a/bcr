import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { database } from './database';

function birth(pid: number) {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ')[19]!;
  } catch {
    return '';
  }
}
export async function locked<T>(
  resource: string,
  work: () => Promise<T>,
  timeout = 60000,
): Promise<T> {
  const db = database();
  const owner = randomUUID();
  const start = Date.now();
  const acquire = db.transaction(() => {
    // Acquire cache users and the collector in the same SQLite transaction.
    // This closes the race between a collector's check and a new render starting.
    const cacheUser = /^(build|render|preview):/.test(resource);
    if (resource === 'cache-gc' || cacheUser) {
      const peers = db.query('SELECT resource,pid,birth FROM leases').all() as {
        resource: string;
        pid: number;
        birth: string;
      }[];
      for (const peer of peers) {
        const conflicts =
          resource === 'cache-gc'
            ? /^(build|render|preview):/.test(peer.resource)
            : peer.resource === 'cache-gc';
        if (!conflicts) {
          continue;
        }
        if (birth(peer.pid) === peer.birth && peer.birth !== '') {
          return false;
        }
        db.query('DELETE FROM leases WHERE resource=?').run(peer.resource);
      }
    }
    const old = db.query('SELECT pid,birth FROM leases WHERE resource=?').get(resource) as {
      pid: number;
      birth: string;
    } | null;
    if (old && birth(old.pid) === old.birth && old.birth !== '') {
      return false;
    }
    db.query('DELETE FROM leases WHERE resource=?').run(resource);
    db.query('INSERT INTO leases VALUES (?,?,?,?,?)').run(
      resource,
      owner,
      process.pid,
      birth(process.pid),
      Date.now(),
    );
    return true;
  });
  try {
    while (!acquire.immediate()) {
      if (Date.now() - start >= timeout) {
        throw new Error(`资源正在使用，请稍后重试: ${resource}`);
      }
      await Bun.sleep(200);
    }
    return await work();
  } finally {
    db.query('DELETE FROM leases WHERE resource=? AND owner=?').run(resource, owner);
    db.close();
  }
}

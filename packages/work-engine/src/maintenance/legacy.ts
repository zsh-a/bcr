import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { atomicJSON, hashFile, inside, json, locked, STATE } from '../core';

import { bytes } from './size';
export function runnerRoots(
  base = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'bcr/work-runner'),
) {
  return existsSync(base)
    ? readdirSync(base)
        .filter((f) => /^[a-f0-9]{16}$/.test(f) && existsSync(join(base, f, 'source.json')))
        .map((f) => join(base, f))
    : [];
}
export interface ScratchItem {
  job: string;
  state: string;
  paths: string[];
  bytes: number;
}
export function scratchPlan(states: string[], graceMs = 3600000, onlyJob?: string): ScratchItem[] {
  const result: ScratchItem[] = [];
  for (const state of states) {
    const jobs = join(state, 'jobs');
    if (!existsSync(jobs)) {
      continue;
    }
    for (const id of readdirSync(jobs)) {
      if (onlyJob && id !== onlyJob) {
        continue;
      }
      const jobDir = inside(jobs, id);
      const meta = join(jobDir, 'job.json');
      if (!existsSync(meta)) {
        continue;
      }
      const job = json<{
        status: string;
        updatedAt: number;
        outputs?: { name: string; hash: string }[];
      }>(meta);
      if (
        !['succeeded', 'failed', 'cancelled'].includes(job.status) ||
        Date.now() - job.updatedAt < graceMs
      ) {
        continue;
      }
      // Output directories, previews, snapshots, reports and manifests are retained.
      if (
        !(job.outputs ?? []).every(
          (o) =>
            existsSync(inside(join(jobDir, 'outputs'), o.name)) &&
            hashFile(inside(join(jobDir, 'outputs'), o.name)) === o.hash,
        )
      ) {
        continue;
      }
      const paths = ['project', 'bundle']
        .map((n) => join(jobDir, n))
        .filter((f) => existsSync(f) && !lstatSync(f).isSymbolicLink());
      if (paths.length) {
        result.push({ job: id, state, paths, bytes: paths.reduce((n, f) => n + bytes(f), 0) });
      }
    }
  }
  return result;
}
export async function cleanScratch(apply: boolean, states = runnerRoots()) {
  return locked('legacy-scratch-gc', async () => {
    const items = scratchPlan(states);
    const removed: ScratchItem[] = [];
    if (apply) {
      for (const item of items) {
        // Re-read the terminal status immediately before removal in case the runner changed it.
        const fresh = scratchPlan([item.state], 3600000, item.job)[0];
        if (!fresh) {
          continue;
        }
        for (const path of fresh.paths) {
          rmSync(path, { recursive: true, force: true });
        }
        removed.push(fresh);
      }
    }
    const report = {
      kind: 'legacy-scratch',
      applied: apply,
      createdAt: new Date().toISOString(),
      jobs: items.length,
      eligibleBytes: items.reduce((n, i) => n + i.bytes, 0),
      removedJobs: removed.length,
      kept: ['job.json', 'input.json', 'outputs', 'site', 'snapshots', 'reviews', 'versions'],
      items,
    };
    if (apply) {
      atomicJSON(join(STATE, 'maintenance', `${Date.now()}-scratch.json`), report);
    }
    return report;
  });
}
export async function dedupSnapshots(apply: boolean, states = runnerRoots()) {
  return locked('legacy-snapshot-dedup', async () => {
    const objects = join(STATE, 'snapshot-objects');
    const seen = new Map<string, string>();
    const substitutions: { snapshot: string; path: string; hash: string }[] = [];
    let saved = 0;
    let checked = 0;
    for (const state of states) {
      const snapshots = join(state, 'snapshots');
      if (!existsSync(snapshots)) {
        continue;
      }
      for (const id of readdirSync(snapshots)) {
        if (!/^[a-f0-9]{64}$/.test(id)) {
          continue;
        }
        const dir = inside(snapshots, id);
        const manifestPath = join(dir, 'manifest.json');
        if (!existsSync(manifestPath)) {
          continue;
        }
        const manifest = json<{
          files?: { path?: string; name?: string; hash?: string; sha256?: string }[];
        }>(manifestPath);
        // Read only finalized snapshots with the runner's explicit file identities.
        for (const item of manifest.files ?? []) {
          const name = item.path ?? item.name;
          const expected = item.hash ?? item.sha256;
          if (
            typeof name !== 'string' ||
            typeof expected !== 'string' ||
            !/^[a-f0-9]{64}$/.test(expected)
          ) {
            throw new Error(`未知快照格式: ${manifestPath}`);
          }
          const file = inside(join(dir, 'source'), name);
          if (hashFile(file) !== expected) {
            throw new Error(`快照内容损坏，停止整理: ${file}`);
          }
          checked++;
          const object = join(objects, expected.slice(0, 2), expected);
          let canonical = seen.get(expected);
          if (!canonical && existsSync(object)) {
            if (hashFile(object) !== expected) {
              throw new Error(`快照对象损坏: ${object}`);
            }
            canonical = object;
          }
          if (!canonical) {
            canonical = file;
            if (apply) {
              mkdirSync(dirname(object), { recursive: true });
              try {
                linkSync(file, object);
                canonical = object;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
                  throw error;
                }
              }
            }
            seen.set(expected, canonical);
            continue;
          }
          seen.set(expected, canonical);
          const a = statSync(canonical);
          const b = statSync(file);
          if (a.dev !== b.dev || a.ino === b.ino) {
            continue;
          }
          saved += b.blocks * 512;
          if (apply) {
            const temp = `${file}.${randomUUID()}.dedup`;
            linkSync(canonical, temp);
            renameSync(temp, file);
          }
          substitutions.push({ snapshot: id, path: name, hash: expected });
        }
      }
    }
    const report = {
      applied: apply,
      checked,
      uniqueContents: seen.size,
      replaced: substitutions.length,
      estimatedBytesSaved: saved,
      objects,
      substitutions,
    };
    if (apply) {
      atomicJSON(join(STATE, 'maintenance', `${Date.now()}-dedup.json`), report);
    }
    return report;
  });
}

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { atomicJSON } from '../lib/files';
import { assertWritableOutput } from '../lib/output';
import { engineLock, STATE, TOOLS } from '../lib/paths';
import { command } from '../lib/process';
import { loadProject, type Project } from '../project';
import { locked } from '../state/lock';

async function createBackup(p: Project, output?: string) {
  const directory = assertWritableOutput(
    resolve(
      output ??
        p.config.storage?.backupDirectory ??
        process.env.BCR_WORK_BACKUPS ??
        join(homedir(), 'backups/bcr-work'),
    ),
  );
  if (directory === p.root || directory.startsWith(`${p.root}/`)) {
    throw new Error('备份存储必须位于 Work 外');
  }
  const specification = join(p.root, '.bcr/build/backup-input.json');
  atomicJSON(specification, {
    version: 1,
    project: p.id,
    root: p.root,
    workspace: resolve(p.root, '..'),
    sources: [
      ...(p.config.storage?.sources ?? [
        '.bcr/narration',
        '.bcr/voice',
        '.bcr/research',
        '.bcr/revisions',
        'media',
      ]),
      '.bcr/reports',
      '.bcr/build/validation.json',
      '.bcr/build/frozen.json',
    ],
    experiments: p.config.storage?.experiments ?? ['experiments'],
    engine: TOOLS,
    engineLock: engineLock(),
    state: existsSync(join(STATE, 'state.sqlite')) ? join(STATE, 'state.sqlite') : undefined,
    store: directory,
  });
  const report = JSON.parse(
    await command(
      [
        'python3',
        '-I',
        join(TOOLS, 'audio/scripts/backup-work.py'),
        '--specification',
        specification,
      ],
      p.root,
      {},
      true,
    ),
  ) as { snapshot: string; files: number; objectsWritten: number; actualRestoreVerified: boolean };
  atomicJSON(join(p.root, '.bcr/build/backup.json'), report);
  return report;
}
export async function backup(p: Project, output?: string) {
  return locked(`backup:${p.id}`, () =>
    locked(`audio:${p.id}`, () =>
      locked(`qa:${p.id}`, () =>
        locked(`release:${p.id}`, () => createBackup(loadProject(p.root), output)),
      ),
    ),
  );
}
export async function restore(snapshot: string, output: string) {
  assertWritableOutput(output);
  return JSON.parse(
    await command(
      [
        'python3',
        '-I',
        join(TOOLS, 'audio/scripts/backup-work.py'),
        '--restore',
        resolve(snapshot),
        '--destination',
        resolve(output),
      ],
      undefined,
      {},
      true,
    ),
  ) as { restored: number; directory: string };
}

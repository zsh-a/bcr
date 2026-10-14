import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../lib/paths';
import { command } from '../lib/process';
import { locked } from '../state/lock';

export const AUDIO = join(TOOLS, 'audio');
export type AudioEnvironment = 'runtime' | 'legacy' | 'models';

export function audioEnvironmentPath(mode: AudioEnvironment = 'runtime') {
  return join(AUDIO, mode === 'runtime' ? '.venv' : `.venv-${mode}`);
}

export async function ensureAudio(mode: AudioEnvironment = 'runtime') {
  if (!existsSync(join(AUDIO, 'uv.lock'))) {
    throw new Error('缺少音频依赖锁，请先运行 bcr-work env');
  }
  const directory = audioEnvironmentPath(mode);
  await locked(`audio-environment:${mode}`, () =>
    command(
      [
        'uv',
        'sync',
        '--locked',
        '--python',
        '3.14.2',
        ...(mode === 'runtime' ? [] : ['--extra', mode]),
      ],
      AUDIO,
      { PYTHONPATH: '', PYTHONNOUSERSITE: '1', UV_PROJECT_ENVIRONMENT: directory },
    ),
  );
  return join(directory, 'bin/python');
}

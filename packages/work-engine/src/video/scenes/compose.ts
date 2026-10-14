import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { command } from '../../lib/process';
import type { Runtime } from '../../pipeline/runtime';
import type { Project, Target } from '../../project';
import { readCatalog } from './plan';

export async function composeScenes(
  p: Project,
  t: Target,
  runtime: Runtime,
  files: string[],
  localStart: number,
  from: number,
  to: number,
  audio: string,
  destination: string,
  encoding: string[],
  signal?: AbortSignal,
) {
  const concat = join(p.root, '.bcr/build', `concat-${randomUUID()}.txt`);
  writeFileSync(
    concat,
    `${files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n')}\n`,
  );
  const count = to - from + 1;
  const progress = readCatalog(p).progress ?? p.config.scenes?.progress;
  const end = progress
    ? (runtime.main.segments.find((segment) => segment.chapter === progress.endChapter)?.start ??
        runtime.main.durationInFrames) - from
    : 0;
  const base = `[0:v]trim=start_frame=${localStart}:end_frame=${localStart + count},settb=1/${t.fps},setpts=N`;
  const barHeight = progress ? Math.ceil((progress.height + 1) / 2) * 2 : 0;
  const filter = progress
    ? `${base}[base];color=c=${progress.color}:s=${t.width}x${barHeight}:r=${t.fps},format=rgba,crop=${t.width}:${progress.height}:0:0[bar];[base][bar]overlay=x='floor((n-1+${from})*${t.width}/${runtime.main.durationInFrames})-${t.width}':y=${t.height! - progress.height}:enable='lt(n-1,${end})':shortest=1:format=rgb,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p[v]`
    : `${base},scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p[v]`;
  const cmd = [
    'ffmpeg',
    '-v',
    'error',
    '-nostdin',
    '-n',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-ss',
    String(from / t.fps!),
    '-i',
    audio,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '1:a:0',
    '-frames:v',
    String(count),
    '-t',
    String(count / t.fps!),
    ...encoding,
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    destination,
  ];
  try {
    await command(cmd, p.root, {}, true, signal);
    return cmd;
  } finally {
    rmSync(concat, { force: true });
  }
}

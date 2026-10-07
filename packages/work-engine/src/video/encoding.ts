import { command, ROOT, type Target } from '../core';
import type { MediaProbe } from './reports';

export function encodeOptions(encoder: string, cq: number, reason?: string) {
  if (!Number.isFinite(cq) || cq < 0 || cq > 63) {
    throw new Error('CQ 需要在 0—63 之间');
  }
  if (encoder === 'av1_nvenc') {
    return [
      '-c:v',
      encoder,
      '-preset',
      'p6',
      '-tune',
      'hq',
      '-rc',
      'vbr',
      '-cq',
      String(cq),
      '-b:v',
      '0',
      '-multipass',
      'qres',
    ];
  }
  if (encoder === 'libaom-av1' && reason?.trim()) {
    return ['-c:v', encoder, '-cpu-used', '4', '-crf', String(cq), '-b:v', '0'];
  }
  throw new Error('默认使用 av1_nvenc。CPU 回退需 --encoder libaom-av1 --cpu-reason 原因');
}
export function av1Level(t: Target) {
  // AOM AV1 Annex A: https://github.com/AOMediaCodec/av1-spec/blob/master/annex.a.levels.md
  const pixels = t.width! * t.height!;
  const rate = pixels * t.fps!;
  if (t.width! <= 6144 && t.height! <= 2304 && pixels <= 2359296 && rate <= 70778880) {
    return '4.0';
  }
  if (t.width! <= 6144 && t.height! <= 2304 && pixels <= 2359296 && rate <= 141557760) {
    return '4.1';
  }
  if (t.width! <= 8192 && t.height! <= 4352 && pixels <= 8912896 && rate <= 267386880) {
    return '5.0';
  }
  if (t.width! <= 8192 && t.height! <= 4352 && pixels <= 8912896 && rate <= 534773760) {
    return '5.1';
  }
  throw new Error('目标超过当前 AV1 level 策略，请增加并验收该规格');
}
export async function probe(file: string): Promise<MediaProbe> {
  return JSON.parse(
    await command(
      [
        'ffprobe',
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        file,
      ],
      ROOT,
      {},
      true,
    ),
  );
}

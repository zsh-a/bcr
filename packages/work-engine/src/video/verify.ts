import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VoiceSettings } from '../audio/content';
import { hashFile, json } from '../lib/files';
import { command } from '../lib/process';
import { type Project, targetOf } from '../project';
import { probe } from './encoding';
import { renderIdentity } from './identity';
import type { ArtifactReport } from './reports';

export async function verifyArtifact(p: Project, input: string) {
  const path = resolve(input);
  if (!existsSync(`${path}.json`)) {
    throw new Error('媒体缺少对应制作报告');
  }
  const report = json<ArtifactReport>(`${path}.json`);
  if (
    report.project !== p.id ||
    report.status !== 'succeeded' ||
    report.sha256 !== hashFile(path)
  ) {
    throw new Error('媒体身份或文件校验不符');
  }
  const target = targetOf(p, report.target);
  if (report.renderInput?.key !== renderIdentity(p, target, false, report.renderer).key) {
    throw new Error('媒体对应的制作输入已过期');
  }
  const media = await probe(path);
  const video = media.streams.find((stream) => stream.codec_type === 'video');
  const audio = media.streams.find((stream) => stream.codec_type === 'audio');
  if (
    video?.codec_name !== 'av1' ||
    Number(video.nb_read_frames) !== report.frames ||
    video.width !== Math.round(target.width! * Number(report.scale ?? 1)) ||
    video.height !== Math.round(target.height! * Number(report.scale ?? 1)) ||
    audio?.sample_rate !== '48000'
  ) {
    throw new Error('媒体规格不符');
  }
  await command(['ffmpeg', '-v', 'error', '-i', path, '-f', 'null', '-'], p.root, {}, true);
  const child = Bun.spawn(
    [
      'ffmpeg',
      '-nostdin',
      '-i',
      path,
      '-vn',
      '-af',
      'loudnorm=print_format=json',
      '-f',
      'null',
      '-',
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  const match = stderr.match(/\{\s*"input_i"[^}]+\}/g)?.at(-1);
  if (code !== 0 || !match) {
    throw new Error('编码音轨响度测量失败');
  }
  const measured = JSON.parse(match) as { input_i: string; input_tp: string };
  const voice = p.config.audio?.voice
    ? json<VoiceSettings>(resolve(p.root, p.config.audio.voice))
    : undefined;
  if (
    voice &&
    report.scope === 'full' &&
    (Math.abs(Number(measured.input_i) - voice.mastering.loudnessLUFS) > 0.5 ||
      Number(measured.input_tp) > voice.mastering.truePeakDBTP)
  ) {
    throw new Error('编码音轨响度或真峰值不符');
  }
  return {
    status: 'passed',
    path,
    sha256: report.sha256,
    frames: report.frames,
    media,
    encodedAudio: measured,
    continuousHumanReview: 'pending',
  };
}

import { join, relative } from 'node:path';
import { hashFile, inside } from '../lib/files';
import { command } from '../lib/process';
import type { Project } from '../project';
import type { VoiceSettings } from './content';

export type MusicSettings = NonNullable<VoiceSettings['music']>;
type Run = (args: string[]) => Promise<{ stderr: string }>;
type Stats = (stderr: string) => { input_i: string };

export function musicSettings(voice: VoiceSettings) {
  const music = voice.music;
  if (!music) {
    return undefined;
  }
  const { duck } = music;
  if (
    !music.script ||
    !Number.isFinite(music.bedBelowVoiceLU) ||
    music.bedBelowVoiceLU < 6 ||
    !Number.isFinite(music.minVoiceToMusicDb) ||
    ![duck?.threshold, duck?.ratio, duck?.attackMs, duck?.releaseMs].every(
      (value) => Number.isFinite(value) && value! > 0,
    )
  ) {
    throw new Error(
      'voice.json 的 music 需要 script、bedBelowVoiceLU≥6、minVoiceToMusicDb 和 duck',
    );
  }
  return music;
}

/** The score script and every file it reads are stage inputs; nothing is guessed from imports. */
export function musicInputFiles(root: string, voice: VoiceSettings) {
  const music = musicSettings(voice);
  return music ? [music.script, ...(music.inputs ?? [])].map((file) => inside(root, file)) : [];
}

/** A Work-owned generator renders an original score from the measured timeline. */
export async function renderScore(p: Project, music: MusicSettings, samples: number) {
  const audio = p.config.audio!;
  const score = inside(p.root, audio.score);
  await command([process.execPath, inside(p.root, music.script), p.root], p.root, {
    BCR_TIMELINE: inside(p.root, audio.timeline),
    BCR_SCORE: score,
    BCR_SAMPLES: String(samples),
  });
  const probe = JSON.parse(
    await command(
      [
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'stream=sample_rate,channels:format=duration',
        '-of',
        'json',
        score,
      ],
      p.root,
      {},
      true,
    ),
  ) as { streams: { sample_rate: string; channels: number }[]; format: { duration: string } };
  const stream = probe.streams[0];
  if (
    stream?.sample_rate !== '48000' ||
    stream.channels !== 2 ||
    Number(probe.format.duration) < samples / 48000 - 0.02
  ) {
    throw new Error('配乐需要覆盖整条旁白的 48 kHz 立体声文件');
  }
}

/** Set the bed relative to the measured voice, duck it under speech, and sum before mastering. */
export async function musicPremix(
  p: Project,
  music: MusicSettings,
  narration: string,
  samples: number,
  run: Run,
  stats: Stats,
) {
  const directory = inside(p.root, p.config.audio!.directory ?? '.bcr/narration');
  const score = inside(p.root, p.config.audio!.score);
  const measure = async (file: string, filter = '') =>
    Number(
      stats(
        (await run(['-i', file, '-af', `${filter}loudnorm=print_format=json`, '-f', 'null', '-']))
          .stderr,
      ).input_i,
    );
  const voiceLUFS = await measure(narration, 'pan=stereo|c0=c0|c1=c0,');
  const scoreLUFS = await measure(score, `atrim=end_sample=${samples},`);
  const bedGainDb = voiceLUFS - music.bedBelowVoiceLU - scoreLUFS;
  const premix = join(directory, 'main-premix.wav');
  const stem = join(directory, 'music-ducked.wav');
  const { duck } = music;
  await run([
    '-i',
    narration,
    '-i',
    score,
    '-filter_complex',
    `[0:a]pan=stereo|c0=c0|c1=c0,asplit=2[v][side];` +
      `[1:a]aresample=48000,atrim=end_sample=${samples},apad=whole_len=${samples},volume=${bedGainDb.toFixed(3)}dB[m];` +
      `[m][side]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attackMs}:release=${duck.releaseMs}[d];` +
      '[d]asplit=2[stem][bed];[v][bed]amix=inputs=2:normalize=0[out]',
    '-map',
    '[out]',
    '-c:a',
    'pcm_f32le',
    premix,
    '-map',
    '[stem]',
    '-c:a',
    'pcm_f32le',
    stem,
  ]);
  return {
    premix,
    record: {
      script: music.script,
      scoreSha256: hashFile(score),
      voiceLUFS,
      scoreLUFS,
      bedGainDb,
      duck,
      duckedStem: relative(p.root, stem),
    },
  };
}

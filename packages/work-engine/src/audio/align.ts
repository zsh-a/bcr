import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJSON, hashFile, inside, json, sha, stable } from '../lib/files';
import { command } from '../lib/process';
import type { Project } from '../project';
import { audioCppSettings, inlineWav, runNativeTask } from './audiocpp';
import type { VoiceSettings } from './content';

interface Alignment {
  model: string;
  backendIdentity?: string;
  audioSha256: string;
  text: string;
  words: { text: string; start: number; end: number }[];
}

export async function nativeAlignment(p: Project) {
  const cfg = p.config.audio!;
  const voice = json<VoiceSettings>(inside(p.root, cfg.voice ?? 'voice.json'));
  const settings = audioCppSettings(voice, true);
  const alignmentPolicy = 'Chinese-zero-normalization-and-source-sample-clock-v1';
  const identity = sha(stable({ settings, alignmentPolicy }));
  const plan = json<{ groups: { id: string; hash: string; raw: string; text: string }[] }>(
    inside(p.root, cfg.plan),
  );
  const directory = inside(p.root, cfg.directory ?? '.bcr/narration');
  const reusable = new Map<string, { path: string; alignment: Alignment }>();
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.alignment.json'))) {
    const path = join(directory, name);
    try {
      const alignment = json<Alignment>(path);
      if (alignment.backendIdentity === identity) {
        reusable.set(sha(stable({ audio: alignment.audioSha256, text: alignment.text })), {
          path,
          alignment,
        });
      }
    } catch {
      /* A corrupt optional candidate is never reused. */
    }
  }
  for (const group of plan.groups) {
    const raw = inside(p.root, group.raw);
    const audioSha256 = hashFile(raw);
    const destination = inside(p.root, group.raw.replace(/\.wav$/, '.alignment.json'));
    const candidate = reusable.get(sha(stable({ audio: audioSha256, text: group.text })));
    if (!existsSync(destination) && candidate) {
      atomicJSON(destination, { ...candidate.alignment, reusedFrom: candidate.path });
    }
    const previous = existsSync(destination) ? json<Alignment>(destination) : undefined;
    if (
      previous?.audioSha256 === audioSha256 &&
      previous.text === group.text &&
      previous.backendIdentity === identity
    ) {
      console.log(`Reuse native alignment: ${group.id}`);
      continue;
    }
    const temporary = `${destination}.input.wav`;
    try {
      await command(
        [
          'ffmpeg',
          '-v',
          'error',
          '-nostdin',
          '-y',
          '-i',
          raw,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          temporary,
        ],
        p.root,
        {},
        true,
      );
      // Native Chinese tokenization drops the numeral 〇; align its spoken
      // equivalent and restore the original spelling on the same timestamps.
      const alignmentText = group.text.replaceAll('〇', '零');
      const result = await runNativeTask(settings, {
        text: alignmentText,
        language: voice.language,
        audio_base64: inlineWav(temporary),
        options: { clamp_timestamps_to_audio: true, ...settings.options },
      });
      const words = result.words?.map((word) => ({
        text: word.word,
        start: word.start_sample / 16000,
        end: word.end_sample / 16000,
      }));
      if (
        !words?.length ||
        words.some(
          (word) =>
            typeof word.text !== 'string' ||
            !Number.isFinite(word.start) ||
            !Number.isFinite(word.end) ||
            word.start < 0 ||
            word.end < word.start,
        )
      ) {
        throw new Error(`audio.cpp 返回的对齐时间戳无效: ${group.id}`);
      }
      const clean = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (clean(words.map((word) => word.text).join('')) !== clean(alignmentText)) {
        throw new Error(`audio.cpp 对齐文本不完整: ${group.id}`);
      }
      if (alignmentText !== group.text) {
        const original = [...group.text.replace(/[^\p{L}\p{N}]/gu, '')];
        let cursor = 0;
        for (const word of words) {
          const length = [...clean(word.text)].length;
          word.text = original.slice(cursor, cursor + length).join('');
          cursor += length;
        }
      }
      const probe = JSON.parse(
        await command(
          [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'stream=duration_ts,time_base',
            '-of',
            'json',
            raw,
          ],
          p.root,
          {},
          true,
        ),
      ) as { streams: { duration_ts: number; time_base: string }[] };
      const stream = probe.streams[0];
      if (!stream) {
        throw new Error(`缺少原始录音采样时钟: ${group.id}`);
      }
      const [numerator, denominator] = stream.time_base.split('/').map(Number);
      const sourceDuration = (stream.duration_ts * numerator!) / denominator!;
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        throw new Error(`原始录音采样时钟无效: ${group.id}`);
      }
      for (const word of words) {
        // Resampling onto the aligner's 16 kHz clock can add a fraction of
        // one aligner sample; it must not extend a cue beyond the source WAV.
        if (word.end > sourceDuration + 1 / 16000 + 1e-6) {
          throw new Error(`对齐时间越过原始录音: ${group.id}`);
        }
        word.start = Math.min(word.start, sourceDuration);
        word.end = Math.min(word.end, sourceDuration);
      }
      if (previous) {
        const history = inside(p.root, `${cfg.directory ?? '.bcr/narration'}/alignment-history`);
        mkdirSync(history, { recursive: true });
        copyFileSync(destination, join(history, `${group.hash}.${hashFile(destination)}.json`));
      }
      atomicJSON(destination, {
        model: settings.model,
        backend: 'audio.cpp',
        backendIdentity: identity,
        alignmentPolicy,
        sourceDuration,
        settings,
        audioSha256,
        text: group.text,
        alignmentText,
        textNormalization:
          alignmentText !== group.text ? '〇→零 for alignment; original spelling restored' : 'none',
        alignmentSampleRate: 16000,
        words,
      });
      console.log(`Aligned with audio.cpp: ${group.id}, ${words.length} words`);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

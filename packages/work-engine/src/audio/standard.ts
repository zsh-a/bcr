import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client, handle_file } from '@gradio/client';
import { atomicJSON, hashFile, inside, json, sha, stable } from '../lib/files';
import { command } from '../lib/process';
import type { Config, Project, Work } from '../project';
import { contentHash, readContent, type VoiceSettings } from './content';

interface MeasuredTrack {
  durationInFrames: number;
  samples: number;
  audioFile: string;
  narrationFile: string;
}
interface MeasuredTimeline {
  draft?: boolean;
  fps: number;
  sampleRate: number;
  main: MeasuredTrack;
}
interface LoudnessStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function voiceSettings(p: Project) {
  return json<VoiceSettings>(inside(p.root, p.config.audio?.voice ?? 'voice.json'));
}

export function requireVoice(p: Project) {
  readContent(p);
  const voice = voiceSettings(p);
  if (
    !voice.referenceTranscript?.trim() ||
    !existsSync(join(p.root, 'public/audio/reference.wav'))
  ) {
    throw new Error(
      '请准备可使用的 public/audio/reference.wav，并在 voice.json 填写 referenceTranscript；草稿可先用 preview/capture',
    );
  }
}

function responseUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = responseUrl(item);
      if (url) {
        return url;
      }
    }
  } else if (value && typeof value === 'object') {
    const item = value as { url?: unknown; path?: unknown; data?: unknown };
    if (typeof item.url === 'string') {
      return item.url;
    }
    if (typeof item.path === 'string' && /^https?:\/\//.test(item.path)) {
      return item.path;
    }
    return responseUrl(item.data);
  }
}

async function voiceover(p: Project) {
  requireVoice(p);
  const cfg = p.config.audio!;
  const content = readContent(p);
  const voice = voiceSettings(p);
  const reference = inside(p.root, 'public/audio/reference.wav');
  const cache = join(p.root, '.bcr/narration');
  mkdirSync(cache, { recursive: true });
  const settings = {
    model: voice.model,
    language: voice.language,
    referenceTranscript: voice.referenceTranscript,
    referenceHash: hashFile(reference),
  };
  const endpoint = process.env.GRADIO_ENDPOINT ?? voice.endpoint;
  const groups = [];
  let client: Awaited<ReturnType<typeof Client.connect>> | undefined;
  try {
    for (const paragraph of content.paragraphs) {
      const text = paragraph.lines.map((line) => line.text).join('');
      const hash = sha(stable({ text, settings, endpoint }));
      const raw = join(cache, `${hash}.wav`);
      if (!existsSync(raw)) {
        client ??= await Client.connect(endpoint);
        const result = await client.predict('/run_voice_clone', {
          ref_aud: handle_file(reference),
          ref_txt: voice.referenceTranscript,
          use_xvec: false,
          text,
          lang_disp: voice.language,
        });
        const url = responseUrl(result.data);
        if (!url) {
          throw new Error(`TTS 没有返回音频: ${paragraph.id}`);
        }
        const response = await fetch(new URL(url, endpoint));
        if (!response.ok) {
          throw new Error(`TTS 下载失败: ${response.status}`);
        }
        const temporary = `${raw}.tmp`;
        try {
          writeFileSync(temporary, new Uint8Array(await response.arrayBuffer()));
          const duration = Number(
            await command(
              [
                'ffprobe',
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'default=nw=1:nk=1',
                temporary,
              ],
              p.root,
              {},
              true,
            ),
          );
          if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error(`TTS 音频无效: ${paragraph.id}`);
          }
          renameSync(temporary, raw);
        } finally {
          rmSync(temporary, { force: true });
        }
      }
      groups.push({ ...paragraph, text, hash, raw, gap: paragraph.gapAfter });
    }
  } finally {
    client?.close();
  }
  const fps = p.work.targets.find((target) => target.id === 'main')?.fps;
  atomicJSON(inside(p.root, cfg.plan), {
    fps,
    contentHash: contentHash(content),
    settings,
    groups,
    programs: { main: groups.map((group) => group.id) },
  });
}

function measured(p: Project) {
  const timeline = json<MeasuredTimeline>(inside(p.root, p.config.audio!.timeline));
  if (timeline.draft || !timeline.main?.narrationFile) {
    throw new Error('需要实测音轨，先执行 voiceover → align → assemble');
  }
  return timeline;
}

async function soundtrack(p: Project) {
  const timeline = measured(p);
  // No music is selected by a scaffold. Keep the stage contract explicit with a zero track.
  await command(
    [
      'ffmpeg',
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-af',
      `atrim=end_sample=${timeline.main.samples}`,
      '-c:a',
      'flac',
      inside(p.root, p.config.audio!.score),
    ],
    p.root,
    {},
    true,
  );
}

function loudnessStats(stderr: string): LoudnessStats {
  const match = stderr.match(/\{\s*"input_i"[^}]+\}/g)?.at(-1);
  if (!match) {
    throw new Error('FFmpeg 未返回响度测量');
  }
  const value = JSON.parse(match) as LoudnessStats;
  const fields: (keyof LoudnessStats)[] = [
    'input_i',
    'input_tp',
    'input_lra',
    'input_thresh',
    'target_offset',
  ];
  if (fields.some((key) => !Number.isFinite(Number(value[key])))) {
    throw new Error('响度测量无效');
  }
  return value;
}

async function ffmpeg(p: Project, args: string[]) {
  const proc = Bun.spawn(['ffmpeg', '-hide_banner', '-nostdin', '-y', ...args], {
    cwd: p.root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(stderr.slice(-4000));
  }
  return { output: Buffer.from(output), stderr };
}

async function master(p: Project) {
  const timeline = measured(p);
  const { loudnessLUFS, truePeakDBTP } = voiceSettings(p).mastering;
  if (
    !Number.isFinite(loudnessLUFS) ||
    loudnessLUFS < -30 ||
    loudnessLUFS > -5 ||
    !Number.isFinite(truePeakDBTP) ||
    truePeakDBTP > -0.1 ||
    truePeakDBTP < -6
  ) {
    throw new Error('voice.json 的响度/真峰值参数超出支持范围');
  }
  const track = timeline.main;
  const source = inside(p.root, `.bcr/narration/${track.narrationFile}`);
  const filter = `pan=stereo|c0=c0|c1=c0,loudnorm=I=${loudnessLUFS}:TP=${truePeakDBTP}:LRA=11`;
  const measuredStats = loudnessStats(
    (await ffmpeg(p, ['-i', source, '-af', `${filter}:print_format=json`, '-f', 'null', '-']))
      .stderr,
  );
  const temporary = join(p.root, '.bcr/narration/main-master.wav');
  const destination = inside(p.root, `public/${track.audioFile}`);
  const normalization = `${filter}:measured_I=${measuredStats.input_i}:measured_TP=${measuredStats.input_tp}:measured_LRA=${measuredStats.input_lra}:measured_thresh=${measuredStats.input_thresh}:offset=${measuredStats.target_offset}:linear=true:print_format=json,aresample=48000,apad,atrim=end_sample=${track.samples}`;
  try {
    const applied = loudnessStats(
      (
        await ffmpeg(p, [
          '-i',
          source,
          '-af',
          normalization,
          '-ar',
          '48000',
          '-c:a',
          'pcm_s16le',
          temporary,
        ])
      ).stderr,
    );
    const verified = loudnessStats(
      (
        await ffmpeg(p, [
          '-i',
          temporary,
          '-af',
          `loudnorm=I=${loudnessLUFS}:TP=${truePeakDBTP}:LRA=11:print_format=json`,
          '-f',
          'null',
          '-',
        ])
      ).stderr,
    );
    if (
      Math.abs(Number(verified.input_i) - loudnessLUFS) > 0.3 ||
      Number(verified.input_tp) > truePeakDBTP + 0.1
    ) {
      throw new Error('母带响度或真峰值超出配置阈值');
    }
    await ffmpeg(p, ['-i', temporary, '-c:a', 'flac', '-compression_level', '8', destination]);
    const decode = (file: string) =>
      ffmpeg(p, ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-']);
    const [wav, flac] = await Promise.all([decode(temporary), decode(destination)]);
    if (!wav.output.equals(flac.output)) {
      throw new Error('FLAC 解码采样与 WAV 不一致');
    }
    atomicJSON(inside(p.root, p.config.audio!.mastering), {
      main: {
        measured: measuredStats,
        applied,
        verified,
        sha256: hashFile(destination),
        music: 'disabled',
        losslessMaster: { decodedSamplesMatchWav: true, decodedBytes: flac.output.length },
      },
    });
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (import.meta.main) {
  const [stage, root] = process.argv.slice(2);
  if (!root) {
    throw new Error('需要标准音频工程路径');
  }
  const p: Project = {
    root: resolve(root),
    id: json<Work>(join(root, 'work.json')).id,
    role: 'active',
    work: json<Work>(join(root, 'work.json')),
    config: json<Config>(join(root, 'production.json')),
  };
  const handlers = { voiceover, soundtrack, master };
  const handler = handlers[stage as keyof typeof handlers];
  if (!handler) {
    throw new Error(`未知音频阶段: ${stage}`);
  }
  await handler(p);
}

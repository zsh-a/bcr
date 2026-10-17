import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { atomicJSON, hashFile, inside, json, sha, stable } from '../lib/files';
import { command } from '../lib/process';
import type { Config, Project, Work } from '../project';
import { nativeAlignment } from './align';
import { audioCppSettings, nativeWav, paragraphRequest, runNativeTask } from './audiocpp';
import { contentHash, readContent, type VoiceSettings } from './content';
import { dramaRequest, dramaSettings, startDrama } from './drama';
import { recordedSource } from './recorded';

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
    !existsSync(inside(p.root, voice.referenceFile ?? 'public/audio/reference.wav'))
  ) {
    throw new Error(
      '请准备可使用的参考声音，在 voice.json 配置 referenceFile 与 referenceTranscript；草稿可先用 capture',
    );
  }
}

export interface NarrationProgram {
  fps: number;
  contentHash?: string;
  groups: { id: string; lines: { text: string }[]; gap: number; [key: string]: unknown }[];
  programs: Record<string, string[]>;
}

export async function voiceover(p: Project) {
  requireVoice(p);
  const content = readContent(p);
  await generateNarration(p, {
    fps: p.work.targets.find((target) => target.id === 'main')!.fps!,
    contentHash: contentHash(content),
    groups: content.paragraphs.map((paragraph) => ({ ...paragraph, gap: paragraph.gapAfter })),
    programs: { main: content.paragraphs.map((paragraph) => paragraph.id) },
  });
}

/** Native generation shared by JSON content and authored multi-track programs. */
export async function generateNarration(p: Project, program: NarrationProgram) {
  const cfg = p.config.audio!;
  const voice = voiceSettings(p);
  const reference = inside(p.root, voice.referenceFile ?? 'public/audio/reference.wav');
  const cache = inside(p.root, cfg.directory ?? '.bcr/narration');
  mkdirSync(cache, { recursive: true });
  const drama = voice.backend === 'drama-rs';
  const settings = {
    ...(drama ? dramaSettings(voice) : audioCppSettings(voice)),
    language: voice.language,
    referenceTranscript: voice.referenceTranscript,
    referenceHash: hashFile(reference),
  };
  const groups = [];
  const recorded = recordedSource(p.root, voice);
  let session: Awaited<ReturnType<typeof startDrama>> | undefined;
  try {
    for (const paragraph of program.groups) {
      const text = paragraph.lines.map((line) => line.text).join('');
      const { request, emotionHash } = drama
        ? { request: dramaRequest(voice, paragraph.id, text), emotionHash: undefined }
        : paragraphRequest(p.root, voice, paragraph.id, text);
      let source = recorded?.groups.find((group) => group.id === paragraph.id);
      if (recorded && (!source || source.text !== text || request.text !== text || emotionHash)) {
        if (recorded.onTextChange === 'generate') {
          source = undefined;
        } else {
          throw new Error(`已录旁白与当前完整语义段落不一致: ${paragraph.id}`);
        }
      }
      const derivation =
        source && recorded
          ? {
              planSha256: recorded.sha256,
              originalTtsHash: source.hash,
              sourceSha256: source.sourceSha256,
              source: source.raw,
              tempo: recorded.tempo,
              filter: `atempo=${recorded.tempo}`,
            }
          : undefined;
      const generation = { text: request.text, options: request.options, emotionHash, derivation };
      const computation = {
        ...generation,
        derivation: derivation
          ? {
              sourceSha256: derivation.sourceSha256,
              tempo: derivation.tempo,
              filter: derivation.filter,
            }
          : undefined,
      };
      const preserved = recorded?.tempo === 1 ? source : undefined;
      const hash = preserved
        ? basename(preserved.raw, '.wav')
        : sha(stable({ text, settings, generation: computation }));
      const raw = preserved ? preserved.raw : join(cache, `${hash}.wav`);
      const provenance = join(cache, `${hash}.generation.json`);
      if (!existsSync(raw)) {
        const temporary = `${raw}.tmp`;
        try {
          let nativeTiming: { wall_ms?: number } | undefined;
          if (source && derivation) {
            console.log(`Reuse original voice, tempo ${derivation.tempo}: ${paragraph.id}`);
            await command(
              [
                'ffmpeg',
                '-v',
                'error',
                '-nostdin',
                '-y',
                '-i',
                source.raw,
                '-af',
                derivation.filter,
                '-ar',
                '48000',
                '-ac',
                '1',
                '-c:a',
                'pcm_s16le',
                '-f',
                'wav',
                temporary,
              ],
              p.root,
              {},
              true,
            );
          } else if (drama) {
            console.log(`drama-rs ${settings.model}: ${paragraph.id}`);
            session ??= await startDrama(
              reference,
              voice.referenceTranscript,
              join(cache, 'drama-server.log'),
            );
            const started = performance.now();
            writeFileSync(temporary, await session.speak(request));
            nativeTiming = { wall_ms: performance.now() - started };
          } else {
            console.log(`audio.cpp ${settings.model}: ${paragraph.id}`);
            const result = await runNativeTask(
              settings as ReturnType<typeof audioCppSettings>,
              request as Parameters<typeof runNativeTask>[1],
            );
            nativeTiming = result.timing;
            writeFileSync(temporary, nativeWav(result));
          }
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
          atomicJSON(provenance, {
            backend: derivation ? 'recording-derivative' : settings.backend,
            settings,
            generation,
            request: derivation ? undefined : request,
            rawSha256: hashFile(temporary),
            durationSeconds: duration,
            nativeTiming,
          });
          renameSync(temporary, raw);
        } finally {
          rmSync(temporary, { force: true });
        }
      }
      if (preserved && !existsSync(provenance)) {
        atomicJSON(provenance, {
          backend: 'recording',
          settings,
          generation,
          rawSha256: preserved.sourceSha256,
        });
      }
      if (!existsSync(provenance)) {
        throw new Error(`原生 TTS 缓存缺少生成记录: ${paragraph.id}`);
      }
      if (json<{ rawSha256: string }>(provenance).rawSha256 !== hashFile(raw)) {
        throw new Error(`原生 TTS 缓存录音发生变化: ${paragraph.id}`);
      }
      groups.push({
        ...paragraph,
        text,
        hash,
        raw: cfg.directory ? relative(p.root, raw) : raw,
        generation: cfg.directory ? relative(p.root, provenance) : provenance,
        gap: paragraph.gap,
      });
    }
  } finally {
    await session?.close();
  }
  atomicJSON(inside(p.root, cfg.plan), {
    fps: program.fps,
    contentHash: program.contentHash,
    settings,
    groups,
    programs: program.programs,
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
  const source = inside(
    p.root,
    `${p.config.audio!.directory ?? '.bcr/narration'}/${track.narrationFile}`,
  );
  const filter = `pan=stereo|c0=c0|c1=c0,loudnorm=I=${loudnessLUFS}:TP=${truePeakDBTP}:LRA=11`;
  const measuredStats = loudnessStats(
    (await ffmpeg(p, ['-i', source, '-af', `${filter}:print_format=json`, '-f', 'null', '-']))
      .stderr,
  );
  const temporary = inside(
    p.root,
    `${p.config.audio!.directory ?? '.bcr/narration'}/main-master.wav`,
  );
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
  const handlers = { voiceover, align: nativeAlignment, soundtrack, master };
  const handler = handlers[stage as keyof typeof handlers];
  if (!handler) {
    throw new Error(`未知音频阶段: ${stage}`);
  }
  await handler(p);
}

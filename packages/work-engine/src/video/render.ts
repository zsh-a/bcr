import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  makeCancelSignal,
  renderFrames,
  selectComposition,
  stitchFramesToVideo,
} from '@remotion/renderer';
import { assertMeasured } from '../audio';
import {
  atomicJSON,
  CACHE,
  cacheGet,
  cachePut,
  command,
  hashFile,
  inside,
  json,
  locked,
  type Project,
  ROOT,
  sha,
  stable,
  type Target,
  targetIdentity,
} from '../core';
import { browser } from './browser';
import { build } from './build';
import { av1Level, encodeOptions, probe } from './encoding';
import { props } from './props';
import type { ArtifactReport } from './reports';
export interface RenderOptions {
  from?: number | undefined;
  to?: number | undefined;
  output?: string | undefined;
  encoder?: string | undefined;
  cpuReason?: string | undefined;
  cq?: number | undefined;
  concurrency?: number | undefined;
  scale?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: (progress: number, stage: string) => void;
}
export async function render(p: Project, t: Target, options: RenderOptions = {}) {
  if (p.config.stage === 'draft') {
    throw new Error('工程仍是草稿，请先执行 audio；草稿画面可用 preview/capture');
  }
  assertMeasured(p);
  const audio = p.config.targets[t.id]?.audio;
  const scale = options.scale ?? 1;
  const width = Math.round(t.width! * scale);
  const height = Math.round(t.height! * scale);
  if (!(scale > 0 && scale <= 1) || width % 2 || height % 2) {
    throw new Error('视频尺寸必须为偶数且缩放范围为 (0,1]');
  }
  const from = options.from ?? 0;
  const to = options.to ?? t.durationInFrames! - 1;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to >= t.durationInFrames!
  ) {
    throw new Error('渲染区间越界');
  }
  const encoder = options.encoder ?? 'av1_nvenc';
  const cq = options.cq ?? 20;
  const enc = [
    ...encodeOptions(encoder, cq, options.cpuReason),
    ...(encoder === 'av1_nvenc' ? ['-level', av1Level({ ...t, width, height }), '-tier', '0'] : []),
  ];
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('并发范围 1—16');
  }
  const { cancel, cancelSignal } = makeCancelSignal();
  options.signal?.addEventListener('abort', cancel, { once: true });
  options.signal?.throwIfAborted();
  return locked(`render:${p.id}`, () =>
    locked('shared-gpu', async () => {
      const b = await build(p, t, options.signal);
      const br = await browser(p);
      const ffmpegVersion = (await command(['ffmpeg', '-version'], ROOT, {}, true)).split('\n')[0];
      const frameKey = `frames-${sha(stable({ source: b.identity.key, browser: br.identity, from, to, scale, embeddedAudio: !audio }))}`;
      const key = sha(
        stable({
          frameKey,
          audioHash: audio ? hashFile(inside(p.root, `public/${audio}`)) : b.identity.key,
          encoder,
          cq,
          cpuReason: options.cpuReason,
          ffmpegVersion,
        }),
      );
      const dest = options.output
        ? resolve(options.output)
        : join(p.root, '.bcr/production/artifacts', `${t.id}-${key.slice(0, 16)}-av1.mp4`);
      if (existsSync(dest)) {
        const report = existsSync(`${dest}.json`) ? json<ArtifactReport>(`${dest}.json`) : null;
        if (report?.key === key && report.sha256 === hashFile(dest)) {
          console.log(`${p.id}/${t.id} video cache hit`);
          return { ...report, cached: true };
        }
        throw new Error(`拒绝覆盖已有文件: ${dest}`);
      }
      mkdirSync(CACHE, { recursive: true });
      mkdirSync(dirname(dest), { recursive: true });
      const smoke = join(CACHE, `${randomUUID()}-av1-smoke.mp4`);
      try {
        // Test the exact requested encoder before spending time on browser frames.
        await command(
          [
            'ffmpeg',
            '-v',
            'error',
            '-nostdin',
            '-n',
            '-f',
            'lavfi',
            '-i',
            `color=c=white:s=${width}x${height}:r=${t.fps}`,
            '-frames:v',
            '3',
            ...enc,
            '-pix_fmt',
            'yuv420p',
            smoke,
          ],
          ROOT,
          {},
          true,
        );
        await command(['ffmpeg', '-v', 'error', '-i', smoke, '-f', 'null', '-'], ROOT, {}, true);
      } finally {
        rmSync(smoke, { force: true });
      }
      let frames = cacheGet(frameKey);
      const cachedFrames = !!frames;
      const frameStart = performance.now();
      if (!frames) {
        const stage = join(CACHE, `${frameKey}.${randomUUID()}.tmp`);
        mkdirSync(stage, { recursive: true });
        try {
          const composition = await selectComposition({
            serveUrl: b.dir,
            id: 'Managed',
            inputProps: props(p, t),
            ...br.options,
            logLevel: 'error',
          });
          let last = 0;
          const result = await renderFrames({
            composition,
            serveUrl: b.dir,
            outputDir: join(stage, 'frames'),
            imageFormat: 'png',
            frameRange: [from, to],
            concurrency,
            muted: !!audio,
            scale,
            cancelSignal,
            inputProps: props(p, t),
            ...br.options,
            logLevel: 'error',
            onStart: () => console.log(`${p.id}/${t.id} ${to - from + 1} frames`),
            onFrameUpdate: (n) => {
              options.onProgress?.(0.2 + (0.6 * n) / (to - from + 1), '渲染画面');
              if (Date.now() - last > 10000) {
                console.log(`frames ${n}/${to - from + 1}`);
                last = Date.now();
              }
            },
          });
          if (!audio) {
            await stitchFramesToVideo({
              fps: t.fps!,
              width,
              height,
              assetsInfo: result.assetsInfo,
              outputLocation: join(stage, 'audio.wav'),
              codec: 'wav',
              sampleRate: 48000,
              enforceAudioTrack: true,
              cancelSignal,
            });
          }
          const pattern = relative(stage, result.assetsInfo.imageSequenceName);
          atomicJSON(join(stage, 'frames.json'), {
            pattern,
            firstFrame: result.assetsInfo.firstFrameIndex,
            frameCount: result.frameCount,
            source: b.identity.key,
          });
          const final = join(CACHE, frameKey);
          if (existsSync(final)) {
            rmSync(final, { recursive: true });
          }
          renameSync(stage, final);
          cachePut(frameKey, 'frames', final);
          frames = final;
        } catch (error) {
          rmSync(stage, { recursive: true, force: true });
          throw error;
        }
      }
      const frameSeconds = (performance.now() - frameStart) / 1000;
      const info = json<{ pattern: string; firstFrame: number }>(join(frames, 'frames.json'));
      const bundledAudio = audio ? join(b.dir, 'public', audio) : join(frames, 'audio.wav');
      const audioHash = hashFile(bundledAudio);
      if (audio && audioHash !== hashFile(inside(p.root, `public/${audio}`))) {
        throw new Error('打包母带与当前母带不一致');
      }
      const temp = `${dest}.${randomUUID()}.mp4`;
      const count = to - from + 1;
      const encodingStart = performance.now();
      const cmd = [
        'ffmpeg',
        '-v',
        'error',
        '-nostdin',
        '-n',
        '-framerate',
        String(t.fps),
        '-start_number',
        String(info.firstFrame),
        '-i',
        join(frames, info.pattern),
        '-ss',
        String(audio ? from / t.fps! : 0),
        '-i',
        bundledAudio,
        '-t',
        String(count / t.fps!),
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-frames:v',
        String(count),
        '-vf',
        'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
        ...enc,
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
        temp,
      ];
      try {
        options.onProgress?.(0.85, '编码 AV1 与检查音轨');
        await command(cmd, ROOT, {}, true, options.signal);
        const media = await probe(temp);
        const video = media.streams.find((s) => s.codec_type === 'video');
        const sound = media.streams.find((s) => s.codec_type === 'audio');
        if (
          video?.codec_name !== 'av1' ||
          Number(video.nb_read_frames) !== count ||
          video.width !== width ||
          video.height !== height ||
          !sound ||
          sound.sample_rate !== '48000'
        ) {
          throw new Error('成片流/帧数/音频格式不符');
        }
        if (Math.abs(Number(media.format.duration) - count / t.fps!) > 0.15) {
          throw new Error('成片时长不符');
        }
        await command(
          ['ffmpeg', '-v', 'error', '-i', temp, '-f', 'null', '-'],
          ROOT,
          {},
          true,
          options.signal,
        );
        if (targetIdentity(p, t).key !== b.identity.key) {
          throw new Error('渲染期间输入变化，请重新运行');
        }
        renameSync(temp, dest);
        const report = {
          status: 'succeeded',
          key,
          project: p.id,
          target: t.id,
          path: dest,
          sha256: hashFile(dest),
          input: b.identity,
          scope: from === 0 && to === t.durationInFrames! - 1 ? 'full' : 'sample',
          range: [from, to],
          frames: count,
          fps: t.fps,
          scale,
          encoder,
          cq,
          cpuFallbackReason: options.cpuReason ?? null,
          frameCacheHit: cachedFrames,
          frameRenderSeconds: frameSeconds,
          encodingSeconds: (performance.now() - encodingStart) / 1000,
          browser: br.identity,
          ffmpegVersion,
          audioSha256: audioHash,
          command: cmd,
          media,
          automaticChecks: 'passed',
          manualListening: 'pending',
          manualViewing: 'pending',
          platformTranscode: 'pending',
          createdAt: new Date().toISOString(),
        };
        atomicJSON(`${dest}.json`, report);
        return report;
      } finally {
        rmSync(temp, { force: true });
      }
    }),
  ).finally(() => options.signal?.removeEventListener('abort', cancel));
}

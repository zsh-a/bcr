import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertMeasured } from '../../audio';
import { atomicJSON, hashFile, inside, json, sha, stable } from '../../lib/files';
import { assertWritableOutput } from '../../lib/output';
import { command } from '../../lib/process';
import { prepareRuntime, readRuntime } from '../../pipeline/runtime';
import { type Project, type Target, targetIdentity } from '../../project';
import { locked } from '../../state/lock';
import { browser } from '../browser';
import { build } from '../build';
import { av1Level, encodeOptions, probe } from '../encoding';
import { renderIdentity, videoProducer } from '../identity';
import type { RenderOptions } from '../render';
import type { ArtifactReport } from '../reports';
import { composeScenes } from './compose';
import { renderScene } from './frames';
import { planScenes, readCatalog } from './plan';

export async function renderScenes(p: Project, t: Target, options: RenderOptions = {}) {
  assertMeasured(p);
  prepareRuntime(p);
  const runtime = readRuntime(p);
  const from = options.from ?? 0;
  const to = options.to ?? runtime.main.durationInFrames - 1;
  const concurrency = options.concurrency ?? 4;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to >= runtime.main.durationInFrames ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16 ||
    (options.scale !== undefined && options.scale !== 1)
  ) {
    throw new Error('镜头渲染区间、并发或缩放无效');
  }
  const encoder = options.encoder ?? 'av1_nvenc';
  const cq = options.cq ?? 20;
  const encoding = [
    ...encodeOptions(encoder, cq, options.cpuReason),
    ...(encoder === 'av1_nvenc' ? ['-level', av1Level(t), '-tier', '0'] : []),
  ];
  return locked(`render:${p.id}`, () =>
    locked('shared-gpu', async () => {
      const start = performance.now();
      const identity = targetIdentity(p, t);
      const br = await browser(p);
      const ffmpegVersion = (await command(['ffmpeg', '-version'], p.root, {}, true)).split(
        '\n',
      )[0];
      const environment = {
        browser: br.identity,
        ffmpegVersion,
        imageFormat: 'png',
        lossless: 'ffv1-bgr0-v2',
      };
      const plan = planScenes(p, t, environment).filter(
        (item) => item.contract.start <= to && item.contract.end > from,
      );
      const audio = inside(
        p.root,
        `public/${p.config.targets[t.id]?.audio ?? runtime.main.audioFile}`,
      );
      const audioSha256 = hashFile(audio);
      const renderInput = renderIdentity(p, t);
      const key = sha(
        stable({
          renderInput: renderInput.key,
          scenes: plan.map((item) => item.key),
          from,
          to,
          audioSha256,
          progress: readCatalog(p).progress ?? p.config.scenes?.progress,
          encoder,
          cq,
          ffmpegVersion,
          producer: videoProducer(),
        }),
      );
      const destination = assertWritableOutput(
        options.output
          ? resolve(options.output)
          : join(p.root, '.bcr/production/artifacts', `${t.id}-${key.slice(0, 16)}-av1.mp4`),
      );
      if (existsSync(destination)) {
        const report = existsSync(`${destination}.json`)
          ? json<ArtifactReport>(`${destination}.json`)
          : undefined;
        if (report?.key === key && report.sha256 === hashFile(destination)) {
          return { ...report, cached: true };
        }
        throw new Error(`拒绝覆盖已有文件: ${destination}`);
      }
      mkdirSync(dirname(destination), { recursive: true });
      const bundle = await build(p, t, options.signal);
      const smoke = join(dirname(destination), `${randomUUID()}-smoke.mp4`);
      try {
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
            `color=s=${t.width}x${t.height}:r=${t.fps}`,
            '-frames:v',
            '3',
            ...encoding,
            '-pix_fmt',
            'yuv420p',
            smoke,
          ],
          p.root,
          {},
          true,
          options.signal,
        );
        await command(
          ['ffmpeg', '-v', 'error', '-i', smoke, '-f', 'null', '-'],
          p.root,
          {},
          true,
          options.signal,
        );
      } finally {
        rmSync(smoke, { force: true });
      }
      const records = [];
      for (const item of plan) {
        options.signal?.throwIfAborted();
        records.push(await renderScene(item, t, bundle.dir, br, concurrency, options.signal));
        if (targetIdentity(p, t).key !== identity.key) {
          throw new Error('镜头渲染期间制作输入变化');
        }
      }
      const frameRenderSeconds = (performance.now() - start) / 1000;
      const temporary = `${destination}.${randomUUID()}.mp4`;
      const encodingStart = performance.now();
      try {
        const cmd = await composeScenes(
          p,
          t,
          runtime,
          records.map((record) => record.path),
          from - plan[0]!.contract.start,
          from,
          to,
          audio,
          temporary,
          encoding,
          options.signal,
        );
        const media = await probe(temporary);
        const video = media.streams.find((stream) => stream.codec_type === 'video');
        const sound = media.streams.find((stream) => stream.codec_type === 'audio');
        const count = to - from + 1;
        if (
          video?.codec_name !== 'av1' ||
          Number(video.nb_read_frames) !== count ||
          video.width !== t.width ||
          video.height !== t.height ||
          sound?.sample_rate !== '48000' ||
          Math.abs(Number(media.format.duration) - count / t.fps!) > 0.15
        ) {
          throw new Error('成片规格、帧数或声音不符');
        }
        await command(
          ['ffmpeg', '-v', 'error', '-i', temporary, '-f', 'null', '-'],
          p.root,
          {},
          true,
          options.signal,
        );
        if (targetIdentity(p, t).key !== identity.key || hashFile(audio) !== audioSha256) {
          throw new Error('制作输入变化');
        }
        renameSync(temporary, destination);
        const report = {
          status: 'succeeded',
          renderer: 'scenes' as const,
          project: p.id,
          target: t.id,
          path: destination,
          key,
          input: identity,
          renderInput,
          sha256: hashFile(destination),
          scope: from === 0 && to === runtime.main.durationInFrames - 1 ? 'full' : 'sample',
          range: [from, to],
          frames: count,
          fps: t.fps!,
          scale: 1,
          encoder,
          cq,
          frameRenderSeconds,
          encodingSeconds: (performance.now() - encodingStart) / 1000,
          frameCacheHit: records.every((record) => record.cacheHit),
          scenes: records,
          browser: br.identity,
          ffmpegVersion,
          audioSha256,
          command: cmd,
          media,
          automaticChecks: 'passed',
          manualListening: 'pending',
          manualViewing: 'pending',
          platformTranscode: 'pending',
          createdAt: new Date().toISOString(),
        };
        atomicJSON(`${destination}.json`, report);
        return report;
      } finally {
        rmSync(temporary, { force: true });
      }
    }),
  );
}

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeCancelSignal, renderFrames, selectComposition } from '@remotion/renderer';
import { atomicJSON, hashFile } from '../../lib/files';
import { CACHE } from '../../lib/paths';
import { command } from '../../lib/process';
import type { Target } from '../../project';
import { cacheGet, cachePut } from '../../state/cache';
import type { browser } from '../browser';
import { probe } from '../encoding';
import type { ScenePlan } from './plan';

export async function decodedRGB(path: string, frames: number[]) {
  const child = Bun.spawn(
    [
      'ffmpeg',
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `select=${frames.map((frame) => `eq(n\\,${frame})`).join('+')}`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      String(frames.length),
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [data, error, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(error);
  }
  return Buffer.from(data);
}

export async function renderScene(
  item: ScenePlan,
  target: Target,
  bundle: string,
  br: Awaited<ReturnType<typeof browser>>,
  concurrency: number,
  signal?: AbortSignal,
) {
  const cacheKey = `scene-${item.key}`;
  const hit = cacheGet(cacheKey);
  if (hit) {
    return {
      id: item.contract.id,
      key: item.key,
      path: join(hit, 'scene.mkv'),
      sha256: hashFile(join(hit, 'scene.mkv')),
      frames: item.input.main.durationInFrames,
      cacheHit: true,
    };
  }
  const stage = join(CACHE, `${cacheKey}.${randomUUID()}.tmp`);
  mkdirSync(stage, { recursive: true });
  const { cancel, cancelSignal } = makeCancelSignal();
  signal?.addEventListener('abort', cancel, { once: true });
  signal?.throwIfAborted();
  try {
    const inputProps = { scene: item.input };
    const composition = await selectComposition({
      serveUrl: bundle,
      id: 'Managed',
      inputProps,
      ...br.options,
      logLevel: 'error',
    });
    const count = item.input.main.durationInFrames;
    let last = 0;
    const result = await renderFrames({
      serveUrl: bundle,
      composition: { ...composition, durationInFrames: count },
      inputProps,
      outputDir: join(stage, 'frames'),
      imageFormat: 'png',
      frameRange: [0, count - 1],
      concurrency,
      muted: true,
      cancelSignal,
      ...br.options,
      logLevel: 'error',
      onStart: () => {},
      onFrameUpdate: (done) => {
        if (performance.now() - last > 10000) {
          console.log(`scene ${item.contract.id}: ${done}/${count}`);
          last = performance.now();
        }
      },
    });
    const path = join(stage, 'scene.mkv');
    await command(
      [
        'ffmpeg',
        '-v',
        'error',
        '-nostdin',
        '-n',
        '-framerate',
        String(target.fps),
        '-start_number',
        String(result.assetsInfo.firstFrameIndex),
        '-i',
        result.assetsInfo.imageSequenceName,
        '-frames:v',
        String(count),
        '-vf',
        'format=bgr0',
        '-c:v',
        'ffv1',
        '-level',
        '3',
        '-coder',
        '1',
        '-context',
        '1',
        '-g',
        '1',
        '-threads',
        '4',
        path,
      ],
      stage,
      {},
      true,
      signal,
    );
    const media = await probe(path);
    const video = media.streams.find((stream) => stream.codec_type === 'video');
    if (
      video?.codec_name !== 'ffv1' ||
      Number(video.nb_read_frames) !== count ||
      video.width !== target.width ||
      video.height !== target.height ||
      media.streams.some((stream) => stream.codec_type === 'audio')
    ) {
      throw new Error(`镜头缓存规格不符: ${item.contract.id}`);
    }
    const proofFrames = [...new Set([0, Math.floor(count / 2), count - 1])];
    const pixels = await decodedRGB(path, proofFrames);
    const bytes = target.width! * target.height! * 3;
    if (pixels.length !== proofFrames.length * bytes) {
      throw new Error('镜头缓存解码不完整');
    }
    for (const [index, frame] of proofFrames.entries()) {
      const png = result.assetsInfo.imageSequenceName.replace(/%0?(\d*)d/, (_, width: string) =>
        String(result.assetsInfo.firstFrameIndex + frame).padStart(Number(width) || 0, '0'),
      );
      if (!pixels.subarray(index * bytes, (index + 1) * bytes).equals(await decodedRGB(png, [0]))) {
        throw new Error(`无损 RGB 不一致: ${item.contract.id}/${frame}`);
      }
    }
    rmSync(join(stage, 'frames'), { recursive: true, force: true });
    atomicJSON(join(stage, 'scene.json'), { ...item, proofFrames, sha256: hashFile(path) });
    const destination = join(CACHE, cacheKey);
    if (existsSync(destination)) {
      rmSync(destination, { recursive: true, force: true });
    }
    renameSync(stage, destination);
    cachePut(cacheKey, 'scene', destination);
    return {
      id: item.contract.id,
      key: item.key,
      path: join(destination, 'scene.mkv'),
      sha256: hashFile(join(destination, 'scene.mkv')),
      frames: count,
      cacheHit: false,
    };
  } finally {
    signal?.removeEventListener('abort', cancel);
    rmSync(stage, { recursive: true, force: true });
  }
}

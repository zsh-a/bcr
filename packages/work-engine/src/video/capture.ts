import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeCancelSignal, renderStill, selectComposition } from '@remotion/renderer';
import {
  atomicJSON,
  hashFile,
  json,
  locked,
  type Project,
  sha,
  stable,
  type Target,
  targetIdentity,
} from '../core';
import { browser } from './browser';
import { build } from './build';
import { props } from './props';
import type { ArtifactReport } from './reports';
export async function capture(
  p: Project,
  t: Target,
  frame = 0,
  output?: string,
  options: { scale?: number; signal?: AbortSignal } = {},
) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= t.durationInFrames!) {
    throw new Error('帧号越界');
  }
  const { cancel, cancelSignal } = makeCancelSignal();
  options.signal?.addEventListener('abort', cancel, { once: true });
  options.signal?.throwIfAborted();
  return locked(`render:${p.id}`, async () => {
    const b = await build(p, t, options.signal);
    const br = await browser(p);
    const key = sha(
      stable({ source: b.identity.key, browser: br.identity, frame, scale: options.scale ?? 1 }),
    );
    const dest = output
      ? resolve(output)
      : join(p.root, '.bcr/production/artifacts', `${t.id}-${key.slice(0, 16)}.png`);
    if (existsSync(dest)) {
      const report = existsSync(`${dest}.json`) ? json<ArtifactReport>(`${dest}.json`) : null;
      if (report?.key === key && report.sha256 === hashFile(dest)) {
        return { ...report, cached: true, path: dest };
      }
      throw new Error(`拒绝覆盖已有文件: ${dest}`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    const temp = `${dest}.${randomUUID()}.png`;
    try {
      const composition = await selectComposition({
        serveUrl: b.dir,
        id: 'Managed',
        inputProps: props(p, t),
        ...br.options,
        logLevel: 'error',
      });
      await renderStill({
        composition,
        serveUrl: b.dir,
        output: temp,
        frame,
        inputProps: props(p, t),
        imageFormat: 'png',
        scale: options.scale ?? 1,
        cancelSignal,
        ...br.options,
        logLevel: 'error',
      });
      if (targetIdentity(p, t).key !== b.identity.key) {
        throw new Error('捕获期间输入变化');
      }
      renameSync(temp, dest);
      const report = {
        key,
        project: p.id,
        target: t.id,
        frame,
        input: b.identity,
        browser: br.identity,
        sha256: hashFile(dest),
        path: dest,
        status: 'succeeded',
        manualVisualReview: 'pending',
      };
      atomicJSON(`${dest}.json`, report);
      return report;
    } finally {
      rmSync(temp, { force: true });
    }
  }).finally(() => options.signal?.removeEventListener('abort', cancel));
}

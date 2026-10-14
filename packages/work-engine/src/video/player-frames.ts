import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { atomicJSON } from '../lib/files';
import type { Project, Target } from '../project';
import type { browser } from './browser';
import { startPreview } from './preview';
import { connectReviewPage, seekReviewFrame } from './review';

/** Capture the same immutable Player preview used by QA; encoding and GC stay shared. */
export async function renderPlayerFrames(
  p: Project,
  t: Target,
  options: {
    directory: string;
    from: number;
    to: number;
    concurrency: number;
    scale: number;
    inputKey: string;
    browser: Awaited<ReturnType<typeof browser>>;
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: number, stage: string) => void) | undefined;
  },
) {
  const preview = await startPreview(p, t);
  let instance: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (preview.input.key !== options.inputKey) {
      throw new Error('浏览器捕获与源码快照身份不符');
    }
    instance = await chromium.launch({
      executablePath: options.browser.executable,
      headless: options.browser.identity.headless,
      args: ['--no-sandbox'],
    });
    const close = () => void instance?.close();
    options.signal?.addEventListener('abort', close, { once: true });
    try {
      const errors: string[] = [];
      const count = options.to - options.from + 1;
      const workers = Math.min(options.concurrency, count);
      let completed = 0;
      await Promise.all(
        Array.from({ length: workers }, async (_, worker) => {
          const page = await instance!.newPage({
            viewport: { width: t.width!, height: t.height! },
            deviceScaleFactor: options.scale,
          });
          try {
            page.on('pageerror', (error) => errors.push(error.message));
            await connectReviewPage(page, preview.url, options.inputKey);
            for (let frame = options.from + worker; frame <= options.to; frame += workers) {
              options.signal?.throwIfAborted();
              await seekReviewFrame(page, frame);
              await page.screenshot({
                path: join(options.directory, `element-${String(frame).padStart(5, '0')}.png`),
              });
              completed++;
              options.onProgress?.(0.2 + (0.6 * completed) / count, '浏览器捕获画面');
              if (completed % 500 === 0) {
                console.log(`browser frames ${completed}/${count}`);
              }
            }
          } finally {
            await page.close();
          }
        }),
      );
      if (errors.length) {
        throw new Error(`浏览器画面错误: ${errors.join('\n')}`);
      }
      atomicJSON(join(options.directory, 'player.json'), {
        input: preview.input,
        browser: instance.version(),
        method: 'Immutable Player preview; two animation frames per seek; Playwright PNG',
        range: [options.from, options.to],
        workers,
      });
    } finally {
      options.signal?.removeEventListener('abort', close);
    }
  } finally {
    await instance?.close();
    preview.stop();
  }
}

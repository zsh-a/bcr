import type { Page } from 'playwright-core';

/** One preview connection and readiness contract for browser QA and Player renders. */
export async function connectReviewPage(page: Page, url: string, inputKey: string) {
  const response = await fetch(new URL('__bcr/identity', url));
  const identity = (await response.json()) as { input?: { key: string } };
  if (!response.ok || identity.input?.key !== inputKey) {
    throw new Error('验收浏览器与制作输入不一致');
  }
  await page.goto(`${url}?qa`);
  await page.waitForFunction(() => !!document.querySelector('#root')?.children.length);
  await page.waitForFunction(
    () => (window as Window & { remotion_renderReady?: boolean }).remotion_renderReady !== false,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    const channel = new MessageChannel();
    const pending = new Map<string, { done: () => void; fail: (error: Error) => void }>();
    let serial = 0;
    const ready = new Promise<void>((done) => {
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          done();
        }
        const request = pending.get(data.id);
        if (request) {
          pending.delete(data.id);
          if (data.error) {
            request.fail(new Error(data.error));
          } else {
            request.done();
          }
        }
      };
    });
    Object.defineProperty(window, 'bcrSeek', {
      value: (frame: number) =>
        new Promise<void>((done, fail) => {
          const id = String(++serial);
          pending.set(id, { done, fail });
          channel.port1.postMessage({ id, action: 'seek', frame });
        }),
    });
    window.postMessage('bcr-work-connect', location.origin, [channel.port2]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        new Promise<never>((_, fail) => {
          timer = setTimeout(() => fail(new Error('预览连接超时')), 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function seekReviewFrame(page: Page, frame: number) {
  await page.evaluate(async (value) => {
    const seek = (window as Window & { bcrSeek?: (frame: number) => Promise<void> }).bcrSeek;
    if (!seek) {
      throw new Error('预览定位接口尚未就绪');
    }
    await seek(value);
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  }, frame);
}

import type { PlayerRef } from '@remotion/player';

interface PlayerHandle {
  current: PlayerRef | null;
}
interface PageReviewAPI {
  capture(): Promise<unknown>;
  restore(state: unknown): Promise<unknown>;
}
interface Command {
  id?: string;
  action: string;
  frame?: number;
  values?: unknown;
  page?: unknown;
}

/** The same MessagePort protocol drives CLI previews, Works seeking and page reviews. */
export function connectPreview(player?: PlayerHandle, updateProps?: (values: unknown) => void) {
  let port: MessagePort | undefined;
  const send = (value: unknown) => port?.postMessage(value);
  const status = () => ({
    frame: player?.current?.getCurrentFrame() ?? null,
    text: document.body.innerText.slice(0, 8000),
    path: location.pathname.split('/').slice(2).map(decodeURIComponent).join('/'),
  });
  const report = (event: ErrorEvent) =>
    send({ type: 'report', message: event.message.slice(0, 2000) });
  const rejection = (event: PromiseRejectionEvent) =>
    send({ type: 'report', message: String(event.reason).slice(0, 2000) });
  const connect = (event: MessageEvent) => {
    if (
      (event.source !== parent && event.source !== window) ||
      event.data !== 'bcr-work-connect' ||
      !event.ports[0] ||
      port
    ) {
      return;
    }
    port = event.ports[0];
    port.onmessage = async ({ data }: MessageEvent<Command>) => {
      try {
        if (data.action === 'page-state' || data.action === 'page-restore') {
          const api = (window as Window & { __bcrPageReview?: PageReviewAPI }).__bcrPageReview;
          if (!api) {
            throw new Error('此预览不支持页面状态，请生成新预览');
          }
          const result =
            data.action === 'page-state' ? await api.capture() : await api.restore(data.page);
          const pageResult =
            data.action === 'page-state' ? { ...(result as object), path: status().path } : result;
          send({ type: 'result', id: data.id, result: { pageResult } });
          return;
        }
        if (data.action === 'seek') {
          if (!Number.isInteger(data.frame) || data.frame === undefined || data.frame < 0) {
            throw new Error('帧号无效');
          }
          player?.current?.seekTo(data.frame);
        }
        if (data.action === 'play') {
          player?.current?.play();
        }
        if (data.action === 'pause') {
          player?.current?.pause();
        }
        if (data.action === 'parameters') {
          if (!updateProps) {
            throw new Error('此预览不支持参数试调');
          }
          updateProps(data.values);
        }
        send({ type: 'result', id: data.id, result: status() });
      } catch (error) {
        send({ type: 'result', id: data.id, error: String(error) });
      }
    };
    const ready = () => {
      if (player && !player.current) {
        requestAnimationFrame(ready);
        return;
      }
      const current = player?.current;
      let lastUpdate = 0;
      const publish = () => {
        lastUpdate = performance.now();
        send({ type: 'frame', frame: current?.getCurrentFrame() });
      };
      const onFrame = () => {
        if (!current?.isPlaying() || performance.now() - lastUpdate >= 100) {
          publish();
        }
      };
      current?.addEventListener('frameupdate', onFrame);
      current?.addEventListener('pause', publish);
      current?.addEventListener('seeked', publish);
      window.addEventListener(
        'pagehide',
        () => {
          current?.removeEventListener('frameupdate', onFrame);
          current?.removeEventListener('pause', publish);
          current?.removeEventListener('seeked', publish);
        },
        { once: true },
      );
      send({ type: 'ready', parameters: !!updateProps, ...status() });
    };
    ready();
  };
  window.addEventListener('error', report);
  window.addEventListener('unhandledrejection', rejection);
  window.addEventListener('message', connect);
  return () => {
    window.removeEventListener('error', report);
    window.removeEventListener('unhandledrejection', rejection);
    window.removeEventListener('message', connect);
    port?.close();
  };
}

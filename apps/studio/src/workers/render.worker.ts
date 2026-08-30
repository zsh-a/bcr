/**
 * render.worker（架构文档 §5）：OffscreenCanvas 在 Worker 内渲染波形，
 * 主线程只负责 DOM 与交互，不承担高频图形渲染。
 */

interface AttachMessage {
  type: "attach";
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
}
interface ResizeMessage {
  type: "resize";
  width: number;
  height: number;
  dpr: number;
}
interface PeaksMessage {
  type: "peaks";
  peaks: Float32Array;
}
interface ClearMessage {
  type: "clear";
}
type RenderMessage = AttachMessage | ResizeMessage | PeaksMessage | ClearMessage;

let canvas: OffscreenCanvas | undefined;
let dpr = 1;
let peaks: Float32Array | undefined;

const BG = "#10131a";
const CENTER = "#2e3648";
const BAR_TOP = "#3fe0a5";
const BAR_BOTTOM = "#17795c";

function draw(): void {
  if (canvas === undefined) return;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const { width, height } = canvas;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // 中线 + 1/4 参考线（hairline）
  ctx.strokeStyle = CENTER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2 + 0.5);
  ctx.lineTo(width, height / 2 + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  for (const y of [height / 4, (height * 3) / 4]) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (peaks === undefined || peaks.length === 0) return;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, BAR_TOP);
  gradient.addColorStop(1, BAR_BOTTOM);
  ctx.fillStyle = gradient;

  const n = peaks.length;
  const barWidth = width / n;
  const half = height / 2;
  const maxBar = half * 0.92;
  for (let i = 0; i < n; i += 1) {
    const amplitude = Math.min(1, peaks[i] ?? 0);
    const bar = Math.max(dpr, amplitude * maxBar);
    const x = i * barWidth;
    ctx.fillRect(x, half - bar, Math.max(barWidth * 0.72, dpr), bar * 2);
  }
}

const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

scope.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as RenderMessage;
  switch (message.type) {
    case "attach":
      canvas = message.canvas;
      dpr = message.dpr;
      canvas.width = Math.round(message.width * dpr);
      canvas.height = Math.round(message.height * dpr);
      draw();
      break;
    case "resize":
      if (canvas !== undefined) {
        dpr = message.dpr;
        canvas.width = Math.round(message.width * dpr);
        canvas.height = Math.round(message.height * dpr);
        draw();
      }
      break;
    case "peaks":
      peaks = message.peaks;
      draw();
      break;
    case "clear":
      peaks = undefined;
      draw();
      break;
  }
});

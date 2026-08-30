import { useEffect, useRef } from "react";
import { useStudio } from "../store";

/** 波形画布：2048 桶峰值包络 + 播放光标 + 点击定位。 */
export function Waveform(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSeek: (seconds: number) => void;
}) {
  const peaks = useStudio((state) => state.peaks);
  const duration = useStudio((state) => state.mediaInfo?.durationS ?? 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0d1017";
      ctx.fillRect(0, 0, width, height);

      const data = peaks;
      if (data !== null && data.length > 0) {
        const mid = height / 2;
        ctx.fillStyle = "#3fe0a5";
        const bucketWidth = width / data.length;
        for (let i = 0; i < data.length; i += 1) {
          const amplitude = Math.min(1, (data[i] ?? 0) * 1.6);
          const barHeight = Math.max(1, amplitude * (height / 2 - 4));
          ctx.fillRect(
            i * bucketWidth,
            mid - barHeight,
            Math.max(1, bucketWidth * 0.8),
            barHeight * 2,
          );
        }
      } else {
        ctx.fillStyle = "#5a6376";
        ctx.font = "11px 'IBM Plex Sans'";
        ctx.textAlign = "center";
        ctx.fillText("生成流水线后在此显示波形", width / 2, height / 2);
      }

      // 播放光标
      const video = props.videoRef.current;
      if (video !== null && duration > 0) {
        const x = (video.currentTime / duration) * width;
        ctx.fillStyle = "#f0b357";
        ctx.fillRect(x - 0.5, 0, 1.5, height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, duration, props.videoRef]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="waveform"
      className="h-20 w-full cursor-crosshair rounded border border-[var(--color-border)]"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        props.onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    />
  );
}

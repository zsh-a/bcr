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

    // 数据色从共享语义令牌取值（系列/游标/提示），主题切换时重新读取
    const readTheme = () => {
      const style = getComputedStyle(canvas);
      return {
        bg: style.getPropertyValue("--color-bg").trim(),
        series: style.getPropertyValue("--color-success").trim(),
        hint: style.getPropertyValue("--color-faint").trim(),
        cursor: style.getPropertyValue("--color-amber").trim(),
        font: `${style.getPropertyValue("--text-xs").trim() || "11px"} ${style.getPropertyValue("--font-sans").trim()}`,
      };
    };
    let theme = readTheme();
    const observer = new MutationObserver(() => {
      theme = readTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

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
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, width, height);

      const data = peaks;
      if (data !== null && data.length > 0) {
        const mid = height / 2;
        ctx.fillStyle = theme.series;
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
        ctx.fillStyle = theme.hint;
        ctx.font = theme.font;
        ctx.textAlign = "center";
        ctx.fillText("生成流水线后在此显示波形", width / 2, height / 2);
      }

      // 播放光标
      const video = props.videoRef.current;
      if (video !== null && duration > 0) {
        const x = (video.currentTime / duration) * width;
        ctx.fillStyle = theme.cursor;
        ctx.fillRect(x - 0.5, 0, 1.5, height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [peaks, duration, props.videoRef]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="waveform"
      className="h-20 w-full cursor-crosshair rounded-sm border border-[var(--color-border)]"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        props.onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    />
  );
}

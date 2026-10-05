import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { result } from "./model.js";
import { CostStage } from "./src/three/CostStage";

type Props = { value: number };

export default function Scene({ value }: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  const progress = interpolate(frame, [0, Math.min(45, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const computed = result({ value });
  const orbit = frame / (fps * 12);
  return (
    <AbsoluteFill
      style={{
        background: "#f5f6f2",
        color: "#17231e",
        padding: 96,
        justifyContent: "center",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        data-video-canvas
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 1,
          overflow: "hidden",
          opacity: progress,
          transform: `translateY(${(1 - progress) * 36}px)`,
        }}
      >
        <CostStage value={value} progress={orbit} width={width} height={height} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: 96,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "#5c7467", fontSize: 28, letterSpacing: 5 }}>NEW WORK</div>
          <div>
            <div style={{ marginTop: 42, fontSize: 124, fontWeight: 700, letterSpacing: -8 }}>
              {computed.value}
            </div>
            <div style={{ marginTop: 28, fontSize: 44, color: "#ff9c71" }}>
              结果 {computed.doubled}
            </div>
          </div>
          <div style={{ marginTop: 90, fontSize: 28, color: "#5c7467", lineHeight: 1.6 }}>
            Three.js 物件与文字都由帧号驱动。
            <br />
            从这里开始替换数据、模型和场景。
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

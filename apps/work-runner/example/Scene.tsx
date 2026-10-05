import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { wipe } from "@remotion/transitions/wipe";
import { fade } from "@remotion/transitions/fade";
import { theme, fontsReady } from "./src/theme";
import { timeline } from "./src/motion";
import { Price } from "./src/scenes/Price";
import { Attendance } from "./src/scenes/Attendance";
import { Average } from "./src/scenes/Average";
import { Comparison } from "./src/scenes/Comparison";
import { Scenarios } from "./src/scenes/Scenarios";
import { Decision } from "./src/scenes/Decision";
import type { Inputs } from "./src/scenes/types";
import "./Scene.css";

const components = {
  price: Price,
  attendance: Attendance,
  average: Average,
  comparison: Comparison,
  scenarios: Scenarios,
  decision: Decision,
};

export default function GymCard(props: Inputs & { sound?: boolean }) {
  const frame = useCurrentFrame(),
    { fps, durationInFrames, width, height } = useVideoConfig();
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender("加载作品字体"));
  useEffect(() => {
    void fontsReady.then(() => setReady(true)).catch(cancelRender);
  }, []);
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle]);
  const scenes = timeline(durationInFrames, fps);
  const current = scenes.findLast((scene) => frame >= scene.from) ?? scenes[0];
  const dark = current.id === "decision";
  const scale = Math.min(width / 1080, height / 1920);
  if (!ready) return null;
  return (
    <AbsoluteFill style={{ background: theme.ink, fontFamily: theme.sans }}>
      <div
        data-video-canvas
        style={{
          width: 1080,
          height: 1920,
          position: "absolute",
          left: (width - 1080 * scale) / 2,
          top: (height - 1920 * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <TransitionSeries>
          {scenes.flatMap((scene, i) => {
            const Component = components[scene.id];
            return [
              <TransitionSeries.Sequence key={scene.id} durationInFrames={scene.duration}>
                <Component {...props} />
              </TransitionSeries.Sequence>,
              ...(scene.overlap
                ? [
                    i % 2 === 0 ? (
                      <TransitionSeries.Transition
                        key={`${scene.id}-cut`}
                        timing={linearTiming({ durationInFrames: scene.overlap })}
                        presentation={wipe({ direction: "from-right" })}
                      />
                    ) : (
                      <TransitionSeries.Transition
                        key={`${scene.id}-cut`}
                        timing={linearTiming({ durationInFrames: scene.overlap })}
                        presentation={fade()}
                      />
                    ),
                  ]
                : []),
            ];
          })}
        </TransitionSeries>
        <div className="scene-kicker" style={{ color: dark ? theme.paper : theme.ink }}>
          <Img
            src={staticFile("mark.svg")}
            alt="作品标记"
            style={{ width: 32, height: 32, filter: dark ? "brightness(0) invert(1)" : "none" }}
          />
          <span>生活里的经济学</span>
          <span className="scene-edition">FIELD NOTES / 001</span>
        </div>
        <div className="scene-footer" style={{ color: dark ? "#bdcbbb" : theme.muted }}>
          <div className="scene-chapters">
            {scenes.map((scene) => (
              <span
                key={scene.id}
                style={{
                  flex: 1,
                  borderTop: `3px solid ${scene.id === current.id ? theme.accent : dark ? "#476354" : theme.line}`,
                  paddingTop: 16,
                  color: scene.id === current.id ? theme.accent : "inherit",
                }}
              >
                {scene.label}
              </span>
            ))}
          </div>
          <p>
            示例假设：年卡 ¥{props.annualPrice}，单次 ¥{props.visitPrice}。<br />
            仅比较现金支出；不含通勤时间、退款条件和机会成本。
          </p>
        </div>
      </div>
      {props.sound !== false &&
        scenes.map((scene, i) => (
          <Sequence
            key={scene.id}
            from={scene.from + (i === 0 ? 12 : 0)}
            durationInFrames={Math.min(Math.ceil(fps * 0.6), durationInFrames - scene.from)}
            layout="none"
          >
            <Audio src={staticFile(i % 2 ? "audio/sweep.wav" : "audio/accent.wav")} volume={0.22} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}

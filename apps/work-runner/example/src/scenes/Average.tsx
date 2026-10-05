import { useCurrentFrame, useVideoConfig } from "remotion";
import { costs } from "../../model.js";
import { theme } from "../theme";
import { money, progress } from "../motion";
import { Heading, Note, Stage } from "../components/Layout";
import { Reveal } from "../components/Motion";
import type { Inputs } from "./types";

export function Average(props: Inputs) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const n = Math.max(1, Math.round(1 + (props.visits - 1) * progress(frame, fps, fps * 8)));
  const result = costs({ ...props, visits: n });
  return (
    <Stage>
      <Heading eyebrow="03 / SPREAD THE FIXED COST">
        同一笔钱，
        <br />
        被更多次使用分摊。
      </Heading>
      <div
        style={{
          position: "relative",
          height: 570,
          marginTop: 70,
          display: "grid",
          placeItems: "center",
        }}
      >
        <svg viewBox="0 0 600 600" style={{ position: "absolute", width: 570, height: 570 }}>
          <circle cx="300" cy="300" r="270" fill="none" stroke={theme.line} strokeWidth="2" />
          <circle
            cx="300"
            cy="300"
            r="270"
            fill="none"
            stroke={theme.accent}
            strokeWidth="10"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - n / props.visits}
            transform="rotate(-90 300 300)"
          />
        </svg>
        <div style={{ textAlign: "center", position: "relative" }}>
          <div style={{ fontSize: 28, color: theme.muted, marginBottom: 20 }}>平均每次 / 元</div>
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: result.average >= 10000 ? 66 : 100,
              letterSpacing: -7,
            }}
          >
            {money(result.average, 2)}
          </div>
          <div style={{ fontFamily: theme.mono, fontSize: 28, marginTop: 28 }}>
            ¥{money(props.annualPrice)} ÷ {n}
          </div>
        </div>
      </div>
      <Reveal delay={1}>
        <Note>
          固定成本不会减少，
          <br />
          单次成本会随着使用次数下降。
        </Note>
      </Reveal>
    </Stage>
  );
}

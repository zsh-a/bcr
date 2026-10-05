import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { money, progress } from "../motion";
import { Heading, Note, Stage } from "../components/Layout";
import { Camera, Reveal } from "../components/Motion";
import type { Inputs } from "./types";

export function Price({ annualPrice }: Inputs) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const p = progress(frame, 0, fps * 3);
  return (
    <Stage>
      <Heading eyebrow="01 / THE PRICE OF A PROMISE">
        买下年卡，
        <br />
        买下的是便宜吗？
      </Heading>
      <Camera>
        <div style={{ marginTop: 112, perspective: 1600 }}>
          <div
            style={{
              height: 480,
              padding: 50,
              position: "relative",
              overflow: "hidden",
              borderRadius: 24,
              background: theme.ink,
              color: theme.paper,
              boxShadow: "0 40px 70px #193d322b",
              transform: `rotateY(${(1 - p) * -16}deg) rotateZ(${-5 + p * 3}deg)`,
            }}
          >
            <div style={{ fontFamily: theme.mono, fontSize: 26, letterSpacing: 8 }}>
              ANNUAL / MEMBERSHIP
            </div>
            <div
              style={{
                marginTop: 70,
                fontFamily: theme.mono,
                fontSize: annualPrice >= 10000 ? 112 : 154,
                letterSpacing: -10,
              }}
            >
              <span style={{ fontSize: 60, marginRight: 20 }}>¥</span>
              {money(annualPrice)}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 70,
                fontSize: 26,
              }}
            >
              <span>365 天 · 无限可能</span>
              <span>● ● ●</span>
            </div>
            <div
              style={{
                position: "absolute",
                inset: "-80%",
                pointerEvents: "none",
                background:
                  "linear-gradient(115deg, transparent 42%, #ffffff20 49%, transparent 56%)",
                transform: `translateX(${-30 + p * 60}%)`,
              }}
            />
          </div>
        </div>
      </Camera>
      <Reveal delay={1.1}>
        <Note>
          价格是确定的。
          <br />
          你会去多少次，还不确定。
        </Note>
      </Reveal>
    </Stage>
  );
}

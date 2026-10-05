import { useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Heading, Note, Stage } from "../components/Layout";
import { Stagger } from "../components/Motion";
import type { Inputs } from "./types";

export function Attendance({ visits }: Inputs) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  // Reveal the grid first, then keep the active cells in sync with the counter.
  const n = Math.round(visits * Math.min(1, Math.max(0, (frame / fps - 2) / 6)));
  const cells = Math.min(visits, 72);
  return (
    <Stage>
      <Heading eyebrow="02 / SHOWING UP">
        真正的变量，
        <br />
        是你到场的次数。
      </Heading>
      <div style={{ display: "flex", alignItems: "baseline", gap: 26, margin: "60px 0 48px" }}>
        <span
          style={{ fontFamily: theme.mono, fontSize: 164, lineHeight: 1.2, letterSpacing: -12 }}
        >
          {n.toString().padStart(2, "0")}
        </span>
        <span style={{ fontSize: 34 }}>次 / 年</span>
      </div>
      <Stagger
        interval={0.012}
        style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 14 }}
      >
        {Array.from({ length: cells }, (_, i) => (
          <div
            data-stagger
            key={i}
            style={{
              height: 58,
              border: `1px solid ${theme.line}`,
              background: i < n ? theme.ink : "transparent",
              color: theme.paper,
              display: "grid",
              placeItems: "center",
              fontFamily: theme.mono,
              fontSize: 21,
            }}
          >
            {i < n ? String(i + 1).padStart(2, "0") : ""}
          </div>
        ))}
      </Stagger>
      <Note>
        {visits > 72 ? "画面展示前 72 次到访。" : "每亮起一格，就是一次真实使用。"}
        <br />
        让出勤记录，替代办卡时的想象。
      </Note>
    </Stage>
  );
}

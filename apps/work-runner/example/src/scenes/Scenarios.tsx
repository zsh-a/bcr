import { useCurrentFrame, useVideoConfig } from "remotion";
import { costs } from "../../model.js";
import { theme } from "../theme";
import { money, progress } from "../motion";
import { Heading, Note, Stage } from "../components/Layout";
import { Stagger } from "../components/Motion";
import type { Inputs } from "./types";

export function Scenarios(props: Inputs) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const visits = [
    ...new Set([
      Math.max(1, Math.round(props.visits / 6)),
      Math.max(1, Math.round(props.visits / 2)),
      props.visits,
    ]),
  ];
  const max = props.annualPrice / visits[0];
  return (
    <Stage>
      <Heading eyebrow="05 / THREE POSSIBLE YEARS">
        同一张年卡，
        <br />
        不同的使用结果。
      </Heading>
      <Stagger delay={0.4} style={{ marginTop: 90 }}>
        {visits.map((n, i) => {
          const value = costs({ ...props, visits: n });
          return (
            <div
              data-stagger
              key={n}
              style={{
                borderTop: `1px solid ${theme.line}`,
                padding: "26px 0 36px",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 20,
                }}
              >
                <span style={{ fontSize: 36 }}>
                  <span style={{ fontFamily: theme.mono, fontSize: 64 }}>{n}</span> 次 / 年
                </span>
                <span style={{ fontFamily: theme.mono, fontSize: 60, color: theme.accent }}>
                  {money(value.average, 2)}
                  <span style={{ fontFamily: theme.sans, color: theme.muted, fontSize: 24 }}>
                    {" "}
                    元/次
                  </span>
                </span>
              </div>
              <div style={{ height: 10, background: theme.line, marginTop: 26 }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(value.average / max) * progress(frame, (0.8 + i * 0.2) * fps, fps * 2) * 100}%`,
                    background: theme.accent,
                  }}
                />
              </div>
            </div>
          );
        })}
      </Stagger>
      <Note>
        办卡之前，先估计自己
        <br />
        可以长期做到的出勤频率。
      </Note>
    </Stage>
  );
}

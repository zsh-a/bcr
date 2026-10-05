import { useCurrentFrame, useVideoConfig } from "remotion";
import { costs } from "../../model.js";
import { theme } from "../theme";
import { money, progress } from "../motion";
import { Heading, Note, Stage } from "../components/Layout";
import { Camera, DrawPath, Reveal } from "../components/Motion";
import type { Inputs } from "./types";

export function Comparison(props: Inputs) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig(),
    result = costs(props);
  const maxVisits = Math.max(props.visits, Math.ceil(result.breakEven * 1.6), 2);
  const maxCost = Math.max(props.annualPrice, maxVisits * props.visitPrice) * 1.1;
  const x = (n: number) => 80 + (760 * n) / maxVisits;
  const y = (cost: number) => 540 - (460 * cost) / maxCost;
  const cx = x(result.breakEven),
    cy = y(props.annualPrice);
  const focus = progress(frame, fps * 3, fps);
  return (
    <Stage>
      <Heading eyebrow="04 / THE CROSSING POINT">
        找到两条线，
        <br />
        相遇的地方。
      </Heading>
      <Camera zoom={1.025}>
        <div style={{ display: "flex", gap: 40, fontSize: 26, marginTop: 74 }}>
          <span style={{ color: theme.accent }}>━ 年卡</span>
          <span>━ 按次付费</span>
          <span style={{ marginLeft: "auto", color: theme.muted }}>总支出 / 元</span>
        </div>
        <svg viewBox="0 0 912 640" style={{ width: "100%", marginTop: 28, overflow: "visible" }}>
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line x1="80" x2="840" y1={y(maxCost * n)} y2={y(maxCost * n)} stroke={theme.line} />
              <text
                x="64"
                y={y(maxCost * n) + 8}
                textAnchor="end"
                fill={theme.muted}
                fontFamily={theme.mono}
                fontSize="22"
              >
                {money(maxCost * n)}
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((n) => (
            <text
              key={n}
              x={x(maxVisits * n)}
              y="594"
              textAnchor="middle"
              fill={theme.muted}
              fontFamily={theme.mono}
              fontSize="24"
            >
              {Math.round(maxVisits * n)}
            </text>
          ))}
          <text x="840" y="636" textAnchor="end" fill={theme.muted} fontSize="24">
            到访次数
          </text>
          <DrawPath d={`M 80 ${y(props.annualPrice)} H 840`} color={theme.accent} delay={0.4} />
          <DrawPath
            d={`M 80 540 L 840 ${y(maxVisits * props.visitPrice)}`}
            color={theme.ink}
            delay={1}
            duration={3}
          />
          <g opacity={focus}>
            <line
              x1={cx}
              x2={cx}
              y1={cy}
              y2="540"
              stroke={theme.accent}
              strokeDasharray="6 9"
              strokeWidth="2"
            />
            <circle
              cx={cx}
              cy={cy}
              r={15 + (1 - focus) * 24}
              fill={theme.paper}
              stroke={theme.accent}
              strokeWidth="6"
            />
            <rect
              x={Math.min(cx - 100, 640)}
              y={cy - 90}
              width="230"
              height="60"
              rx="30"
              fill={theme.ink}
            />
            <text
              x={Math.min(cx + 15, 755)}
              y={cy - 49}
              textAnchor="middle"
              fill={theme.paper}
              fontFamily={theme.mono}
              fontSize="28"
            >
              {money(result.breakEven, Number.isInteger(result.breakEven) ? 0 : 2)} 次
            </text>
          </g>
        </svg>
      </Camera>
      <Reveal delay={4}>
        <Note>
          {Number.isInteger(result.breakEven) ? (
            <>去 {result.breakEven} 次，两种方案现金支出相同。</>
          ) : (
            <>临界点约为 {money(result.breakEven, 2)} 次。</>
          )}
          <br />
          超过这个点，年卡才更省钱。
        </Note>
      </Reveal>
    </Stage>
  );
}

import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { costs } from "./model.js";
import "./Scene.css";

const mark = staticFile("mark.svg");

export default function GymCard(props: {
  annualPrice: number;
  visitPrice: number;
  visits: number;
}) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const t = frame / fps;
  const visits = Math.max(
    1,
    Math.round(
      interpolate(t, [8, 40], [1, props.visits], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );
  const result = costs({ ...props, visits });
  const reveal = interpolate(t, [2, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const max = Math.max(props.annualPrice, props.visitPrice * props.visits);
  return (
    <AbsoluteFill
      style={{
        background: "#f2eee5",
        color: "#18392e",
        padding: "150px 84px",
        fontFamily: "sans-serif",
      }}
    >
      <div className="scene-kicker">
        <Img src={mark} alt="作品标记" style={{ width: 32, height: 32 }} />
        生活里的经济学 / 001
      </div>
      <h1
        style={{
          fontSize: 100,
          lineHeight: 1.22,
          fontWeight: 600,
          margin: "120px 0 60px",
          letterSpacing: -5,
        }}
      >
        年卡，去多少次
        <br />
        才划算？
      </h1>
      <div style={{ fontSize: 34, color: "#637469", opacity: reveal }}>
        价格是起点。实际到访次数，才是变量。
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, margin: "90px 0 50px" }}>
        <strong style={{ fontSize: 190, lineHeight: 1 }}>{visits}</strong>
        <span style={{ fontSize: 38 }}>次 / 年</span>
      </div>
      {[
        { label: "年卡总支出", value: result.annualTotal, color: "#235942" },
        { label: "按次总支出", value: result.payPerVisitTotal, color: "#c46c3e" },
      ].map((item) => (
        <div key={item.label} style={{ marginBottom: 50 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 34,
              marginBottom: 18,
            }}
          >
            <span>{item.label}</span>
            <span>¥ {item.value.toLocaleString("en-US")}</span>
          </div>
          <div style={{ background: "#dedfd3", height: 42 }}>
            <div
              style={{
                background: item.color,
                height: "100%",
                width: `${Math.max(2, (item.value / max) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
      <div
        style={{
          marginTop: 34,
          padding: "32px 0",
          borderTop: "2px solid #a3b0a0",
          fontSize: 44,
          lineHeight: 1.6,
        }}
      >
        {t < 40
          ? `平均每次 ¥ ${result.average.toFixed(2)}`
          : `第 ${result.firstCheaperVisit} 次起，年卡更省钱。`}
        <div style={{ fontSize: 30, color: "#637469" }}>
          {result.comparison === "equal"
            ? "两种方案现金支出相同。"
            : result.comparison === "annual-cheaper"
              ? "在当前使用次数下，年卡现金支出较低。"
              : "在当前使用次数下，按次付费现金支出较低。"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 130,
          left: 84,
          right: 84,
          fontSize: 25,
          color: "#637469",
          lineHeight: 1.7,
        }}
      >
        示例假设：年卡 ¥{props.annualPrice}，单次 ¥{props.visitPrice}。<br />
        仅比较现金支出，不含通勤时间、退款条件和机会成本。
      </div>
    </AbsoluteFill>
  );
}

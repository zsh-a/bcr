import { costs } from "../../model.js";
import { theme } from "../theme";
import { Heading, Note, Stage } from "../components/Layout";
import { Reveal } from "../components/Motion";
import type { Inputs } from "./types";

export function Decision(props: Inputs) {
  const result = costs(props);
  return (
    <Stage dark>
      <Heading eyebrow="06 / MAKE IT YOUR DECISION">
        便宜的前提，
        <br />
        是持续使用。
      </Heading>
      <Reveal delay={0.4} style={{ marginTop: 90 }}>
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: result.firstCheaperVisit >= 1000 ? 168 : 260,
            letterSpacing: -18,
            lineHeight: 1.2,
            color: theme.lime,
          }}
        >
          {result.firstCheaperVisit}
          <span style={{ fontFamily: theme.sans, fontSize: 44, letterSpacing: 0, marginLeft: 28 }}>
            次起
          </span>
        </div>
      </Reveal>
      <Reveal delay={0.8}>
        <Note>
          第 {result.firstCheaperVisit} 次起，年卡更省钱。
          <br />
          这是现金支出的比较。
        </Note>
      </Reveal>
      <Reveal
        delay={1.2}
        style={{ marginTop: 66, paddingTop: 40, borderTop: "1px solid #ffffff40" }}
      >
        <div style={{ fontSize: 30, lineHeight: 1.8, color: "#bdcbbb" }}>
          还有三个问题值得问自己：
          <br />
          距离方便吗？能坚持吗？退款条件如何？
        </div>
      </Reveal>
    </Stage>
  );
}

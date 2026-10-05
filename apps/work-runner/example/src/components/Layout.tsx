import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";
import { Reveal } from "./Motion";

export function Stage({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <AbsoluteFill
      style={{
        background: dark ? theme.ink : theme.paper,
        color: dark ? theme.paper : theme.ink,
        padding: "300px 84px 280px",
        overflow: "hidden",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
export function Heading({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <>
      <Reveal style={{ fontFamily: theme.mono, fontSize: 26, letterSpacing: 4, marginBottom: 36 }}>
        {eyebrow}
      </Reveal>
      <Reveal delay={0.12}>
        <h1
          style={{ fontSize: 88, lineHeight: 1.35, letterSpacing: -4, fontWeight: 400, margin: 0 }}
        >
          {children}
        </h1>
      </Reveal>
    </>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 30, lineHeight: 1.7, marginTop: 44 }}>{children}</div>;
}

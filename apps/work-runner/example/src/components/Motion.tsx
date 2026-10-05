import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useGsapTimeline } from "@remotion/gsap";
import { progress } from "../motion";

export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  const p = progress(frame, delay * fps, fps * 0.8);
  return (
    <div style={{ overflow: "hidden", ...style }}>
      <div
        style={{
          transform: `translateY(${(1 - p) * 110}%)`,
          opacity: p,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A paused, frame-seeked GSAP timeline. Children own [data-stagger] elements. */
export function Stagger({
  children,
  style,
  delay = 0,
  interval = 0.1,
}: {
  children: ReactNode;
  style?: CSSProperties;
  delay?: number;
  interval?: number;
}) {
  const scope = useGsapTimeline<HTMLDivElement>(
    ({ timeline, selector }) => {
      timeline.fromTo(
        selector("[data-stagger]"),
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.85, stagger: interval, ease: "power3.out" },
        delay,
      );
    },
    { dependencies: [delay, interval] },
  );
  return (
    <div ref={scope} style={style}>
      {children}
    </div>
  );
}

export function Camera({
  children,
  zoom = 1.035,
  origin = "50% 50%",
}: {
  children: ReactNode;
  zoom?: number;
  origin?: string;
}) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  return (
    <div
      style={{
        transformOrigin: origin,
        transform: `scale(${1 + (zoom - 1) * progress(frame, 0, fps * 6)})`,
      }}
    >
      {children}
    </div>
  );
}

export function DrawPath({
  d,
  color,
  width = 7,
  delay = 0,
  duration = 2,
}: {
  d: string;
  color: string;
  width?: number;
  delay?: number;
  duration?: number;
}) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig();
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      pathLength={1}
      strokeDasharray="1"
      strokeDashoffset={1 - progress(frame, delay * fps, duration * fps)}
    />
  );
}

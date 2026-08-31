import { useId } from "react";

function pathFor(values: ReadonlyArray<number>, width: number, height: number): string {
  if (values.length === 0) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1e-9, maximum - minimum);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - minimum) / span) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline(props: {
  values: ReadonlyArray<number>;
  positive: boolean;
  large?: boolean;
}) {
  const width = props.large === true ? 560 : 150;
  const height = props.large === true ? 190 : 54;
  const line = pathFor(props.values, width, height);
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = useId().replaceAll(":", "");
  const tone = props.positive ? "var(--ma-positive)" : "var(--ma-negative)";

  return (
    <svg
      className={props.large === true ? "ma-sparkline large" : "ma-sparkline"}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity="0.2" />
          <stop offset="1" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      {props.large === true && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={tone} strokeWidth={props.large === true ? 2 : 1.4} />
      {props.values.length > 0 && (
        <circle
          cx={width}
          cy={Number(line.match(/,([\d.]+)$/)?.[1] ?? height / 2)}
          r={props.large === true ? 3.5 : 2}
          fill={tone}
        />
      )}
    </svg>
  );
}

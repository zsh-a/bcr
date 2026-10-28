import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { init, use as register, type EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { createChartTooltip, type ChartPalette } from "../macro/chartStyle";
import type { ResearchChartProps } from "./chart-types";
import { buildResearchChartOption, countryColor } from "./chart-options";
import {
  chartDomain,
  dateNumber,
  formatResearchValue,
  isoDate,
  moveReference,
  nativePoint,
  referenceDates,
} from "./interaction";
import { resolveResearchColor } from "./useResearchPalette";

register([
  LineChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

interface ZoomEvent {
  start?: number;
  end?: number;
  startValue?: number;
  endValue?: number;
  batch?: ZoomEvent[];
}
export function useResearchChart(props: ResearchChartProps, palette: ChartPalette) {
  const { tracks, range, baseline, colors, event, events, height = 150, label, cursorDate } = props;
  const host = useRef<HTMLDivElement>(null),
    cursorLine = useRef<HTMLDivElement>(null),
    tooltip = useRef<HTMLDivElement>(null),
    instance = useRef<EChartsType | null>(null),
    hasOption = useRef(false),
    pointer = useRef<{ x: number; y: number } | null>(null),
    lastReference = useRef<string | null>(null),
    renderedTooltip = useRef<string | null>(null);
  const [compact, setCompact] = useState(false),
    [reducedMotion, setReducedMotion] = useState(false),
    [onScreen, setOnScreen] = useState(false),
    [pageVisible, setPageVisible] = useState(true),
    [ready, setReady] = useState(false),
    [localLock, setLocalLock] = useState<string | null>(null);
  const pinned = props.onLock ? !!props.lockedDate : localLock !== null;
  const slider = !!props.onRangeChange && height >= 260,
    active = onScreen && pageVisible;
  const resolvedColors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(colors).map(([country, color]) => [country, resolveResearchColor(color)]),
      ),
    [colors, palette],
  );
  const dates = useMemo(() => referenceDates(tracks, range), [tracks, range[0], range[1]]);
  const option = useMemo(
    () =>
      buildResearchChartOption(
        {
          tracks,
          range,
          baseline,
          colors: resolvedColors,
          ...(event ? { event } : {}),
          ...(events ? { events } : {}),
          height,
          label,
          cursorDate: null,
          onCursor: () => {},
          ...(slider ? { onRangeChange: () => {} } : {}),
        },
        palette,
        compact,
        reducedMotion,
      ),
    [
      tracks,
      range[0],
      range[1],
      baseline,
      resolvedColors,
      event,
      events,
      height,
      label,
      slider,
      palette,
      compact,
      reducedMotion,
    ],
  );

  const paint = useEffectEvent((date = props.cursorDate) => {
    const chart = instance.current,
      line = cursorLine.current,
      popup = tooltip.current;
    if (!chart || !line || !popup || !hasOption.current) return;
    const time = date ? dateNumber(date) : NaN,
      pixel = Number.isFinite(time) ? chart.convertToPixel({ xAxisIndex: 0 }, time) : NaN;
    const visible =
      date &&
      date >= props.range[0] &&
      date <= props.range[1] &&
      Number.isFinite(pixel) &&
      pixel >= 0 &&
      pixel <= chart.getWidth();
    line.hidden = !visible;
    if (visible) {
      line.style.transform = `translateX(${pixel}px)`;
      line.style.top = `${(props.height ?? 150) >= 260 ? 24 : 15}px`;
      line.style.bottom = `${props.onRangeChange && (props.height ?? 150) >= 260 ? 57 : 26}px`;
    }
    if (!visible || !pointer.current) {
      popup.hidden = true;
      return;
    }
    popup.hidden = false;
    if (renderedTooltip.current !== date) {
      popup.replaceChildren(
        createChartTooltip({
          title: date,
          subtitle: pinned ? "固定参考日" : "参考日 · UTC",
          rows: props.tracks.map((track) => {
            const point = nativePoint(track.points, date);
            return {
              label: `${track.series.country} · ${point?.period ?? "暂无期次"}`,
              value: formatResearchValue(point?.value, track.series.unit, track.series.currency),
              color: countryColor(track.series.country, resolvedColors, palette),
            };
          }),
          footer: "读数来自不晚于参考日的原始期次；缺失保留为空。",
        }),
      );
      renderedTooltip.current = date;
    }
    const x = Math.max(
        3,
        Math.min(chart.getWidth() - popup.offsetWidth - 3, pointer.current.x + 14),
      ),
      y = Math.max(
        2,
        Math.min(
          chart.getHeight() - popup.offsetHeight - 2,
          pointer.current.y - popup.offsetHeight - 10,
        ),
      );
    popup.style.transform = `translate(${x}px, ${y}px)`;
  });
  const publish = useEffectEvent((date: string | null) => {
    if (date) lastReference.current = date;
    if (date !== props.cursorDate) props.onCursor(date);
    else paint(props.cursorDate);
  });
  const requestLock = useEffectEvent((date: string | null) => {
    if (props.onLock) props.onLock(date);
    else {
      setLocalLock(date);
      publish(date);
    }
    // Unlocking from a button/keyboard also clears any hover hidden by the lock.
    if (props.onLock && date === null) publish(null);
  });
  const pointerDate = useEffectEvent((x: number, y: number): string | null => {
    const chart = instance.current;
    if (!chart || !hasOption.current || !chart.containPixel({ gridIndex: 0 }, [x, y])) return null;
    const time = Number(chart.convertFromPixel({ xAxisIndex: 0 }, x));
    if (!Number.isFinite(time)) return null;
    pointer.current = { x, y };
    return isoDate(
      Math.max(dateNumber(props.range[0]), Math.min(dateNumber(props.range[1]), time)),
    );
  });
  const move = useEffectEvent((x: number, y: number) => {
    const date = pointerDate(x, y);
    if (date === null) return;
    if (pinned) paint(props.cursorDate);
    else publish(date);
  });
  const leave = useEffectEvent(() => {
    pointer.current = null;
    if (tooltip.current) tooltip.current.hidden = true;
    if (!pinned) publish(null);
  });
  const pin = useEffectEvent(() => {
    const recent = lastReference.current,
      inRange = recent && recent >= props.range[0] && recent <= props.range[1] ? recent : null;
    requestLock(pinned ? null : (props.cursorDate ?? inRange ?? dates.at(-1) ?? null));
  });
  const zoom = useEffectEvent((raw: ZoomEvent) => {
    if (!props.onRangeChange) return;
    const zoom = raw.batch?.[0] ?? raw,
      [first, last] = chartDomain(props.tracks, props.range),
      start = zoom.startValue ?? first + ((zoom.start ?? 0) / 100) * (last - first),
      end = zoom.endValue ?? first + ((zoom.end ?? 100) / 100) * (last - first);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return;
    const selected: [string, string] = [isoDate(start), isoDate(end)];
    if (selected[0] !== props.range[0] || selected[1] !== props.range[1])
      props.onRangeChange(selected);
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: "svg" });
    instance.current = chart;
    let resizeFrame = 0,
      moveFrame = 0,
      pending: { x: number; y: number } | null = null;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!element.clientWidth || !element.clientHeight) return;
        chart.resize({ silent: true });
        setCompact(element.clientWidth < 460);
        paint();
      });
    });
    resize.observe(element);
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false), {
            rootMargin: "80px",
          });
    intersection?.observe(element);
    if (!intersection) setOnScreen(true);
    const motion = matchMedia("(prefers-reduced-motion: reduce)"),
      updateMotion = () => setReducedMotion(motion.matches),
      visibility = () => setPageVisible(document.visibilityState !== "hidden");
    updateMotion();
    visibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", visibility);
    const zr = chart.getZr();
    const mousemove = (event: { offsetX: number; offsetY: number }) => {
      pending = { x: event.offsetX, y: event.offsetY };
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        if (pending) move(pending.x, pending.y);
      });
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const rect = element.getBoundingClientRect();
      const date = pointerDate(event.clientX - rect.left, event.clientY - rect.top);
      if (date) requestLock(date);
    };
    const globalout = () => {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pending = null;
      leave();
    };
    zr.on("mousemove", mousemove);
    zr.on("globalout", globalout);
    chart.on("datazoom", (raw) => zoom(raw as ZoomEvent));
    element.addEventListener("pointerdown", pointerdown);
    return () => {
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(moveFrame);
      resize.disconnect();
      intersection?.disconnect();
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", visibility);
      element.removeEventListener("pointerdown", pointerdown);
      chart.dispose();
      instance.current = null;
      hasOption.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active || !instance.current) return;
    instance.current.setOption(option, { notMerge: true, silent: true, lazyUpdate: false });
    hasOption.current = true;
    renderedTooltip.current = null;
    setReady(true);
    paint();
  }, [option, active]);
  useEffect(() => {
    renderedTooltip.current = null;
    if (active && ready) paint();
  }, [cursorDate, pinned, active, ready]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveReference(dates, props.lockedDate ?? cursorDate, event.key);
    if (next === undefined) return;
    event.preventDefault();
    requestLock(next);
  }
  return {
    host,
    cursorLine,
    tooltip,
    ready,
    pinned,
    onKeyDown,
    togglePin: () => pin(),
    colors: resolvedColors,
  };
}

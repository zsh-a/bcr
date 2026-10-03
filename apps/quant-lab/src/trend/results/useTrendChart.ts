import type { RuntimeServices } from "@bcr/core";
import type { BinanceDataset } from "@bcr/market-data/binance/model";
import {
  canReuseChartWindow,
  clipChartRange,
  initialChartRange,
  planTrendChart,
  type ChartFocus,
  type ChartRange,
  type TrendChartData,
  type TrendResult,
  type TrendChannelConfig,
} from "@bcr/quant-core/trend";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readChartWindow } from "./read";

export function useTrendChart(
  services: RuntimeServices,
  dataset: BinanceDataset,
  result: TrendResult,
  minutes: number,
  enabled: boolean,
  channel?: TrendChannelConfig,
) {
  const bounds = useMemo(
    () => ({ from: dataset.manifest.startTime, to: dataset.manifest.endTime }),
    [dataset],
  );
  const [focus, setFocus] = useState<ChartFocus>(() => ({
    ...initialChartRange(bounds, minutes),
    revision: 0,
  }));
  const [request, setRequest] = useState<ChartRange>(focus);
  const [data, setData] = useState<TrendChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(data);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = useCallback(
    (range: ChartRange) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setRequest(clipChartRange(bounds, range, minutes)), 150);
    },
    [bounds, minutes],
  );
  const jump = useCallback(
    (range: ChartRange) => {
      clearTimeout(timer.current);
      const clipped = clipChartRange(bounds, range, minutes);
      setFocus((last) => ({ ...clipped, revision: last.revision + 1 }));
      setRequest(clipped);
    },
    [bounds, minutes],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const plan = planTrendChart(bounds, request, minutes);
    if (loaded.current && canReuseChartWindow(loaded.current, request, plan, bounds)) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void readChartWindow(services, dataset, result, plan, abort.signal, channel)
      .then((next) => {
        if (abort.signal.aborted) return;
        loaded.current = next;
        setData(next);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [services, dataset, result, bounds, request, minutes, enabled, channel]);
  return {
    data,
    focus,
    loading,
    error,
    visible,
    bounds,
    latest: () => jump(initialChartRange(bounds, minutes)),
    all: () => jump(bounds),
    locate: (time: number) => jump(initialChartRange(bounds, minutes, time)),
    retry: () => setRequest((range) => ({ ...range })),
  };
}

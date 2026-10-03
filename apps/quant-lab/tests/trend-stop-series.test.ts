import { describe, expect, it, vi } from "vitest";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { syncTrendStopSeries } from "../src/trend/results/TrendChart";

describe("trend stop series", () => {
  it("renders each position separately and removes old series when the window becomes flat", () => {
    const created = Array.from({ length: 2 }, () => ({ setData: vi.fn(), applyOptions: vi.fn() }));
    const addSeries = vi.fn().mockReturnValueOnce(created[0]).mockReturnValueOnce(created[1]);
    const removeSeries = vi.fn();
    const chart = { addSeries, removeSeries } as unknown as Pick<
      IChartApi,
      "addSeries" | "removeSeries"
    >;
    const series: ISeriesApi<"Line">[] = [];
    const segments = [
      {
        tradeId: 1,
        points: [
          { time: 0, value: 90 },
          { time: 300_000, value: 91 },
        ],
      },
      {
        tradeId: 2,
        points: [
          { time: 600_000, value: 95 },
          { time: 900_000, value: 96 },
        ],
      },
    ];
    syncTrendStopSeries(chart, series, segments, "red");
    expect(addSeries).toHaveBeenCalledTimes(2);
    expect(created[0]!.setData).toHaveBeenLastCalledWith([
      { time: 0, value: 90 },
      { time: 300, value: 91 },
    ]);
    expect(created[1]!.setData).toHaveBeenLastCalledWith([
      { time: 600, value: 95 },
      { time: 900, value: 96 },
    ]);

    const next = [{ tradeId: 3, points: [{ time: 1_200_000, value: 97 }] }];
    syncTrendStopSeries(chart, series, next, "red");
    expect(addSeries).toHaveBeenCalledTimes(2);
    expect(removeSeries).toHaveBeenCalledWith(created[1]);
    expect(created[0]!.setData).toHaveBeenLastCalledWith([{ time: 1200, value: 97 }]);
    expect(created[0]!.applyOptions).toHaveBeenLastCalledWith({
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
    });

    syncTrendStopSeries(chart, series, [], "red");
    expect(removeSeries).toHaveBeenCalledWith(created[0]);
    expect(series).toEqual([]);
  });
});

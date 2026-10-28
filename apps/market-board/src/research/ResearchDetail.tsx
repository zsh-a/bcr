import { lazy, Suspense, useState } from "react";
import { ArrowDownToLine, Box, Pin } from "lucide-react";
import { Button, Drawer, Spinner } from "@bcr/react";
import {
  economicCsv,
  formatEconomicValue,
  type EconomicMetric,
  type EconomicRepository,
  type EconomicTrack,
} from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";
import { ResearchChart } from "./ResearchChart";
import { ADJUSTMENT_NAMES, downloadResearchCsv, FREQUENCY_NAMES } from "./presentation";

const ResearchSpace = lazy(() => import("./ResearchSpace"));
export function ResearchDetail({
  metric,
  repository,
  tracks,
  range,
  cutoff,
  colors,
  countries,
  focus,
  cursor,
  onCursor,
  onRange,
  onFocus,
  pinned,
  onPin,
  onClose,
  event,
  events,
  active,
  lockedDate,
  onLock,
}: {
  metric: EconomicMetric | null;
  repository: EconomicRepository;
  tracks: EconomicTrack[];
  range: [string, string];
  cutoff: string;
  colors: Record<string, string>;
  countries: string[];
  focus: string | null;
  cursor: string | null;
  onCursor: (date: string | null) => void;
  onRange: (range: [string, string]) => void;
  onFocus: (country: string) => void;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  event?: MacroEvent | undefined;
  events: MacroEvent[];
  active: boolean;
  lockedDate: string | null;
  onLock: (date: string | null) => void;
}) {
  const [tab, setTab] = useState<"chart" | "table" | "sources">("chart"),
    [space, setSpace] = useState(false);
  return (
    <Drawer
      open={!!metric && active}
      onClose={onClose}
      title={metric?.name ?? "指标详情"}
      className="research-detail"
    >
      {metric && (
        <>
          <div className="research-drawer-intro">
            <p>{metric.description}</p>
            <small>统一观察截止 {cutoff} · 原始频率保留 · 仅比较已收录序列</small>
            <div className="research-detail-actions">
              <Button size="sm" onClick={onPin} aria-pressed={pinned}>
                <Pin size={13} />
                {pinned ? "取消钉选" : "钉选到工作台"}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  downloadResearchCsv(
                    economicCsv(tracks),
                    `economic-${metric.id.replace(":", "-")}-${cutoff}.csv`,
                  )
                }
              >
                <ArrowDownToLine size={13} />
                导出指标 CSV
              </Button>
            </div>
          </div>
          <nav className="research-detail-tabs" aria-label="指标详情内容">
            {(
              [
                ["chart", "联动趋势"],
                ["table", "原始期次数据"],
                ["sources", "口径与来源"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </nav>
          {tab === "chart" && (
            <div className="research-detail-chart">
              {metric.id === "cycle:cli" && (
                <Button size="sm" onClick={() => setSpace(!space)} aria-pressed={space}>
                  <Box size={13} />
                  {space ? "二维联动趋势" : "展开三维周期轨迹"}
                </Button>
              )}
              {space && metric.id === "cycle:cli" ? (
                <Suspense fallback={<Spinner />}>
                  <ResearchSpace
                    countries={countries}
                    focus={focus}
                    onFocus={onFocus}
                    colors={colors}
                    cutoff={cutoff}
                    range={range}
                    active={active}
                  />
                </Suspense>
              ) : (
                <ResearchChart
                  tracks={tracks}
                  range={range}
                  baseline={metric.baseline}
                  cursorDate={cursor}
                  onCursor={onCursor}
                  lockedDate={lockedDate}
                  onLock={onLock}
                  onRangeChange={onRange}
                  colors={colors}
                  event={event}
                  events={events}
                  height={300}
                  label={`${metric.name}详细联动趋势`}
                />
              )}
              <p className="research-caption">
                拖动下方范围滑块可同步调整工作台时间。光标读数按真实参考日期对齐；缺期断线，季度和年度数据未补成月度。历史观察不是当时可得信息的回测。
              </p>
              {!tracks.length && <p className="research-empty">所选经济体尚未收录该指标。</p>}
              <div className="research-detail-readings">
                {tracks.map((track) => (
                  <article key={track.series.id}>
                    <strong>
                      {
                        repository.countries.find((country) => country.id === track.series.country)
                          ?.name
                      }
                    </strong>
                    <b>
                      {formatEconomicValue(
                        track.reading?.value ?? null,
                        track.series.unit,
                        track.series.currency,
                      )}
                    </b>
                    <span>
                      {track.reading?.period ?? "无有效期次"} ·{" "}
                      {FREQUENCY_NAMES[track.series.frequency]}
                      {track.reading && track.reading.ageMonths > 0
                        ? ` · 距截止 ${track.reading.ageMonths} 月`
                        : ""}
                    </span>
                    <small>
                      窗口覆盖 {track.coverage.valid}/
                      {track.coverage.expected ?? track.coverage.reported} ·{" "}
                      {track.series.computed ? "计算值" : "来源序列"}
                    </small>
                  </article>
                ))}
              </div>
              {tracks.some((track) => track.series.currency) && (
                <p className="research-caption">
                  金额保留原币种。本币金额跨币种时仅展示聚焦经济体；全球国家选择保持不变。
                </p>
              )}
            </div>
          )}
          {tab === "table" && (
            <div className="research-native-tables">
              {tracks.map((track) => (
                <section key={track.series.id}>
                  <h3>
                    {
                      repository.countries.find((country) => country.id === track.series.country)
                        ?.name
                    }
                  </h3>
                  <div className="research-table-scroll" tabIndex={0}>
                    <table aria-label={`${track.series.country} 统一指标数据表`}>
                      <caption>
                        {FREQUENCY_NAMES[track.series.frequency]} ·{" "}
                        {ADJUSTMENT_NAMES[track.series.seasonalAdjustment]} ·
                        序列原值与展示值分别保留
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">期次</th>
                          <th scope="col">展示值</th>
                          <th scope="col">序列原值</th>
                          <th scope="col">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...track.points].reverse().map((point) => (
                          <tr key={point.period}>
                            <th scope="row">{point.period}</th>
                            <td>
                              {formatEconomicValue(
                                point.value,
                                track.series.unit,
                                track.series.currency,
                              )}
                            </td>
                            <td>
                              {formatEconomicValue(
                                point.rawValue,
                                track.series.rawUnit,
                                track.series.currency,
                              )}
                            </td>
                            <td>{point.status ?? (track.series.computed ? "计算值" : "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              {!tracks.length && <p className="research-empty">所选经济体尚未收录该指标。</p>}
            </div>
          )}
          {tab === "sources" && (
            <div className="research-sources">
              <p className="research-caption">
                月、季、年频按窗口日历计算覆盖；日、周频仅统计实际记录，不推测交易日或发布周。距截止不是发布延迟，抓取日期不是发布日期。
              </p>
              {tracks.map((track) => (
                <article key={track.series.id}>
                  <h3>
                    {
                      repository.countries.find((country) => country.id === track.series.country)
                        ?.name
                    }{" "}
                    · {FREQUENCY_NAMES[track.series.frequency]}
                  </h3>
                  <p>
                    {ADJUSTMENT_NAMES[track.series.seasonalAdjustment]}
                    {track.series.currency ? ` · ${track.series.currency}` : ""}
                    {track.series.valuation ? ` · ${track.series.valuation}` : ""}
                    {track.series.computed ? " · 计算值" : ""}
                  </p>
                  <p>{track.series.note}</p>
                  <dl>
                    <dt>最新有效期</dt>
                    <dd>{track.reading?.period ?? "无有效值"}</dd>
                    <dt>来源更新</dt>
                    <dd>{track.series.sourceUpdatedAt?.slice(0, 10) ?? "未披露"}</dd>
                    <dt>抓取日期</dt>
                    <dd>{track.series.fetchedAt.slice(0, 10)}</dd>
                    <dt>原始序列标识</dt>
                    <dd>{track.series.source.seriesCode}</dd>
                  </dl>
                  <a href={track.series.source.url} target="_blank" rel="noopener noreferrer">
                    {track.series.source.name} ↗
                  </a>
                  {track.series.source.licenseUrl && (
                    <a
                      href={track.series.source.licenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      数据许可与使用条款 ↗
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

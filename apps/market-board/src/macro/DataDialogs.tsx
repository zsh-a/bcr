import { ArrowUpRight, Database } from "lucide-react";
import { Dialog } from "@bcr/react";
import {
  formatMacroValue,
  getMacroSeries,
  MACRO_INDICATORS,
  MACRO_LICENSE_URL,
  MACRO_SOURCE_URL,
  type MacroSnapshot,
} from "@bcr/market-data/macro";
import { MACRO_EVENTS } from "@bcr/market-data/macro/events";
import type { MacroViewState } from "./state";

export function DataDialogs({
  snapshot,
  state,
  dialog,
  onClose,
}: {
  snapshot: MacroSnapshot;
  state: MacroViewState;
  dialog: "sources" | "table" | null;
  onClose: () => void;
}) {
  const indicator =
    MACRO_INDICATORS.find((item) => item.id === state.indicator) ?? MACRO_INDICATORS[0]!;
  const years = Array.from(
    { length: state.range[1] - state.range[0] + 1 },
    (_, index) => state.range[1] - index,
  );
  return (
    <>
      <Dialog
        open={dialog === "sources"}
        onClose={onClose}
        title="数据来源与统计口径"
        className="macro-data-dialog"
      >
        <div className="macro-source-banner">
          <Database size={24} />
          <div>
            <strong>World Development Indicators</strong>
            <p>世界银行 · 项目内置真实历史数据资源</p>
          </div>
        </div>
        <dl className="macro-source-facts">
          <div>
            <dt>数据覆盖</dt>
            <dd>{snapshot.countries.length} 个经济体 · 1980—2025 年</dd>
          </div>
          <div>
            <dt>资源中最新来源日期</dt>
            <dd>{snapshot.sourceUpdatedAt}</dd>
          </div>
          <div>
            <dt>最近一次资源抓取</dt>
            <dd>{new Date(snapshot.fetchedAt).toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>历史事件</dt>
            <dd>{MACRO_EVENTS.length} 条，逐条附原始资料</dd>
          </div>
        </dl>
        <p className="macro-caption">
          页面默认读取随项目打包的数据，不自动请求外部接口。手动更新只刷新所选经济体；本地保存成功后，下次打开可继续使用。
          各序列可能保留不同来源版本，CSV 中分别记录来源更新日期与抓取时间。
        </p>
        <div className="macro-indicator-notes">
          {MACRO_INDICATORS.map((item) => (
            <article key={item.id}>
              <strong>{item.name}</strong>
              <p>{item.description}</p>
              <a
                href={`https://data.worldbank.org/indicator/${item.code}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.code}
                <ArrowUpRight size={12} />
              </a>
            </article>
          ))}
        </div>
        <p className="macro-caption">
          各国最新期次和历史覆盖可能不同。空缺保留为缺失值，实线之间不跨缺口连接；年度数据不能用于判断日内或月度反应。原始数据可能被来源机构修订。
        </p>
        <div className="macro-source-links">
          <a href={MACRO_SOURCE_URL} target="_blank" rel="noopener noreferrer">
            世界银行数据库
            <ArrowUpRight size={13} />
          </a>
          <a href={MACRO_LICENSE_URL} target="_blank" rel="noopener noreferrer">
            数据许可与署名
            <ArrowUpRight size={13} />
          </a>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "table"}
        onClose={onClose}
        title={`${indicator.name} · 年度数据表`}
        className="macro-data-dialog"
      >
        <p className="macro-caption">
          {indicator.description} — 表示该年缺失，数值保留至小数点后两位。
        </p>
        <div className="macro-table-scroll" tabIndex={0} aria-label="年度指标数据表">
          <table className="macro-data-table">
            <caption>
              {state.range[0]}—{state.range[1]} 年，来源：世界银行 WDI
            </caption>
            <thead>
              <tr>
                <th scope="col">年份</th>
                {state.countries.map((id) => (
                  <th key={id} scope="col">
                    {snapshot.countries.find((country) => country.id === id)?.name ?? id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  {state.countries.map((id) => (
                    <td key={id}>
                      {formatMacroValue(
                        getMacroSeries(snapshot, id, state.indicator).find(
                          (point) => point.year === year,
                        )?.value ?? null,
                        state.indicator,
                        false,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}

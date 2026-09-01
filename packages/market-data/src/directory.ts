import { GLOBAL_INSTRUMENTS, PULSE_INSTRUMENTS } from "./instruments";
import type { AssetClass, MarketInstrument, MarketRegion, MarketSearchResult } from "./model";

interface DirectoryEntry {
  readonly instrument: MarketInstrument;
  readonly aliases: string;
  readonly providerType: string;
}

const PULSE_ALIASES: Readonly<Record<string, string>> = {
  "CN:SSE:000001": "上证指数 shanghai composite",
  "CN:SSE:000300": "沪深300 csi300",
  "CN:SZSE:399006": "创业板 chinext",
  "CN:SSE:600519": "贵州茅台 moutai baijiu",
  "CN:SSE:600036": "招商银行 cmb bank",
  "HK:HKEX:HSI": "恒生指数 hang seng",
  "HK:HKEX:HSTECH": "恒生科技 hang seng tech",
  "HK:HKEX:00700": "腾讯控股 tencent",
  "HK:HKEX:09988": "阿里巴巴 alibaba baba",
  "HK:HKEX:01810": "小米集团 xiaomi",
  "US:INDEX:DJI": "道琼斯 dow jones",
  "US:INDEX:INX": "标普500 sp500 s&p",
  "US:INDEX:IXIC": "纳斯达克 纳指 nasdaq",
  "US:NASDAQ:AAPL": "苹果 apple",
  "US:NASDAQ:NVDA": "英伟达 nvidia",
};

const GLOBAL_ALIASES: Readonly<Record<string, string>> = {
  "GLOBAL:FUTURE:GC00Y": "黄金 gold xau commodity",
  "GLOBAL:FUTURE:CL00Y": "原油 wti crude oil commodity",
  "GLOBAL:FUTURE:B00Y": "布伦特 brent crude oil commodity",
  "GLOBAL:FUTURE:HG00Y": "铜 copper commodity",
  "GLOBAL:FUTURE:NG00Y": "天然气 natural gas commodity",
  "GLOBAL:FUTURE:TY00Y": "美国十年期国债 us 10y treasury bond",
  "GLOBAL:FUTURE:ES00Y": "标普期货 s&p 500 future",
  "GLOBAL:FUTURE:NQ00Y": "纳指期货 nasdaq 100 future",
};

function instrument(
  market: Exclude<MarketRegion, "GLOBAL">,
  venueId: string,
  venue: string,
  sourceSymbol: string,
  symbol: string,
  name: string,
  assetClass: AssetClass = "equity",
): MarketInstrument {
  return {
    id: `${market}:${venueId}:${sourceSymbol.replace(/^(sh|sz|hk)/i, "")}`,
    symbol,
    sourceSymbol,
    name,
    shortName: name.toUpperCase(),
    market,
    venue,
    currency: market === "CN" ? "CNY" : market === "HK" ? "HKD" : "USD",
    timezone:
      market === "US" ? "America/New_York" : market === "HK" ? "Asia/Hong_Kong" : "Asia/Shanghai",
    assetClass,
  };
}

const EXTENDED_DIRECTORY: ReadonlyArray<DirectoryEntry> = [
  {
    instrument: instrument("CN", "SSE", "Shanghai", "sh601318", "601318.SH", "Ping An Insurance"),
    aliases: "中国平安 insurance",
    providerType: "GP-A",
  },
  {
    instrument: instrument("CN", "SZSE", "Shenzhen", "sz300750", "300750.SZ", "CATL"),
    aliases: "宁德时代 battery",
    providerType: "GP-A",
  },
  {
    instrument: instrument("CN", "SZSE", "Shenzhen", "sz002594", "002594.SZ", "BYD"),
    aliases: "比亚迪 electric vehicle ev",
    providerType: "GP-A",
  },
  {
    instrument: instrument("CN", "SSE", "Shanghai", "sh601899", "601899.SH", "Zijin Mining"),
    aliases: "紫金矿业 gold copper",
    providerType: "GP-A",
  },
  {
    instrument: instrument("CN", "SSE", "Shanghai", "sh510300", "510300.SH", "CSI 300 ETF", "fund"),
    aliases: "沪深300etf 华泰柏瑞 index fund",
    providerType: "ETF",
  },
  {
    instrument: instrument(
      "CN",
      "SSE",
      "Shanghai",
      "sh510880",
      "510880.SH",
      "Dividend ETF",
      "fund",
    ),
    aliases: "红利etf 华泰柏瑞 dividend fund",
    providerType: "ETF",
  },
  {
    instrument: instrument("HK", "HKEX", "Hong Kong", "03690", "03690.HK", "Meituan"),
    aliases: "美团",
    providerType: "GP",
  },
  {
    instrument: instrument("HK", "HKEX", "Hong Kong", "00941", "00941.HK", "China Mobile"),
    aliases: "中国移动 telecom",
    providerType: "GP",
  },
  {
    instrument: instrument("HK", "HKEX", "Hong Kong", "01211", "01211.HK", "BYD Company"),
    aliases: "比亚迪股份 electric vehicle",
    providerType: "GP",
  },
  {
    instrument: instrument("HK", "HKEX", "Hong Kong", "09618", "09618.HK", "JD.com"),
    aliases: "京东集团 jd",
    providerType: "GP",
  },
  {
    instrument: instrument(
      "HK",
      "HKEX",
      "Hong Kong",
      "02800",
      "02800.HK",
      "Tracker Fund of Hong Kong",
      "fund",
    ),
    aliases: "盈富基金 hang seng etf",
    providerType: "ETF",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "MSFT", "MSFT", "Microsoft"),
    aliases: "微软 software",
    providerType: "GP",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "TSLA", "TSLA", "Tesla"),
    aliases: "特斯拉 electric vehicle ev",
    providerType: "GP",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "AMZN", "AMZN", "Amazon"),
    aliases: "亚马逊 ecommerce cloud",
    providerType: "GP",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "GOOGL", "GOOGL", "Alphabet"),
    aliases: "谷歌 google",
    providerType: "GP",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "META", "META", "Meta Platforms"),
    aliases: "脸书 facebook",
    providerType: "GP",
  },
  {
    instrument: instrument("US", "NYSE", "NYSE", "SPY", "SPY", "SPDR S&P 500 ETF", "fund"),
    aliases: "标普etf sp500 fund",
    providerType: "ETF",
  },
  {
    instrument: instrument("US", "NASDAQ", "Nasdaq", "QQQ", "QQQ", "Invesco QQQ", "fund"),
    aliases: "纳指etf nasdaq 100 fund",
    providerType: "ETF",
  },
];

const DIRECTORY: ReadonlyArray<DirectoryEntry> = [
  ...PULSE_INSTRUMENTS.map((item) => ({
    instrument: item,
    aliases: PULSE_ALIASES[item.id] ?? "",
    providerType: item.assetClass === "index" ? "ZS" : item.assetClass === "fund" ? "ETF" : "GP",
  })),
  ...GLOBAL_INSTRUMENTS.map((item) => ({
    instrument: item,
    aliases: GLOBAL_ALIASES[item.id] ?? "",
    providerType: "FUTURE",
  })),
  ...EXTENDED_DIRECTORY,
];

export function searchKnownInstruments(keyword: string): ReadonlyArray<MarketSearchResult> {
  const needle = keyword.trim().toLowerCase();
  if (needle.length < 2) return [];
  return DIRECTORY.flatMap((entry) => {
    const haystack =
      `${entry.instrument.symbol} ${entry.instrument.sourceSymbol} ${entry.instrument.name} ${entry.instrument.shortName} ${entry.aliases}`.toLowerCase();
    if (!haystack.includes(needle)) return [];
    const starts =
      haystack.startsWith(needle) || entry.instrument.symbol.toLowerCase().startsWith(needle);
    return [{ entry, score: starts ? 0 : 1 }];
  })
    .sort((left, right) => left.score - right.score)
    .map(({ entry }) => ({
      instrument: entry.instrument,
      providerType: entry.providerType,
    }));
}

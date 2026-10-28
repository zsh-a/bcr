# Third-party notices

Macro Atlas uses [Apache ECharts](https://echarts.apache.org/) under the Apache License 2.0. Its license and upstream notice are included in `licenses/echarts-LICENSE.txt` and `licenses/echarts-NOTICE.txt`.

The optional Cycle Observatory 3D view uses [Three.js](https://threejs.org/) under the MIT License, reproduced in `licenses/three-LICENSE.txt`.

The Debt & Credit view includes BIS credit, debt service ratio and credit-to-GDP gap statistics under the [BIS terms of permitted use](https://data.bis.org/help/legal). BIS is credited as the source. Chinese indicator names and explanations are unofficial translations and do not imply endorsement or affiliation. PBOC aggregate financing observations retain their original source URLs and usage-statement links. Annual fiscal indicators are IMF GFS observations distributed through World Bank WDI under the [World Bank dataset terms](https://data.worldbank.org/summary-terms-of-use). Dataset-specific government coverage is retained; these figures are not presented as uniform general-government data. Original observations, retrieval dates and source identifiers are included in `packages/market-data/src/debt/*-snapshot.json` and exposed in the application and CSV exports. Local-currency year-on-year growth is separately identified as an application calculation from BIS levels.

The Cycle Observatory also includes BIS policy-rate and nominal/real residential-property-price statistics under the [BIS terms of permitted use](https://data.bis.org/help/legal). BIS is credited as the source; Chinese titles and explanations are unofficial translations and imply no endorsement. Country-specific policy tools, definition changes and gaps are retained in the series notes.

Bundled cycle observations are attributed to OECD (including amplitude-adjusted business and consumer confidence), the National Bureau of Statistics of China, and US statistical publishers including the Federal Reserve, BLS, BEA, Census Bureau and DOL, retrieved through FRED or the explicitly attributed fallback source. Each resource in `packages/market-data/src/cycle/*-snapshot.json` preserves its publisher, source URL, series identifier, usage-terms link and retrieval date. Dataset-specific terms and exceptions apply; FRED hosting does not itself grant redistribution rights to every series. Chicago Fed CFNAI/NFCI and proprietary PMI series are not bundled. Derived rate, inflation, payroll and unemployment statistics are explicitly labelled as application calculations, retain input-source references and do not acquire an invented publisher release date. Details and sources are exposed in the application and [cycle documentation](docs/CYCLE-MONITOR.md).

The bundled macroeconomic observations are from the World Bank's World Development Indicators. Dataset identity, original sources and retrieval dates are preserved in `packages/market-data/src/macro/worldbank-snapshot.json`; use follows the [World Bank dataset terms](https://data.worldbank.org/summary-terms-of-use), including attribution and indicator-specific exceptions. The application exposes the sources and indicator definitions in its data information panel and exports.

Quant Lab's JSG results view uses [TradingView Lightweight Charts 5.2.0](https://github.com/tradingview/lightweight-charts/tree/v5.2.0), distributed under the Apache License 2.0.

The upstream attribution notice is:

> TradingView Lightweight Charts™
> Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

The chart also displays this attribution and links to TradingView. The Apache License is included in `licenses/lightweight-charts-LICENSE.txt`; the dependency's own license applies without modification.

Knowledge uses Xiaomi's [MiSans](https://hyperos.mi.com/font/zh/about/) for Chinese and Latin interface and body text, supplied as WOFF2 Unicode subsets by [misans 5.0.0](https://github.com/dsrkafuu/misans). MiSans is used under the MiSans Font Intellectual Property License Agreement, included in `apps/studio/public/fonts/MiSans-LICENSE.txt` and served at `/fonts/MiSans-LICENSE.txt`. The package's Apache License 2.0 applies to its scripts; it does not replace the font's own license.

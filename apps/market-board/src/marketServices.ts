import {
  ResilientDividendService,
  ResilientHistoryService,
  ResilientMarketLandscapeService,
  ResilientMarketService,
  StockSdkProvider,
  MarketTrendService,
} from "@bcr/market-data";

export const marketProvider = new StockSdkProvider();
export const atlasService = new ResilientMarketService(marketProvider);
export const historyService = new ResilientHistoryService(marketProvider);
export const trendService = new MarketTrendService({
  id: marketProvider.id,
  loadHistory: (request, signal) => marketProvider.loadTrendHistory(request, signal),
});
export const landscapeService = new ResilientMarketLandscapeService(marketProvider);
export const dividendService = new ResilientDividendService(marketProvider);

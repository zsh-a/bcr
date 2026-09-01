import {
  ResilientHistoryService,
  ResilientMarketLandscapeService,
  ResilientMarketService,
  StockSdkProvider,
} from "@bcr/market-data";

export const marketProvider = new StockSdkProvider();
export const atlasService = new ResilientMarketService(marketProvider);
export const historyService = new ResilientHistoryService(marketProvider);
export const landscapeService = new ResilientMarketLandscapeService(marketProvider);

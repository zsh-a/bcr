import type { SearchDocument } from "@bcr/core";
import { listKnownInstruments } from "@bcr/market-data";

/** The immutable market catalog is loaded after the shell's first render. */
export function marketDocuments(): ReadonlyArray<SearchDocument> {
  return listKnownInstruments().map(({ instrument, aliases, providerType }) => ({
    id: `market:${instrument.id}`,
    source: "market",
    kind: "market-instrument",
    title: instrument.name,
    subtitle: `${instrument.symbol} · ${instrument.market} · ${instrument.venue}`,
    body: `${instrument.shortName} ${instrument.sourceSymbol} ${instrument.assetClass} ${providerType} ${aliases ?? ""}`,
    tags: ["market", instrument.market, instrument.assetClass, providerType],
    route: `/markets?instrument=${encodeURIComponent(instrument.id)}`,
    updatedAt: 0,
  }));
}

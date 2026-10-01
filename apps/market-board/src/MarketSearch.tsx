import { marketInstrumentName } from "@bcr/market-data";
import { ChevronRight, Search } from "lucide-react";
import { Spinner } from "@bcr/react";
import type { MarketInstrument } from "@bcr/market-data";
import type { useMarketDiscovery } from "./useMarketDiscovery";
export function MarketSearch({
  discovery,
  onOpen,
}: {
  discovery: ReturnType<typeof useMarketDiscovery>;
  onOpen: (instrument: MarketInstrument) => Promise<void>;
}) {
  const {
    query,
    searchOpen,
    searchCursor,
    searchingQuote,
    quoteError,
    searchRef,
    search,
    setQuery,
    setSearchOpen,
    setSearchCursor,
    setQuoteError,
  } = discovery;
  return (
    <div className="ma-search-shell">
      <div className="ma-search">
        {search.loading ? <Spinner size="sm" /> : <Search />}
        <input
          ref={searchRef}
          role="combobox"
          aria-label="搜索证券"
          aria-expanded={searchOpen && query.trim().length >= 2}
          aria-controls="ma-search-results"
          aria-autocomplete="list"
          value={query}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchCursor(0);
            setSearchOpen(true);
            setQuoteError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearchOpen(false);
              event.currentTarget.blur();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setSearchCursor((cursor) =>
                Math.min(Math.max(0, search.results.length - 1), cursor + 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSearchCursor((cursor) => Math.max(0, cursor - 1));
            } else if (event.key === "Enter") {
              const result = search.results[searchCursor];
              if (result !== undefined) {
                event.preventDefault();
                void onOpen(result.instrument);
              }
            }
          }}
          placeholder="搜索股票、指数或基金"
        />
        <kbd className="ui-kbd">/</kbd>
      </div>
      <div
        id="ma-search-results"
        className="ma-search-results"
        role="listbox"
        data-open={searchOpen && query.trim().length >= 2 ? "" : undefined}
      >
        <div className="ma-search-summary">
          <span>搜索市场</span>
          <small>
            {search.loading
              ? search.results.length > 0
                ? "正在补充在线结果"
                : "正在搜索"
              : search.remoteAvailable === false
                ? `${search.results.length} 个本地结果 · 在线搜索暂不可用`
                : `${search.results.length} 个结果`}
          </small>
        </div>
        {search.results.map((result, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === searchCursor}
            key={result.instrument.id}
            className={`ui-btn ui-btn-ghost ${index === searchCursor ? "active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSearchCursor(index)}
            onClick={() => void onOpen(result.instrument)}
            disabled={searchingQuote !== null}
          >
            <i>{result.instrument.market}</i>
            <span>
              <b>{marketInstrumentName(result.instrument)}</b>
              <small>
                {result.instrument.symbol} · {result.instrument.venue}
              </small>
            </span>
            <em>{result.providerType}</em>
            {searchingQuote === result.instrument.id ? <Spinner size="sm" /> : <ChevronRight />}
          </button>
        ))}
        {!search.loading && search.results.length === 0 && (
          <div className="ma-search-state">
            {search.error ?? quoteError ?? "没有找到相关标的，试试名称或代码"}
          </div>
        )}
        {quoteError !== null && search.results.length > 0 && (
          <div className="ma-search-state error">QUOTE · {quoteError}</div>
        )}
        <footer>股票 · 指数 · 基金 · 期货 · 输入 / 快速搜索</footer>
      </div>
    </div>
  );
}

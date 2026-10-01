import { lazy, Suspense, useEffect, useState } from "react";
import {
  WorkspaceTrigger,
  Button,
  Dialog,
  EmptyState,
  Input,
  Spinner,
  useLocationSearch,
  useNavigation,
  useRuntimeActivity,
} from "@bcr/react";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import type { MarketInstrument, MarketRankingItem, MarketSectorPulse } from "@bcr/market-data";
import { ChevronRight, Info, Plus, RefreshCw } from "lucide-react";
import { QuoteCard, Session } from "./MarketPanels";
import {
  BreadthSummary,
  DataStamp,
  RankingList,
  SectorDetail,
  SectorMap,
  SectorView,
  WatchRows,
} from "./MarketViews";
import { MarketSearch } from "./MarketSearch";
import { StockDetail } from "./StockDetail";
import { useMarketAtlas } from "./useMarketAtlas";
import { useQuoteTrends } from "./useQuoteTrends";
import { useMarketLandscape } from "./useMarketLandscape";
import { useMarketDiscovery } from "./useMarketDiscovery";
import { useMarketWatchlists } from "./useMarketWatchlists";
import "./styles.css";

const BreadthView = lazy(() => import("./BreadthView"));
const VIEWS = [
  { id: "overview", label: "概览" },
  { id: "sectors", label: "行业" },
  { id: "breadth", label: "宽度" },
  { id: "watchlist", label: "自选" },
] as const;
type MarketView = (typeof VIEWS)[number]["id"];
export function App() {
  const active = useRuntimeActivity();
  const navigation = useNavigation(),
    params = new URLSearchParams(useLocationSearch());
  const view: MarketView = VIEWS.find((item) => item.id === params.get("view"))?.id ?? "overview";
  const {
    snapshot,
    refreshing: atlasRefreshing,
    refresh: refreshAtlas,
  } = useMarketAtlas(view === "overview" || view === "watchlist");
  const {
    snapshot: landscape,
    refreshing: landscapeRefreshing,
    refresh: refreshLandscape,
  } = useMarketLandscape(view === "overview" || view === "sectors");
  const refreshing =
    view === "overview"
      ? atlasRefreshing || landscapeRefreshing
      : view === "sectors"
        ? landscapeRefreshing
        : atlasRefreshing;
  const refresh = () =>
    view === "sectors"
      ? refreshLandscape()
      : view === "watchlist"
        ? refreshAtlas()
        : Promise.all([refreshAtlas(), refreshLandscape()]);
  const discovery = useMarketDiscovery(snapshot.quotes, snapshot.futures);
  const {
    allQuotes,
    selected,
    region,
    searchingQuote,
    quoteError,
    searchRef,
    setSelectedId,
    setRegion,
    setSearchOpen,
    selectSearchResult,
  } = discovery;
  const {
    watchlists,
    activeGroup,
    newGroupName,
    creatingGroup,
    setNewGroupName,
    setCreatingGroup,
    toggleWatch,
    selectGroup,
    createGroup,
  } = useMarketWatchlists();
  const [detailId, setDetailId] = useState<string | null>(null),
    [sector, setSector] = useState<MarketSectorPulse | null>(null),
    [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    if (!active) {
      setDetailId(null);
      setSector(null);
      setSourceOpen(false);
    }
  }, [active]);
  const stockId = params.get("instrument") ?? detailId,
    stockOpen = stockId !== null;
  const stockQuote =
    selected?.instrument.id === stockId
      ? selected
      : allQuotes.find((q) => q.instrument.id === stockId);
  const openInstrument = async (instrument: MarketInstrument, ranking?: MarketRankingItem) => {
    setDetailId(instrument.id);
    setSector(null);
    navigation.navigate(`/markets?view=${view}&instrument=${encodeURIComponent(instrument.id)}`);
    const existing = allQuotes.find((q) => q.instrument.id === instrument.id);
    if (existing) {
      setSelectedId(existing.instrument.id);
      return;
    }
    const fallback = ranking
      ? {
          instrument,
          price: ranking.price,
          change: 0,
          changePercent: ranking.changePercent,
          previousClose: null,
          high: null,
          low: null,
          volume: null,
          amount: ranking.amount,
          receivedAt: landscape.receivedAt,
          sourceTimestamp: null,
          quality: landscape.quality === "partial" ? ("delayed" as const) : landscape.quality,
          source: landscape.provider,
          sparkline: [],
        }
      : undefined;
    await selectSearchResult({ instrument, providerType: "stock" }, fallback);
  };
  const closeStock = () => {
    setDetailId(null);
    navigation.navigate(`/markets?view=${view}`, true);
  };
  const moveView = (next: MarketView) => {
    setDetailId(null);
    setSector(null);
    setSearchOpen(false);
    navigation.navigate(`/markets?view=${next}`);
  };
  const watched = activeGroup.instrumentIds.flatMap((id) => {
    const quote = allQuotes.find((q) => q.instrument.id === id);
    return quote ? [quote] : [];
  });
  const visibleQuotes = snapshot.quotes.filter(
    (quote) => region === "ALL" || quote.instrument.market === region,
  );
  const quoteTrends = useQuoteTrends(visibleQuotes, view === "overview");
  return (
    <div className="market-atlas" data-view={view}>
      <header className="ma-header">
        <div className="ma-wordmark">
          <WorkspaceTrigger />
          <b>Market</b>
        </div>
        <nav className="ma-view-nav" aria-label="Market 视图">
          {VIEWS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => moveView(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <MarketSearch discovery={discovery} onOpen={openInstrument} />
        <div className="ma-header-actions">
          <Button
            variant="ghost"
            className="ui-icon-btn"
            aria-label="数据来源与市场时段"
            onClick={() => setSourceOpen(true)}
          >
            <Info size={16} />
          </Button>
          {view !== "breadth" && (
            <Button
              variant="ghost"
              className="ma-refresh ui-icon-btn"
              aria-label="刷新行情"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? <Spinner size="sm" /> : <RefreshCw size={16} />}
            </Button>
          )}
        </div>
      </header>
      <main className="ma-content">
        {view === "overview" && (
          <>
            <div className="ma-view-heading">
              <div>
                <h1>市场概览</h1>
                <p>市场状态、主要资产与行业动向</p>
              </div>
              <span className="ma-caption">
                {snapshot.sessions
                  .filter((s) => s.state === "open")
                  .map((s) => s.city)
                  .join(" · ") || "主要市场休市"}
              </span>
            </div>
            <BreadthSummary snapshot={landscape} />
            <section>
              <div className="ma-section-heading">
                <h2>主要资产</h2>
                <nav aria-label="市场区域">
                  {(["ALL", "CN", "HK", "US", "GLOBAL"] as const).map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant="ghost"
                      aria-pressed={region === item}
                      onClick={() => setRegion(item)}
                    >
                      {item === "ALL" ? "全部" : item}
                    </Button>
                  ))}
                </nav>
              </div>
              <div className="ma-quote-grid">
                {visibleQuotes.map((quote, index) => (
                  <QuoteCard
                    key={quote.instrument.id}
                    quote={quote}
                    trend={quoteTrends.get(quote.instrument.id)}
                    index={index + 1}
                    selected={false}
                    watched={activeGroup.instrumentIds.includes(quote.instrument.id)}
                    onSelect={() => void openInstrument(quote.instrument)}
                    onWatch={() => toggleWatch(quote.instrument.id)}
                  />
                ))}
              </div>
              <DataStamp
                source={snapshot.provider}
                quality={snapshot.quality}
                at={snapshot.receivedAt}
              />
            </section>
            <div className="ma-overview-grid">
              <section>
                <div className="ma-section-heading">
                  <h2>行业动向</h2>
                  <Button variant="ghost" size="sm" onClick={() => moveView("sectors")}>
                    全部行业 <ChevronRight size={14} />
                  </Button>
                </div>
                <SectorMap sectors={landscape.sectors.slice(0, 12)} onSelect={setSector} />
                <DataStamp
                  source={landscape.provider}
                  quality={landscape.quality}
                  at={landscape.receivedAt}
                />
              </section>
              <RankingList
                snapshot={landscape}
                onOpen={(instrument, ranking) => void openInstrument(instrument, ranking)}
              />
            </div>
          </>
        )}
        {view === "sectors" && <SectorView snapshot={landscape} onSelect={setSector} />}
        {view === "breadth" && (
          <Suspense
            fallback={
              <p className="ma-operation" role="status">
                <Spinner size="sm" />
                <span className="ma-operation-message">正在加载宽度分析…</span>
              </p>
            }
          >
            <BreadthView
              requestedSnapshot={params.get("snapshot")}
              requestedDate={params.get("date")}
            />
          </Suspense>
        )}
        {view === "watchlist" && (
          <section>
            <div className="ma-view-heading">
              <div>
                <h1>我的自选</h1>
                <p>按研究主题组织证券 · 点击名称查看详情</p>
              </div>
            </div>
            <div className="ma-watchlist-groups">
              <nav aria-label="自选分组">
                {watchlists.groups.map((group) => (
                  <Button
                    key={group.id}
                    variant="ghost"
                    aria-pressed={activeGroup.id === group.id}
                    onClick={() => selectGroup(group.id)}
                  >
                    {group.name}
                    <small>{group.instrumentIds.length}</small>
                  </Button>
                ))}
              </nav>
              <Button size="sm" variant="ghost" onClick={() => setCreatingGroup((v) => !v)}>
                <Plus size={16} />
                新建分组
              </Button>
            </div>
            {creatingGroup && (
              <form
                className="ma-new-group"
                onSubmit={(e) => {
                  e.preventDefault();
                  createGroup();
                }}
              >
                <Input
                  autoFocus
                  aria-label="分组名称"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="分组名称"
                />
                <Button type="submit" variant="primary" disabled={!newGroupName.trim()}>
                  创建
                </Button>
                <Button onClick={() => setCreatingGroup(false)}>取消</Button>
              </form>
            )}
            <WatchRows
              quotes={watched}
              watched={activeGroup.instrumentIds}
              onOpen={(quote) => void openInstrument(quote.instrument)}
              onWatch={toggleWatch}
            />
            {!activeGroup.instrumentIds.length && (
              <EmptyState
                title="开始整理你的研究标的"
                description="搜索证券，打开详情后加入当前自选分组。"
                action={<Button onClick={() => searchRef.current?.focus()}>搜索证券</Button>}
              />
            )}
            {activeGroup.instrumentIds.length > watched.length && (
              <p className="ma-caption">
                {activeGroup.instrumentIds.length - watched.length}{" "}
                只证券尚未取得行情，可通过顶部搜索加载。
              </p>
            )}
            <DataStamp
              source={snapshot.provider}
              quality={snapshot.quality}
              at={snapshot.receivedAt}
            />
          </section>
        )}
      </main>
      <SectorDetail
        sector={active ? sector : null}
        onClose={() => setSector(null)}
        onOpen={(instrument, ranking) => void openInstrument(instrument, ranking)}
      />
      <StockDetail
        open={active && stockOpen}
        quote={stockQuote}
        loading={searchingQuote !== null || (!stockQuote && !quoteError)}
        error={quoteError}
        onClose={closeStock}
        watched={stockQuote ? activeGroup.instrumentIds.includes(stockQuote.instrument.id) : false}
        onWatch={() => {
          if (stockQuote) toggleWatch(stockQuote.instrument.id);
        }}
      />
      <Dialog
        open={active && sourceOpen}
        onClose={() => setSourceOpen(false)}
        title="数据来源与市场时段"
        className="ma-source-dialog"
      >
        <div className="ma-sessions">
          {snapshot.sessions.map((session, index) => (
            <Session key={session.city} session={session} index={index + 1} />
          ))}
        </div>
        <h3>主要资产行情</h3>
        <DataStamp source={snapshot.provider} quality={snapshot.quality} at={snapshot.receivedAt} />
        {snapshot.errors.map((error, index) => (
          <p className="ma-caption" key={index}>
            {error}
          </p>
        ))}
        <h3>行业与市场分布</h3>
        <DataStamp
          source={landscape.provider}
          quality={landscape.quality}
          at={landscape.receivedAt}
        />
        {landscape.errors.map((error, index) => (
          <p className="ma-caption" key={index}>
            {error}
          </p>
        ))}
        <p className="ma-caption">
          宽度使用独立的 ClickHouse 冻结快照。各模块显示自己的来源与数据时间。
        </p>
      </Dialog>
    </div>
  );
}

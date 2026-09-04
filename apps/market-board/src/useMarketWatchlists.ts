import type { MarketWatchlistGroup, MarketWatchlistState } from "@bcr/market-data";
import { useEffect, useState } from "react";

const WATCHLIST_KEY = "bcr.market-atlas.watchlist.v2";
const LEGACY_WATCHLIST_KEY = "bcr.market-atlas.watchlist.v1";
const DEFAULT_WATCHLIST = ["CN:SSE:000300", "HK:HKEX:HSI", "US:INDEX:INX"];

const DEFAULT_WATCHLIST_GROUPS: ReadonlyArray<MarketWatchlistGroup> = [
  {
    id: "core",
    name: "Core",
    instrumentIds: DEFAULT_WATCHLIST,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "macro",
    name: "Macro",
    instrumentIds: ["CN:SSE:000001", "US:INDEX:DJI", "GLOBAL:FUTURE:GC00Y"],
    createdAt: 0,
    updatedAt: 0,
  },
];

export const FALLBACK_WATCHLIST_GROUP = DEFAULT_WATCHLIST_GROUPS[0] as MarketWatchlistGroup;

function validWatchlistState(value: unknown): value is MarketWatchlistState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MarketWatchlistState>;
  return (
    candidate.version === 1 &&
    typeof candidate.activeGroupId === "string" &&
    Array.isArray(candidate.groups) &&
    candidate.groups.length > 0 &&
    candidate.groups.every(
      (group) =>
        typeof group === "object" &&
        group !== null &&
        typeof group.id === "string" &&
        typeof group.name === "string" &&
        Array.isArray(group.instrumentIds),
    )
  );
}

function defaultWatchlists(now: number): MarketWatchlistState {
  return {
    version: 1,
    activeGroupId: "core",
    groups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group, createdAt: now, updatedAt: now })),
  };
}

function initialWatchlists(): MarketWatchlistState {
  const now = Date.now();
  try {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      if (validWatchlistState(parsed)) {
        const activeGroupId = parsed.groups.some((group) => group.id === parsed.activeGroupId)
          ? parsed.activeGroupId
          : (parsed.groups[0]?.id ?? "core");
        return { ...parsed, activeGroupId };
      }
    }
    const legacy = localStorage.getItem(LEGACY_WATCHLIST_KEY);
    const legacyIds = legacy === null ? null : (JSON.parse(legacy) as unknown);
    const migratedIds =
      Array.isArray(legacyIds) && legacyIds.every((id) => typeof id === "string")
        ? legacyIds
        : DEFAULT_WATCHLIST;
    const state = defaultWatchlists(now);
    return {
      ...state,
      groups: state.groups.map((group, index) =>
        index === 0 ? { ...group, instrumentIds: migratedIds } : group,
      ),
    };
  } catch {
    return defaultWatchlists(now);
  }
}

export function useMarketWatchlists() {
  const [watchlists, setWatchlists] = useState<MarketWatchlistState>(initialWatchlists);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const activeGroup =
    watchlists.groups.find((group) => group.id === watchlists.activeGroupId) ??
    watchlists.groups[0] ??
    FALLBACK_WATCHLIST_GROUP;

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlists));
    } catch {
      // Watchlist remains available for this session when persistent storage is blocked.
    }
  }, [watchlists]);

  const toggleWatch = (instrumentId: string): void => {
    setWatchlists((state) => ({
      ...state,
      groups: state.groups.map((group) =>
        group.id !== state.activeGroupId
          ? group
          : {
              ...group,
              instrumentIds: group.instrumentIds.includes(instrumentId)
                ? group.instrumentIds.filter((item) => item !== instrumentId)
                : [...group.instrumentIds, instrumentId],
              updatedAt: Date.now(),
            },
      ),
    }));
  };

  const selectGroup = (id: string): void => {
    setWatchlists((state) =>
      state.groups.some((group) => group.id === id) ? { ...state, activeGroupId: id } : state,
    );
  };

  const createGroup = (): void => {
    const name = newGroupName.trim();
    if (name.length === 0) return;
    const baseId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setWatchlists((state) => {
      const now = Date.now();
      const group: MarketWatchlistGroup = {
        id: `${baseId || "group"}-${now.toString(36)}`,
        name,
        instrumentIds: [],
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, activeGroupId: group.id, groups: [...state.groups, group] };
    });
    setNewGroupName("");
    setCreatingGroup(false);
  };

  return {
    watchlists,
    activeGroup,
    newGroupName,
    creatingGroup,
    setNewGroupName,
    setCreatingGroup,
    toggleWatch,
    selectGroup,
    createGroup,
  } as const;
}

import type { QuantHandoff, QuantMarketHandoff, QuantPortfolioHandoff } from "./model";

export const QUANT_HANDOFF_KEY = "bcr.market-atlas.quant-handoff.v2";
const LEGACY_QUANT_HANDOFF_KEY = "bcr.market-atlas.quant-handoff.v1";
export const QUANT_HANDOFF_EVENT = "bcr:quant-market-handoff";

function validInstrument(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { symbol?: unknown }).symbol === "string"
  );
}

function validBars(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (bar) =>
        typeof bar === "object" &&
        bar !== null &&
        typeof (bar as { date?: unknown }).date === "string" &&
        Number.isFinite((bar as { close?: unknown }).close),
    )
  );
}

function valid(value: unknown): value is QuantHandoff {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<QuantMarketHandoff> & Partial<QuantPortfolioHandoff>;
  if (!Number.isFinite(candidate.createdAt)) return false;
  if (candidate.version === 1) {
    return validInstrument(candidate.instrument) && validBars(candidate.bars);
  }
  return (
    candidate.version === 2 &&
    typeof candidate.groupId === "string" &&
    typeof candidate.groupName === "string" &&
    Array.isArray(candidate.series) &&
    candidate.series.length > 0 &&
    candidate.series.every(
      (series) =>
        typeof series === "object" &&
        series !== null &&
        validInstrument(series.instrument) &&
        validBars(series.bars),
    )
  );
}

export function isQuantHandoff(value: unknown): value is QuantHandoff {
  return valid(value);
}

export function publishQuantHandoff(handoff: QuantHandoff): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUANT_HANDOFF_KEY, JSON.stringify(handoff));
  window.dispatchEvent(new CustomEvent(QUANT_HANDOFF_EVENT));
}

export function consumeQuantHandoff(): QuantHandoff | null {
  if (typeof window === "undefined") return null;
  let sourceKey = QUANT_HANDOFF_KEY;
  try {
    let raw = window.localStorage.getItem(sourceKey);
    if (raw === null) {
      sourceKey = LEGACY_QUANT_HANDOFF_KEY;
      raw = window.localStorage.getItem(sourceKey);
    }
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed)) {
      window.localStorage.removeItem(sourceKey);
      return null;
    }
    window.localStorage.removeItem(sourceKey);
    return parsed;
  } catch {
    window.localStorage.removeItem(sourceKey);
    return null;
  }
}

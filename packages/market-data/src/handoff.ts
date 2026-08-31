import type { QuantMarketHandoff } from "./model";

export const QUANT_HANDOFF_KEY = "bcr.market-atlas.quant-handoff.v1";
export const QUANT_HANDOFF_EVENT = "bcr:quant-market-handoff";

function valid(value: unknown): value is QuantMarketHandoff {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<QuantMarketHandoff>;
  return (
    candidate.version === 1 &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.instrument === "object" &&
    candidate.instrument !== null &&
    typeof candidate.instrument.id === "string" &&
    Array.isArray(candidate.bars) &&
    candidate.bars.length > 0
  );
}

export function publishQuantHandoff(handoff: QuantMarketHandoff): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUANT_HANDOFF_KEY, JSON.stringify(handoff));
  window.dispatchEvent(new CustomEvent(QUANT_HANDOFF_EVENT));
}

export function consumeQuantHandoff(): QuantMarketHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(QUANT_HANDOFF_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed)) {
      window.localStorage.removeItem(QUANT_HANDOFF_KEY);
      return null;
    }
    window.localStorage.removeItem(QUANT_HANDOFF_KEY);
    return parsed;
  } catch {
    window.localStorage.removeItem(QUANT_HANDOFF_KEY);
    return null;
  }
}

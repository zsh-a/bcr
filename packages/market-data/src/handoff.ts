import type { QuantHandoff, QuantMarketHandoff, QuantPortfolioHandoff } from "./model";
import { contentHash } from "@bcr/core";
import { OpfsStore, type BinaryStore } from "@bcr/storage-opfs";

export const QUANT_HANDOFF_KEY = "bcr.market-atlas.quant-handoff.v2";
const LEGACY_QUANT_HANDOFF_KEY = "bcr.market-atlas.quant-handoff.v1";
export const QUANT_HANDOFF_EVENT = "bcr:quant-market-handoff";
const REFERENCE_KEY = "bcr.market.quant-reference.v1";
const MAX_HANDOFF_BYTES = 16 * 1024 * 1024;

export async function publishQuantReference(
  handoff: QuantHandoff,
  store: BinaryStore = new OpfsStore("market"),
): Promise<void> {
  if (!valid(handoff)) throw new Error("行情交接数据无效");
  const bytes = new TextEncoder().encode(JSON.stringify(handoff));
  if (bytes.byteLength > MAX_HANDOFF_BYTES) throw new Error("行情交接超过大小限制，请减少自选标的");
  const id = contentHash(bytes);
  await store.put(`handoffs/${id}`, bytes);
  localStorage.setItem(REFERENCE_KEY, JSON.stringify({ version: 1, id }));
  window.dispatchEvent(new CustomEvent(QUANT_HANDOFF_EVENT));
}
/** Acknowledge only after import and project persistence both succeed. */
export async function receiveQuantReference(
  importer: (handoff: QuantHandoff) => Promise<void>,
  store: BinaryStore = new OpfsStore("market"),
): Promise<boolean> {
  const receive = async () => {
    const raw = localStorage.getItem(REFERENCE_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as { version: number; id: string };
    if (value.version !== 1 || !/^[a-f0-9]{64}$/u.test(value.id))
      throw new Error("行情交接引用无效");
    const path = `handoffs/${value.id}`;
    if (((await store.size(path)) ?? Infinity) > MAX_HANDOFF_BYTES)
      throw new Error("行情交接数据不可用");
    const bytes = await store.get(path);
    if (!bytes || contentHash(bytes) !== value.id) throw new Error("行情交接数据校验失败");
    const handoff: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!valid(handoff)) throw new Error("行情交接数据无效");
    await importer(handoff);
    if (localStorage.getItem(REFERENCE_KEY) === raw) localStorage.removeItem(REFERENCE_KEY);
    await store.delete(path);
    return true;
  };
  return navigator.locks ? navigator.locks.request("bcr:market:quant-handoff", receive) : receive();
}

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

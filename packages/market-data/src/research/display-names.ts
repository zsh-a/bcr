/** Display metadata only; codes remain the identities used by the strategy and ledger. */
export interface DisplayNames {
  instruments: Record<string, string>;
  industries: Record<string, string>;
  capturedAt?: string;
}

export const EMPTY_DISPLAY_NAMES: DisplayNames = { instruments: {}, industries: {} };
const hasControls = (value: string) => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
};
export function parseDisplayNames(value: unknown): DisplayNames {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("名称元数据无效");
  const raw = value as Record<string, unknown>;
  const dictionary = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("名称字典无效");
    const entries = Object.entries(value);
    if (entries.length > 20_000) throw new Error("名称数量超过 20,000");
    for (const [code, name] of entries)
      if (
        !code ||
        code.length > 2000 ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 200 ||
        hasControls(name)
      )
        throw new Error("名称字段无效");
    return Object.fromEntries(entries.map(([code, name]) => [code, (name as string).trim()]));
  };
  const capturedAt = raw["capturedAt"];
  if (
    capturedAt !== undefined &&
    (typeof capturedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/u.test(capturedAt) ||
      !Number.isFinite(Date.parse(capturedAt)))
  )
    throw new Error("名称获取时间无效");
  return {
    instruments: dictionary(raw["instruments"]),
    industries: dictionary(raw["industries"]),
    ...(capturedAt !== undefined ? { capturedAt: capturedAt as string } : {}),
  };
}
export function displayName(names: DisplayNames, kind: "instruments" | "industries", code: string) {
  const name = Object.hasOwn(names[kind], code) ? names[kind][code]! : undefined;
  return name ?? (kind === "industries" && code === "unknown" ? "未分类" : code);
}
export function displayLabel(
  names: DisplayNames,
  kind: "instruments" | "industries",
  code: string,
) {
  const name = displayName(names, kind, code);
  return name === code ? code : `${name} · ${code}`;
}
export function subsetNames(names: DisplayNames, instruments: string[], industries: string[]) {
  const subset = (keys: string[], dictionary: Record<string, string>) =>
    Object.fromEntries(
      keys.filter((key) => Object.hasOwn(dictionary, key)).map((key) => [key, dictionary[key]!]),
    );
  return {
    ...names,
    instruments: subset(instruments, names.instruments),
    industries: subset(industries, names.industries),
  };
}

/** Send only matching identities to the result worker, rather than a dictionary per page. */
export function nameMatches(names: DisplayNames, query: string): string[] {
  const text = query.trim().toLocaleLowerCase();
  return text
    ? Object.entries(names.instruments)
        .filter(([, name]) => name.toLocaleLowerCase().includes(text))
        .map(([code]) => code)
    : [];
}

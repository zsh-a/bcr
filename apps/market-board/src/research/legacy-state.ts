export type LegacyWorkspaceLayer = "history" | "cycle" | "debt" | "research";
export const RESEARCH_QUERY_KEYS = [
  "rFrom",
  "rTo",
  "rDate",
  "rAsOf",
  "rPreset",
  "rPins",
  "rFocus",
  "rEvent",
] as const;
export const hasResearchState = (params: URLSearchParams) =>
  RESEARCH_QUERY_KEYS.some((key) => params.has(key));

/** Validate the calendar itself: Date.parse would silently accept February 30. */
export function calendarDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8));
  if (year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day >= 1 && day <= days ? value : null;
}
export function legacyPeriodDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}$/u.test(value)) return calendarDate(`${value}-12-31`);
  const quarter = /^(\d{4})-Q([1-4])$/u.exec(value);
  if (quarter)
    return legacyPeriodDate(`${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) return calendarDate(value);
  for (const day of [31, 30, 29, 28]) {
    const date = calendarDate(`${value}-${day}`);
    if (date) return date;
  }
  return null;
}
export function windowStart(end: string, years: number): string {
  return `${String(Math.max(1, Number(end.slice(0, 4)) - years)).padStart(4, "0")}${end.slice(4, 7)}-01`;
}
function sourceLayer(params: URLSearchParams): LegacyWorkspaceLayer {
  const layer = params.get("layer");
  if (layer === "cycle" || layer === "debt" || layer === "history") return layer;
  if (["indicator", "from", "to", "year", "mode", "event"].some((key) => params.has(key)))
    return "history";
  return "research";
}
/** Import an old link once. Explicit research fields always take precedence. */
export function migrateLegacyResearchParams(
  search: string | URLSearchParams,
  maxDate?: string,
): URLSearchParams {
  const params = new URLSearchParams(search);
  if (hasResearchState(params)) return params;
  const layer = sourceLayer(params);
  if (layer === "research") return params;
  const cycle = layer === "cycle",
    debt = layer === "debt";
  const date = legacyPeriodDate(
    params.get(cycle ? "period" : debt ? "debtQuarter" : "year") ??
      (!cycle && !debt ? params.get("to") : null),
  );
  const latest = cycle
    ? params.get("cycleAsOf") === "latest"
    : debt
      ? params.get("debtAsOf") !== "quarter"
      : params.get("mode") !== "phase";
  params.set("rAsOf", latest ? "latest" : "date");
  if (date && !latest) params.set("rDate", date);
  const focus = params.get(cycle ? "cycleFocus" : debt ? "debtFocus" : "rFocus");
  if (focus !== null) params.set("rFocus", focus);
  const metric = params.get(cycle ? "cycleMetric" : debt ? "debtMetric" : "indicator");
  if (metric) params.set("rPins", `${cycle ? "cycle" : debt ? "debt" : "annual"}:${metric}`);
  const window = params.get(cycle ? "cycleWindow" : "debtWindow");
  if (cycle || debt) {
    const end = (!latest && date) || maxDate || date;
    if (window === "all") params.set("rFrom", "0001-01-01");
    else if (end && (window === "5y" || window === "10y"))
      params.set("rFrom", windowStart(end, window === "10y" ? 10 : 5));
  } else {
    const from = params.get("from"),
      to = legacyPeriodDate(params.get("to"));
    if (from && /^\d{4}$/u.test(from) && calendarDate(`${from}-01-01`))
      params.set("rFrom", `${from}-01-01`);
    if (to) params.set("rTo", to);
    const event = params.get("event");
    if (event) params.set("rEvent", event);
  }
  return params;
}

/** A domain picker edits only its visible economies; retain the rest of the global selection. */
export function legacyCountries(
  selected: string[],
  search: string,
  supported: readonly string[],
): string[] {
  if (!search) return selected;
  const allowed = new Set(supported),
    desired = new Set(selected);
  const previous = new URLSearchParams(search).get("countries")?.split(",") ?? [];
  return [
    ...new Set([
      ...previous.filter((id) => /^[A-Z]{3}$/u.test(id) && (!allowed.has(id) || desired.has(id))),
      ...selected,
    ]),
  ];
}
interface LegacySelection {
  date: string;
  asOf: "latest" | "date";
  focus?: string | null;
  window?: "5y" | "10y" | "all";
  range?: [number, number];
  event?: string | null;
  supported?: readonly string[];
}
/** Synchronize explicit changes, without turning an unchanged latest view into a historic cutoff. */
export function syncResearchFromLegacy(
  params: URLSearchParams,
  previous: URLSearchParams,
  layer: Exclude<LegacyWorkspaceLayer, "research">,
  state: LegacySelection,
): void {
  if (!hasResearchState(previous)) return;
  const cycle = layer === "cycle",
    debt = layer === "debt";
  const dateKey = cycle ? "period" : debt ? "debtQuarter" : "year";
  const oldDate = legacyPeriodDate(previous.get(dateKey));
  const oldLatest = cycle
    ? previous.get("cycleAsOf") === "latest"
    : debt
      ? previous.get("debtAsOf") !== "quarter"
      : previous.get("mode") !== "phase";
  const changedMode = (oldLatest ? "latest" : "date") !== state.asOf;
  if (changedMode) params.set("rAsOf", state.asOf);
  if (state.asOf === "date" && ((oldDate && oldDate !== state.date) || changedMode)) {
    params.set("rDate", state.date);
    const to = calendarDate(params.get("rTo"));
    if (to && state.date > to) params.set("rTo", state.date);
  }
  const focusKey = cycle ? "cycleFocus" : "debtFocus";
  const oldFocus = previous.get(focusKey);
  const projectedFocus =
    oldFocus && state.supported?.includes(oldFocus)
      ? oldFocus
      : (previous
          .get("countries")
          ?.split(",")
          .find((id) => state.supported?.includes(id)) ?? null);
  if ((cycle || debt) && previous.has(focusKey) && projectedFocus !== state.focus)
    params.set("rFocus", state.focus ?? "");
  const windowKey = cycle ? "cycleWindow" : "debtWindow";
  if (
    (cycle || debt) &&
    state.window &&
    previous.has(windowKey) &&
    previous.get(windowKey) !== state.window
  ) {
    const end =
      state.asOf === "latest"
        ? (calendarDate(params.get("rTo")) ?? calendarDate(params.get("rDate")) ?? state.date)
        : state.date;
    params.set(
      "rFrom",
      state.window === "all" ? "0001-01-01" : windowStart(end, state.window === "10y" ? 10 : 5),
    );
  }
  if (layer === "history" && state.range) {
    if (previous.has("from") && previous.get("from") !== String(state.range[0]))
      params.set("rFrom", `${state.range[0]}-01-01`);
    if (previous.has("to") && previous.get("to") !== String(state.range[1]))
      params.set("rTo", `${state.range[1]}-12-31`);
    if (previous.has("event") && previous.get("event") !== state.event) {
      if (state.event) params.set("rEvent", state.event);
      else params.delete("rEvent");
    }
  }
}
function seedLegacyFromResearch(
  params: URLSearchParams,
  layer: Exclude<LegacyWorkspaceLayer, "research">,
): void {
  if (!hasResearchState(params)) return;
  const date = calendarDate(params.get("rDate")) ?? calendarDate(params.get("rTo"));
  const setMissing = (key: string, value: string | null | undefined) => {
    if (!params.has(key) && value != null) params.set(key, value);
  };
  const latest = params.get("rAsOf") !== "date",
    focus = params.get("rFocus");
  const from = calendarDate(params.get("rFrom")),
    to = calendarDate(params.get("rTo"));
  const window =
    from && Number(from.slice(0, 4)) === 1
      ? "all"
      : from && to && Number(to.slice(0, 4)) - Number(from.slice(0, 4)) >= 9
        ? "10y"
        : "5y";
  if (layer === "cycle") {
    setMissing("period", date?.slice(0, 7));
    setMissing("cycleAsOf", latest ? "latest" : "period");
    setMissing("cycleFocus", focus);
    setMissing("cycleWindow", window);
  } else if (layer === "debt") {
    setMissing(
      "debtQuarter",
      date ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}` : null,
    );
    setMissing("debtAsOf", latest ? "latest" : "quarter");
    setMissing("debtFocus", focus);
    setMissing("debtWindow", window);
  } else {
    setMissing("from", from?.slice(0, 4));
    setMissing("to", to?.slice(0, 4));
    setMissing("year", date?.slice(0, 4));
    setMissing("mode", latest ? "trend" : "phase");
    setMissing("event", params.get("rEvent"));
  }
}
export function legacyWorkspaceUrl(layer: LegacyWorkspaceLayer, search: string): string {
  const params =
    layer === "research" ? migrateLegacyResearchParams(search) : new URLSearchParams(search);
  if (layer !== "research") seedLegacyFromResearch(params, layer);
  params.set("view", "macro");
  params.set("layer", layer);
  return `/markets?${params}`;
}

"""Active-window prehistory, matching quant-core's trendWarmupDays exactly."""
import math


BACKGROUND_MINUTES = {
    1: 5, 3: 15, 5: 30, 15: 60, 30: 120,
    60: 240, 120: 720, 240: 1440, 1440: 10080,
}
WARMUP_POLICY = "active-windows-v1"


def is_development(window):
    return window.get("role", "development" if window["id"] == "development" else "unspecified") == "development"


def warmup_days(strategy):
    minutes = strategy.get("tradeMinutes", 1)
    if minutes not in BACKGROUND_MINUTES:
        raise ValueError("invalid trading period for warmup")
    entry = strategy.get("entry", "breakout")
    entry_bars = (strategy.get("breakoutBars", 20) if entry == "breakout" else
                  17 if entry in ("price-action", "structured-pullback") else 9 if entry == "kdj" else 3)
    filter_kind = strategy.get("filter", "background")
    filter_bars = 63 if filter_kind == "slow-ema" else 60 if filter_kind == "ema" else 0
    exit_bars = (strategy.get("channelExitBars", max(1, strategy.get("breakoutBars", 20) // 2))
                 if strategy.get("management") == "channel" else 0)
    background = 22 * BACKGROUND_MINUTES[minutes] if filter_kind == "background" or entry == "price-action" else 0
    if entry == "structured-pullback":
        # Every ablation observes the same confirmed higher-timeframe pivots and
        # previously validated EMA levels, even when its entry gate is disabled.
        background = 42 * BACKGROUND_MINUTES[minutes]
    days = max(1, math.ceil(max(max(14, entry_bars, exit_bars, filter_bars) * minutes, background) / 1440))
    if days > 250:
        raise ValueError("warmup exceeds 250 days")
    return days


def window_warmup_days(plan, window):
    """Download enough for every possible frozen choice and its sensitivities.

    Selection is not read during download. Stress costs do not change prehistory.
    """
    candidates = list(plan["candidates"])
    if not is_development(window):
        candidates += [dict(candidate, **{k: v for k, v in sensitivity.items() if k != "id"})
                       for candidate in plan["candidates"] for sensitivity in plan.get("sensitivity", [])]
    if not candidates:
        raise ValueError("research requires declared candidates")
    return max(warmup_days(candidate) for candidate in candidates)

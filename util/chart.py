from datetime import datetime, time
from zoneinfo import ZoneInfo

import pandas as pd
import twstock
import yfinance as yf
from curl_cffi import requests as curl_requests

TZ = ZoneInfo("Asia/Taipei")
PRE_MARKET_OPEN = time(8, 30)
MARKET_OPEN = time(9, 0)
MARKET_CLOSE = time(13, 30)
_PREV_CLOSE_CACHE: dict[tuple[str, str], float] = {}


def yfinance_symbol(code: str) -> str:
    suffix = "TW" if code in twstock.twse else "TWO"
    return f"{code}.{suffix}"


def _create_session() -> curl_requests.Session:
    # Source - https://stackoverflow.com/a/79789555
    # Posted by Jason V
    # Retrieved 2026-07-24, License - CC BY-SA 4.0
    session = curl_requests.Session(impersonate="chrome")
    session.verify = False
    return session


def _get_ticker(symbol: str) -> yf.Ticker:
    return yf.Ticker(ticker=symbol, session=_create_session())


def _series(df: pd.DataFrame, column: str) -> pd.Series:
    if df.empty:
        return pd.Series(dtype=float)
    values = df[column]
    if isinstance(values, pd.DataFrame):
        return values.iloc[:, 0]
    return values


def _to_local(ts) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=TZ)
    return ts.astimezone(TZ)


def _previous_close_from_daily(daily: pd.DataFrame, today) -> float | None:
    close = _series(daily, "Close").dropna()
    if close.empty:
        return None

    for ts in reversed(close.index):
        if _to_local(ts).date() < today:
            return float(close.loc[ts])

    return float(close.iloc[-1])


def _get_previous_close_from_yf(code: str, today) -> float | None:
    symbol = yfinance_symbol(code)
    daily = _get_ticker(symbol).history(
        period="10d",
        interval="1d",
        auto_adjust=False,
    )
    prev_close = _previous_close_from_daily(daily, today)
    return round(prev_close, 4) if prev_close is not None else None


def get_previous_close_for_code(code: str) -> float | None:
    """供 /api/stock 使用；走勢圖載入後會寫入快取，否則查 1d 日線。"""
    today = datetime.now(TZ).date()
    cache_key = (code, today.isoformat())

    if cache_key in _PREV_CLOSE_CACHE:
        return _PREV_CLOSE_CACHE[cache_key]

    rounded_prev_close = _get_previous_close_from_yf(code, today)

    if rounded_prev_close is not None:
        _PREV_CLOSE_CACHE[cache_key] = rounded_prev_close

    return rounded_prev_close


def _y_axis_bounds(prev_close: float, prices: list[float]) -> tuple[float, float]:
    if prices:
        max_dev = max(abs(price - prev_close) for price in prices)
    else:
        max_dev = 0.0

    if max_dev == 0:
        max_dev = prev_close * 0.005

    return round(prev_close - max_dev, 4), round(prev_close + max_dev, 4)


def _time_to_minutes(time_str: str) -> int:
    hour, minute = map(int, time_str.split(":"))
    return hour * 60 + minute


def _normalize_chart_points(raw_points: list[dict[str, object]]) -> list[dict[str, object]]:
    premarket: dict[str, float] = {}
    regular: dict[str, float] = {}
    closing_price: float | None = None

    pre_market_open = 8 * 60 + 30
    market_open = 9 * 60
    last_regular = 13 * 60 + 24
    closing_start = 13 * 60 + 25
    market_close = 13 * 60 + 30

    for point in raw_points:
        time_str = str(point["time"])
        minutes = _time_to_minutes(time_str)
        price = float(point["price"])

        if pre_market_open <= minutes < market_open:
            premarket[time_str] = price
        elif market_open <= minutes <= last_regular:
            regular[time_str] = price
        elif closing_start <= minutes <= market_close:
            closing_price = price

    normalized: list[dict[str, object]] = []
    for time_str in sorted(premarket.keys()):
        normalized.append({"time": time_str, "price": premarket[time_str]})
    for time_str in sorted(regular.keys()):
        normalized.append({"time": time_str, "price": regular[time_str]})
    if closing_price is not None:
        normalized.append({"time": "13:30", "price": round(closing_price, 4)})

    return normalized


def get_intraday_chart(code: str) -> dict:
    symbol = yfinance_symbol(code)
    today = datetime.now(TZ).date()
    ticker = _get_ticker(symbol)
    # history() 回傳分鐘 K 線 DataFrame，並在同一次回應的 history_metadata 附帶昨收
    intraday = ticker.history(period="1d", interval="1m", auto_adjust=False)
    raw_prev_close = (getattr(ticker, "history_metadata", None) or {}).get(
        "chartPreviousClose"
    )
    if raw_prev_close is not None:
        prev_close = round(float(raw_prev_close), 4)
        _PREV_CLOSE_CACHE[(code, today.isoformat())] = prev_close
    else:
        # metadata 缺值時才 fallback 到 1d 日線
    prev_close = get_previous_close_for_code(code)

    points: list[dict[str, object]] = []
    if not intraday.empty:
        close = _series(intraday, "Close")
        for ts, price in close.dropna().items():
            local = _to_local(ts)
            # if local.date() != today:
            #     continue
            local_time = local.time()
            if (PRE_MARKET_OPEN <= local_time < MARKET_OPEN) or (
                MARKET_OPEN <= local_time <= MARKET_CLOSE
            ):
                points.append(
                    {
                        "time": local.strftime("%H:%M"),
                        "price": round(float(price), 4),
                    }
                )

    points = _normalize_chart_points(points)

    result: dict[str, object] = {
        "success": True,
        "symbol": symbol,
        "prev_close": round(prev_close, 4) if prev_close is not None else None,
        "points": points,
    }

    if prev_close is not None:
        prices = [float(point["price"]) for point in points]
        y_min, y_max = _y_axis_bounds(prev_close, prices)
        result["y_min"] = y_min
        result["y_max"] = y_max

    if not points:
        result["message"] = "尚無當日走勢資料"

    return result

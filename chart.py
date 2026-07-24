from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

import pandas as pd
import twstock
import yfinance as yf
from curl_cffi import requests as curl_requests

TZ = ZoneInfo("Asia/Taipei")
MARKET_OPEN = time(9, 0)
MARKET_CLOSE = time(13, 30)


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


def get_previous_close_for_code(code: str) -> float | None:
    symbol = yfinance_symbol(code)
    today = datetime.now(TZ).date()
    daily = _get_ticker(symbol).history(
        period="10d",
        interval="1d",
        auto_adjust=False,
    )
    prev_close = _previous_close_from_daily(daily, today)
    return round(prev_close, 4) if prev_close is not None else None


def _y_axis_bounds(prev_close: float, prices: list[float]) -> tuple[float, float]:
    if prices:
        max_dev = max(abs(price - prev_close) for price in prices)
    else:
        max_dev = 0.0

    if max_dev == 0:
        max_dev = prev_close * 0.005

    return round(prev_close - max_dev, 4), round(prev_close + max_dev, 4)


def get_intraday_chart(code: str) -> dict:
    symbol = yfinance_symbol(code)
    today = datetime.now(TZ).date()
    ticker = _get_ticker(symbol)

    intraday = ticker.history(period="1d", interval="1m", auto_adjust=False)
    daily = ticker.history(period="10d", interval="1d", auto_adjust=False)
    prev_close = _previous_close_from_daily(daily, today)

    points: list[dict[str, object]] = []
    if not intraday.empty:
        close = _series(intraday, "Close")
        for ts, price in close.dropna().items():
            local = _to_local(ts)
            if local.date() != today:
                continue
            local_time = local.time()
            if MARKET_OPEN <= local_time <= MARKET_CLOSE:
                points.append(
                    {
                        "time": local.strftime("%H:%M"),
                        "price": round(float(price), 4),
                    }
                )

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

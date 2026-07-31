import twstock
from util.index_entries import INDEX_ENTRIES, IndexEntry
from itertools import chain

SEARCHABLE_TYPES = frozenset(
    {
        "股票",
        "ETF",
        "創新板",
        "指數",
        # "特別股",
        # "ETN",
        # "臺灣存託憑證(TDR)",
    }
)

_STOCK_INDEX: list[dict[str, str]] = []


def _build_stock_index() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for code, info in chain(INDEX_ENTRIES.items(), twstock.codes.items()):
        if info.type not in SEARCHABLE_TYPES:
            continue
        entries.append(
            {
                "code": code,
                "name": info.name,
                "market": info.market,
                "type": info.type,
            }
        )
    return entries


def get_stock_index() -> list[dict[str, str]]:
    global _STOCK_INDEX
    if not _STOCK_INDEX:
        _STOCK_INDEX = _build_stock_index()
    return _STOCK_INDEX


def is_index_code(code: str) -> bool:
    return code in INDEX_ENTRIES


def get_index_entry(code: str) -> IndexEntry | None:
    return INDEX_ENTRIES.get(code)


def is_valid_code(code: str) -> bool:
    if is_index_code(code):
        return True
    info = twstock.codes.get(code)
    return info is not None and info.type in SEARCHABLE_TYPES

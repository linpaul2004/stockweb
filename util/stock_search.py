import twstock

INDEX_ENTRIES: dict[str, dict[str, str]] = {
    "^TWII": {
        "code": "^TWII",
        "name": "加權指數",
        "full_name": "發行量加權股價指數",
        "market": "指數",
        "type": "指數",
    },
}

INDEX_CODES = frozenset(INDEX_ENTRIES.keys())

SEARCHABLE_TYPES = frozenset(
    {
        "股票",
        "ETF",
        "創新板",
        # "特別股",
        # "ETN",
        # "臺灣存託憑證(TDR)",
    }
)

_STOCK_INDEX: list[dict[str, str]] = []


def _build_stock_index() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for code, info in INDEX_ENTRIES.items():
        entries.append(
            {
                "code": code,
                "name": info["name"],
                "market": info["market"],
                "type": info["type"],
            }
        )
    for code, info in twstock.codes.items():
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
    return code in INDEX_CODES


def get_index_entry(code: str) -> dict[str, str] | None:
    return INDEX_ENTRIES.get(code)


def is_valid_code(code: str) -> bool:
    if is_index_code(code):
        return True
    info = twstock.codes.get(code)
    return info is not None and info.type in SEARCHABLE_TYPES

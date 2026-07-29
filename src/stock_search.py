import twstock

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


def _result_sort_key(entry: dict[str, str]) -> tuple[int, int, str]:
    market = entry["market"]
    sec_type = entry["type"]

    if market.startswith("上市"):
        market_rank = 0
    elif market == "上櫃":
        market_rank = 1
    else:
        market_rank = 2

    if sec_type in {"股票", "創新板"}:
        type_rank = 0
    elif sec_type == "ETF":
        type_rank = 1
    else:
        type_rank = 2

    return market_rank, type_rank, entry["code"]


def _match_rank(query: str, entry: dict[str, str]) -> tuple[int, int, int, str] | None:
    name = entry["name"]
    code = entry["code"]
    is_numeric = query.isdigit()

    match_ranks: list[int] = []

    if name == query or code == query:
        match_ranks.append(0)
    if name.startswith(query) or code.startswith(query):
        match_ranks.append(1)
    if query in name:
        match_ranks.append(1 if is_numeric else 2)
    if query in code and not code.startswith(query):
        if is_numeric:
            if query not in name:
                match_ranks.append(2)
        else:
            match_ranks.append(2)

    if not match_ranks:
        return None

    market_rank, type_rank, code_key = _result_sort_key(entry)
    return min(match_ranks), market_rank, type_rank, code_key


def _sort_search_results(results: list[dict[str, str]], query: str) -> list[dict[str, str]]:
    ranked = []
    for entry in results:
        rank = _match_rank(query, entry)
        if rank is not None:
            ranked.append((rank, entry))
    return [entry for _, entry in sorted(ranked, key=lambda item: item[0])]


def _build_stock_index() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
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


def _stock_index() -> list[dict[str, str]]:
    global _STOCK_INDEX
    if not _STOCK_INDEX:
        _STOCK_INDEX = _build_stock_index()
    return _STOCK_INDEX


def _is_searchable_code(code: str) -> bool:
    info = twstock.codes.get(code)
    return info is not None and info.type in SEARCHABLE_TYPES


def search_stocks(query: str, limit: int = 10) -> list[dict[str, str]]:
    query = query.strip()
    if not query:
        return []

    if _is_searchable_code(query):
        info = twstock.codes[query]
        return [{"code": query, "name": info.name, "market": info.market}]

    matches: list[dict[str, str]] = []
    for entry in _stock_index():
        if _match_rank(query, entry) is not None:
            matches.append(entry)

    return _sort_search_results(matches, query)[:limit]


def resolve_stock_code(query: str) -> tuple[str | None, str | None]:
    query = query.strip()
    if not query:
        return None, "請輸入股票代號或公司名稱"

    if _is_searchable_code(query):
        return query, None

    matches = search_stocks(query, limit=20)
    if not matches:
        return None, f"找不到符合「{query}」的股票"

    for match in matches:
        if match["name"] == query:
            return match["code"], None

    if len(matches) == 1:
        return matches[0]["code"], None

    exact_code = [match for match in matches if match["code"] == query]
    if len(exact_code) == 1:
        return exact_code[0]["code"], None

    options = "、".join(f"{match['code']} {match['name']}" for match in matches[:5])
    suffix = "…" if len(matches) > 5 else ""
    return None, f"找到多筆符合結果，請輸入更精確的名稱或代號：{options}{suffix}"

from dataclasses import dataclass

@dataclass
class IndexEntry:
    code: str
    name: str
    full_name: str
    market = "指數"
    type = "指數"

INDEX_ENTRIES: dict[str, IndexEntry] = {
    "TAIEX": IndexEntry(
        code="^TWII",
        name="加權指數",
        full_name="發行量加權股價指數"
    ),
    "FRMSA": IndexEntry(
        code="FRMSA.TW",
        name="寶島指數",
        full_name="寶島股價指數"
    ),
    "IX0142": IndexEntry(
        code="IX0142.TWO",
        name="臺灣全市場指數",
        full_name="臺灣全市場指數"
    ),
}

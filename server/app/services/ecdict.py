"""本地离线词库 ECDICT（MIT，skywind3000/ECDICT）。

为什么不把 ECDICT 塞进主库：主库是"我的笔记"，只有几 MB，随时要能拷走；
离线词库是"公共字典"，几十 MB，可以随时重下/删除。两者分文件，互不拖累。

数据字段（csv）：word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import re

from ..config import ECDICT_DB as _ECDICT_PATH

ECDICT_DB = Path(_ECDICT_PATH)

FORM_LABELS = {
    "p": "过去式",
    "d": "过去分词",
    "i": "现在分词",
    "3": "第三人称单数",
    "r": "比较级",
    "t": "最高级",
    "s": "复数",
    "0": "原形",
    "1": "原形变换",
}

TAG_LABELS = {
    "zk": "中考",
    "gk": "高考",
    "cet4": "四级",
    "cet6": "六级",
    "ky": "考研",
    "toefl": "托福",
    "ielts": "雅思",
    "gre": "GRE",
}

POS_RE = re.compile(r"^((?:[a-z]{1,4}\.)(?:\s*&\s*[a-z]{1,4}\.)*)\s*")

_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection | None:
    global _conn
    if _conn is None:
        if not ECDICT_DB.exists():
            return None
        conn = sqlite3.connect(ECDICT_DB, timeout=5, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _conn = conn
    return _conn


def available() -> dict:
    if not ECDICT_DB.exists():
        return {"available": False, "count": 0, "bytes": 0, "updated_at": 0}
    conn = _db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM dict").fetchone()[0]
    except sqlite3.Error:
        count = 0
    return {
        "available": count > 0,
        "count": count,
        "bytes": ECDICT_DB.stat().st_size,
        "updated_at": int(ECDICT_DB.stat().st_mtime),
    }


def _split_pos(text: str) -> tuple[str, str]:
    m = POS_RE.match(text.strip())
    if not m:
        return "", text.strip()
    return m.group(1).strip(), text[m.end():].strip("　 :：;；")


def _parse_forms(exchange: str) -> dict[str, str]:
    forms: dict[str, str] = {}
    for part in (exchange or "").split("/"):
        if ":" not in part:
            continue
        code, value = part.split(":", 1)
        code = code.strip()
        value = value.strip()
        if not value:
            continue
        if code == "0":
            continue  # 原形不放进"词形变化"表
        forms[FORM_LABELS.get(code, code)] = value
    return forms


def _parse_translation(translation: str) -> list[dict]:
    senses: list[dict] = []
    for line in (translation or "").replace("\\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        pos, definition = _split_pos(line)
        if senses and senses[-1]["pos"] == pos:
            senses[-1]["defs"].append(definition)
        else:
            senses.append({"pos": pos, "defs": [definition]})
    return senses


def _parse_definition(definition: str) -> list[dict]:
    items: list[dict] = []
    for line in (definition or "").replace("\\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        items.append({"pos": "", "def": line, "examples": [], "synonyms": []})
    return items


def lookup_local(word: str) -> dict | None:
    """离线查词：返回与有道归一化后同构的 payload（没有例句，来源标 ecdict）。"""
    key = (word or "").strip().lower()
    if not key:
        return None
    conn = _db()
    if conn is None:
        return None
    try:
        row = conn.execute("SELECT * FROM dict WHERE word=?", (key,)).fetchone()
        if not row:
            # 变形词（lingered）兜底：查 exchange 里带这个词的原形索引
            row = conn.execute(
                "SELECT * FROM dict WHERE exchange LIKE ? LIMIT 1", (f"%{key}%",)
            ).fetchone()
        if not row:
            return None
    except sqlite3.Error:
        return None

    forms = _parse_forms(row["exchange"])
    base = row["word"]
    for part in (row["exchange"] or "").split("/"):
        if part.startswith("0:"):
            base = part[2:].strip() or base

    tags = [TAG_LABELS.get(t, t) for t in (row["tag"] or "").split() if t]
    return {
        "headword": row["word"],
        "base_form": base,
        "phonetic_uk": row["phonetic"] or "",
        "phonetic_us": "",
        "senses": _parse_translation(row["translation"]),
        "defs_en": _parse_definition(row["definition"]),
        "forms": forms,
        "examples": [],
        "exam_sents": [],
        "synonyms": [],
        "phrases": [],
        "word_family": [],
        "etymology": [],
        "web_meanings": [],
        "ai_note": "",
        "level": "、".join(tags),
        "source": "ecdict",
        "fetched_at": int(time.time()),
        "ecdict": {
            "collins": row["collins"] or 0,
            "oxford": row["oxford"] or 0,
            "bnc": row["bnc"] or 0,
            "frq": row["frq"] or 0,
        },
    }

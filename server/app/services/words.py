"""单词读写：把词典查询结果落库，并维护例句。

词条快照（dict_json）一旦落库就永久保留：断网时句子、音标、释义、词形、例句全都还在。
当时没查到（或上游抽风）的词会被标记 lookup_state='pending'，后台联网后自动补齐。
"""

from __future__ import annotations

import json
import time
from typing import Any

from ..db import execute, query, query_one
from .dictlookup import is_useful, lookup_word, short_meaning
from .srs import introduce


def _now() -> int:
    return int(time.time())


def word_dict(row: Any) -> dict:
    """words 行 → API 结构（含词典快照）。"""
    d = dict(row)
    try:
        d["forms"] = json.loads(d.get("forms") or "{}")
    except json.JSONDecodeError:
        d["forms"] = {}
    raw = d.pop("dict_json", None)
    d["dict"] = json.loads(raw) if raw else None
    return d


def word_summary(row: Any) -> dict:
    d = dict(row)
    dict_raw = d.pop("dict_json", None)
    try:
        d["forms"] = json.loads(d.get("forms") or "{}")
    except json.JSONDecodeError:
        d["forms"] = {}
    if not d.get("phonetic_us") and dict_raw:
        try:
            d["phonetic_us"] = json.loads(dict_raw).get("phonetic_us") or ""
        except json.JSONDecodeError:
            pass
    return d


def _payload_fields(payload: dict) -> dict:
    """从归一化词条里抽出要落库的列。"""
    meaning_zh = short_meaning(payload, 200)
    meaning_en = ""
    for d in payload.get("defs_en") or []:
        if d.get("def"):
            meaning_en = d["def"]
            break
    pos = ""
    for s in payload.get("senses") or []:
        if s.get("pos"):
            pos = s["pos"]
            break
    return {
        "base_form": payload.get("base_form") or payload.get("headword") or "",
        "phonetic_uk": payload.get("phonetic_uk") or "",
        "phonetic_us": payload.get("phonetic_us") or "",
        "pos": pos,
        "meaning_zh": meaning_zh,
        "meaning_en": meaning_en,
        "forms": json.dumps(payload.get("forms") or {}, ensure_ascii=False),
        "dict_json": json.dumps(payload, ensure_ascii=False),
        "source": payload.get("source") or "lookup",
        "state": "ok" if is_useful(payload) else "pending",
    }


def _apply_payload(word_id: int, payload: dict, now: int) -> None:
    f = _payload_fields(payload)
    execute(
        "UPDATE words SET base_form=?, phonetic_uk=?, phonetic_us=?, pos=?, meaning_zh=?, "
        "meaning_en=?, forms=?, dict_json=?, source=?, lookup_state=?, updated_at=? WHERE id=?",
        (
            f["base_form"], f["phonetic_uk"], f["phonetic_us"], f["pos"], f["meaning_zh"],
            f["meaning_en"], f["forms"], f["dict_json"], f["source"], f["state"], now, word_id,
        ),
    )
    _sync_examples(word_id, payload)


async def upsert_word(headword: str, *, source: str = "lookup", force: bool = False) -> dict:
    """查词并写库（已存在则刷新词典快照，保留复习进度与手写备注）。"""
    headword = (headword or "").strip()
    if not headword:
        raise ValueError("单词为空")
    payload = await lookup_word(headword, force=force)
    head = (payload.get("headword") or headword).strip().lower()
    existing = query_one("SELECT * FROM words WHERE headword=?", (head,))
    now = _now()

    if existing:
        word_id = existing["id"]
        _apply_payload(word_id, payload, now)
    else:
        f = _payload_fields(payload)
        word_id = execute(
            "INSERT INTO words(headword, base_form, phonetic_uk, phonetic_us, pos, meaning_zh, "
            "meaning_en, forms, dict_json, lookup_state, source, created_at, updated_at, due_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                head, f["base_form"], f["phonetic_uk"], f["phonetic_us"], f["pos"],
                f["meaning_zh"], f["meaning_en"], f["forms"], f["dict_json"], f["state"],
                f["source"], now, now, introduce(),
            ),
        )
        _sync_examples(word_id, payload)
    return word_dict(query_one("SELECT * FROM words WHERE id=?", (word_id,)))


def _sync_examples(word_id: int, payload: dict) -> None:
    """只补词典例句；用户自己摘抄的出处句（source='sentence'）不重复插。"""
    exists = query("SELECT en FROM examples WHERE word_id=?", (word_id,))
    exists_set = {r["en"].strip().lower() for r in exists}
    seq = len(exists)
    for ex in list(payload.get("exam_sents") or []) + list(payload.get("examples") or []):
        en = (ex.get("en") or "").strip()
        if not en:
            continue
        key = en.lower()
        if key in exists_set or len(en) > 400:
            continue
        execute(
            "INSERT INTO examples(word_id, en, zh, source, seq) VALUES(?,?,?,?,?)",
            (word_id, en, ex.get("zh") or "", ex.get("source") or "词典", seq),
        )
        exists_set.add(key)
        seq += 1


def attach_sentence_example(
    word_id: int, sentence_id: int, sentence_text: str, translation: str | None
) -> None:
    row = query_one(
        "SELECT id FROM examples WHERE word_id=? AND sentence_id=?", (word_id, sentence_id)
    )
    if row:
        if translation:
            execute(
                "UPDATE examples SET zh=? WHERE id=? AND (zh IS NULL OR zh='')", (translation, row["id"])
            )
        return
    execute(
        "INSERT INTO examples(word_id, en, zh, source, sentence_id, seq) VALUES(?,?,?,?,?,?)",
        (word_id, sentence_text, translation or "", "sentence", sentence_id, -1),
    )


def pending_count() -> int:
    try:
        return query_one("SELECT COUNT(*) AS n FROM words WHERE lookup_state='pending'")["n"]
    except Exception:  # noqa: BLE001  老库还没迁移完
        return 0


def pending_words(limit: int = 20) -> list[dict]:
    rows = query(
        "SELECT id, headword, source FROM words WHERE lookup_state='pending' "
        "ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    )
    return [dict(r) for r in rows]


async def retry_pending(limit: int = 8) -> dict:
    """把当时没查到释义的词重新查一遍（联网时由后台定时任务调用）。"""
    rows = query(
        "SELECT id, headword FROM words WHERE lookup_state='pending' "
        "ORDER BY updated_at LIMIT ?",
        (limit,),
    )
    fixed = 0
    for row in rows:
        try:
            payload = await lookup_word(row["headword"], force=True)
        except Exception:  # noqa: BLE001  网络抖动不打断整批
            continue
        if is_useful(payload):
            _apply_payload(row["id"], payload, _now())
            fixed += 1
    return {"checked": len(rows), "fixed": fixed, "remaining": pending_count()}


def touch_review(item_type: str, item_id: int, quality: int) -> dict:
    table = "words" if item_type == "word" else "sentences"
    row = query_one(f"SELECT reps, interval_days, ease FROM {table} WHERE id=?", (item_id,))
    if not row:
        raise ValueError("条目不存在")
    from .srs import schedule

    new = schedule(quality, row["reps"], row["interval_days"], row["ease"])
    execute(
        f"UPDATE {table} SET reps=?, interval_days=?, ease=?, due_at=?, "
        f"lapses=lapses + {'1' if quality < 3 else '0'} WHERE id=?",
        (new["reps"], new["interval_days"], new["ease"], new["due_at"], item_id),
    )
    execute(
        "INSERT INTO review_logs(item_type, item_id, quality, reviewed_at) VALUES(?,?,?,?)",
        (item_type, item_id, quality, _now()),
    )
    return dict(query_one(f"SELECT * FROM {table} WHERE id=?", (item_id,)))

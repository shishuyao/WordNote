"""单词路由：词表（A-Z / 随机 / 搜索）、词详情、手动增删、刷新词条。"""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from ..db import execute, query, query_one
from ..security import current_user
from ..services.dictlookup import lookup_word
from ..services.tts import schedule_prewarm
from ..services.words import touch_review, upsert_word, word_dict, word_summary

router = APIRouter(prefix="/api/words", tags=["words"])


class WordIn(BaseModel):
    headword: str = Field(min_length=1, max_length=80)
    note: str | None = None


class WordPatch(BaseModel):
    meaning_zh: str | None = None
    note: str | None = None
    phonetic_uk: str | None = None
    phonetic_us: str | None = None


class GradeIn(BaseModel):
    quality: int = Field(ge=0, le=5)


@router.get("")
def list_words(
    mode: Literal["az", "random", "recent", "due"] = "recent",
    letter: str | None = None,
    q: str | None = None,
    limit: int = Query(80, ge=1, le=400),
    offset: int = Query(0, ge=0),
    user: dict = Depends(current_user),
) -> dict:
    where, params = [], []
    if q:
        where.append("(headword LIKE ? OR meaning_zh LIKE ?)")
        like = f"%{q}%"
        params += [like, like]
    if letter and mode == "az":
        if letter == "#":
            where.append("substr(headword,1,1) NOT GLOB '[a-zA-Z]'")
        else:
            where.append("headword LIKE ?")
            params.append(f"{letter.lower()}%")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    order = {
        "az": "headword ASC",
        "random": "RANDOM()",
        "recent": "created_at DESC",
        "due": "COALESCE(due_at, 0) ASC",
    }[mode]
    total = query_one(f"SELECT COUNT(*) AS n FROM words {clause}", params)["n"]
    rows = query(f"SELECT * FROM words {clause} ORDER BY {order} LIMIT ? OFFSET ?", [*params, limit, offset])
    letters = query(
        "SELECT substr(lower(headword),1,1) AS ch, COUNT(*) AS n FROM words GROUP BY ch ORDER BY ch"
    )
    return {
        "total": total,
        "items": [word_summary(r) for r in rows],
        "letters": {r["ch"]: r["n"] for r in letters},
    }


@router.post("")
async def create_word(payload: WordIn, user: dict = Depends(current_user)) -> dict:
    try:
        word = await upsert_word(payload.headword.strip(), source="manual")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if payload.note:
        execute("UPDATE words SET note=? WHERE id=?", (payload.note.strip(), word["id"]))
    schedule_prewarm([word["headword"]])
    return {"item": word_dict(query_one("SELECT * FROM words WHERE id=?", (word["id"],)))}


@router.get("/{wid}")
def get_word(wid: int, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT * FROM words WHERE id=?", (wid,))
    if not row:
        raise HTTPException(status_code=404, detail="单词不存在")
    item = word_dict(row)
    examples = query(
        "SELECT id, en, zh, source, sentence_id FROM examples WHERE word_id=? "
        "ORDER BY (source='sentence') DESC, seq ASC LIMIT 40",
        (wid,),
    )
    item["examples"] = [dict(e) for e in examples]
    sources = query(
        "SELECT s.id, s.text, s.translation, s.created_at, a.surface, a.char_start, a.char_end "
        "FROM annotations a JOIN sentences s ON s.id = a.sentence_id "
        "WHERE a.word_id=? ORDER BY s.created_at DESC LIMIT 20",
        (wid,),
    )
    item["sentences"] = [dict(s) for s in sources]
    return {"item": item}


@router.patch("/{wid}")
def patch_word(wid: int, payload: WordPatch, user: dict = Depends(current_user)) -> dict:
    if not query_one("SELECT id FROM words WHERE id=?", (wid,)):
        raise HTTPException(status_code=404, detail="单词不存在")
    fields, params = [], []
    for name in ("meaning_zh", "note", "phonetic_uk", "phonetic_us"):
        value = getattr(payload, name)
        if value is not None:
            fields.append(f"{name}=?")
            params.append(value.strip())
    if fields:
        fields.append("updated_at=?")
        params += [int(time.time()), wid]
        execute(f"UPDATE words SET {', '.join(fields)} WHERE id=?", params)
    return {"item": word_dict(query_one("SELECT * FROM words WHERE id=?", (wid,)))}


@router.delete("/{wid}")
def delete_word(wid: int, user: dict = Depends(current_user)) -> dict:
    if not query_one("SELECT id FROM words WHERE id=?", (wid,)):
        raise HTTPException(status_code=404, detail="单词不存在")
    execute("DELETE FROM words WHERE id=?", (wid,))
    return {"ok": True}


@router.post("/{wid}/refresh")
async def refresh_word(wid: int, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT headword FROM words WHERE id=?", (wid,))
    if not row:
        raise HTTPException(status_code=404, detail="单词不存在")
    word = await upsert_word(row["headword"], source="refresh", force=True)
    return {"item": word}


@router.post("/{wid}/grade")
def grade(wid: int, payload: GradeIn, user: dict = Depends(current_user)) -> dict:
    if not query_one("SELECT id FROM words WHERE id=?", (wid,)):
        raise HTTPException(status_code=404, detail="单词不存在")
    touch_review("word", wid, payload.quality)
    return {"item": word_dict(query_one("SELECT * FROM words WHERE id=?", (wid,)))}


@router.get("/lookup/any")
async def lookup_any(word: str = Query(min_length=1, max_length=80), user: dict = Depends(current_user)) -> dict:
    """只查询、不落库：录入页边打边查用。"""
    return {"item": await lookup_word(word)}

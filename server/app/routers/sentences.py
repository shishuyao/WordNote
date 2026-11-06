"""句子路由：摘抄、划线标注、翻译、复习字段。"""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from ..db import execute, query, query_one
from ..security import current_user
from ..services.translate import TranslateError, translate
from ..services.tts import schedule_prewarm
from ..services.words import attach_sentence_example, touch_review, upsert_word

router = APIRouter(prefix="/api/sentences", tags=["sentences"])


class AnnotationIn(BaseModel):
    surface: str
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    note: str | None = None


class SentenceIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    translation: str | None = None
    source: str | None = None
    note: str | None = None
    tags: list[str] = Field(default_factory=list)
    annotations: list[AnnotationIn] = Field(default_factory=list)
    auto_translate: bool = True
    auto_lookup: bool = True


class SentencePatch(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    translation: str | None = None
    source: str | None = None
    note: str | None = None
    tags: list[str] | None = None


class GradeIn(BaseModel):
    quality: int = Field(ge=0, le=5)


def _now() -> int:
    return int(time.time())


def sentence_dict(row, *, with_annotations: bool = True) -> dict:
    d = dict(row)
    try:
        d["tags"] = json.loads(d.get("tags") or "[]")
    except json.JSONDecodeError:
        d["tags"] = []
    d["word_count"] = len((d.get("text") or "").split())
    if with_annotations:
        anns = query(
            "SELECT a.id, a.surface, a.char_start, a.char_end, a.note AS ann_note, "
            "w.id AS word_id, w.headword, w.phonetic_us, w.phonetic_uk, w.pos, w.meaning_zh, "
            "w.reps AS word_reps "
            "FROM annotations a LEFT JOIN words w ON w.id = a.word_id "
            "WHERE a.sentence_id=? ORDER BY a.char_start",
            (d["id"],),
        )
        d["annotations"] = [dict(a) for a in anns]
    return d


@router.get("")
def list_sentences(
    q: str | None = None,
    tag: str | None = None,
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
    order: str = Query("recent", pattern="^(recent|oldest|due|random)$"),
    user: dict = Depends(current_user),
) -> dict:
    where, params = [], []
    if q:
        where.append("(text LIKE ? OR translation LIKE ? OR note LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like]
    if tag:
        where.append("tags LIKE ?")
        params.append(f'%"{tag}"%')
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    order_sql = {
        "recent": "created_at DESC",
        "oldest": "created_at ASC",
        "due": "COALESCE(due_at, 0) ASC",
        "random": "RANDOM()",
    }[order]
    total = query_one(f"SELECT COUNT(*) AS n FROM sentences {clause}", params)["n"]
    rows = query(
        f"SELECT * FROM sentences {clause} ORDER BY {order_sql} LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )
    return {"total": total, "items": [sentence_dict(r) for r in rows]}


@router.get("/tags/all")
def list_tags(user: dict = Depends(current_user)) -> dict:
    """所有句子用过的标签 + 次数，供"常用标签"建议与筛选。"""
    counter: dict[str, int] = {}
    for row in query("SELECT tags FROM sentences"):
        try:
            tags = json.loads(row["tags"] or "[]")
        except (ValueError, TypeError):
            tags = []
        if not isinstance(tags, list):
            continue
        for tag in tags:
            if isinstance(tag, str) and tag.strip():
                key = tag.strip()
                counter[key] = counter.get(key, 0) + 1
    items = [{"tag": k, "count": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0]))]
    return {"items": items}


@router.post("")
async def create_sentence(payload: SentenceIn, user: dict = Depends(current_user)) -> dict:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="句子为空")
    now = _now()
    existing = query_one("SELECT * FROM sentences WHERE text=?", (text,))
    warnings: list[str] = []

    translation = (payload.translation or "").strip()
    if existing:
        sid = existing["id"]
        if payload.translation or payload.source or payload.note or payload.tags:
            execute(
                "UPDATE sentences SET translation=COALESCE(NULLIF(?,''), translation), "
                "source=COALESCE(NULLIF(?,''), source), note=COALESCE(NULLIF(?,''), note), "
                "tags=?, updated_at=? WHERE id=?",
                (
                    translation,
                    (payload.source or "").strip(),
                    (payload.note or "").strip(),
                    json.dumps(payload.tags, ensure_ascii=False),
                    now,
                    sid,
                ),
            )
        warnings.append("这句已经摘抄过了，已复用原有记录")
    else:
        sid = execute(
            "INSERT INTO sentences(text, translation, source, note, tags, created_at, updated_at, due_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                text,
                translation,
                (payload.source or "").strip(),
                (payload.note or "").strip(),
                json.dumps(payload.tags, ensure_ascii=False),
                now,
                now,
                now,
            ),
        )

    if payload.auto_translate and not translation:
        try:
            got = await translate(text)
            translation = got["translation"]
            execute("UPDATE sentences SET translation=? WHERE id=?", (translation, sid))
        except TranslateError as exc:
            warnings.append(f"自动翻译失败（{exc}），可手动填写释义")

    if payload.auto_lookup:
        for ann in payload.annotations[:16]:
            try:
                await _add_annotation(sid, ann, text)
            except (ValueError, HTTPException):
                continue

    sentence = sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,)))
    # 后台预合成整句 + 每个划线词，离线点开即响
    schedule_prewarm([sentence["text"], *[a["surface"] for a in sentence.get("annotations", [])]])
    return {"item": sentence, "warnings": warnings, "duplicate": bool(existing)}


async def _add_annotation(sid: int, ann: AnnotationIn, sentence_text: str) -> dict:
    start, end = ann.char_start, ann.char_end
    if not (0 <= start < end <= len(sentence_text)):
        raise ValueError("标注位置越界")
    surface = sentence_text[start:end]
    if not surface.strip():
        raise ValueError("标注内容为空")
    word = await upsert_word(surface, source="sentence")
    ann_id = execute(
        "INSERT INTO annotations(sentence_id, word_id, surface, char_start, char_end, note, created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (sid, word["id"], surface, start, end, ann.note, _now()),
    )
    attach_sentence_example(word["id"], sid, sentence_text, None)
    return {"id": ann_id, "word": word}


@router.get("/{sid}")
def get_sentence(sid: int, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT * FROM sentences WHERE id=?", (sid,))
    if not row:
        raise HTTPException(status_code=404, detail="句子不存在")
    return {"item": sentence_dict(row)}


@router.patch("/{sid}")
def patch_sentence(sid: int, payload: SentencePatch, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT * FROM sentences WHERE id=?", (sid,))
    if not row:
        raise HTTPException(status_code=404, detail="句子不存在")
    fields, params = [], []
    if payload.text is not None:
        fields.append("text=?")
        params.append(payload.text.strip())
    if payload.translation is not None:
        fields.append("translation=?")
        params.append(payload.translation.strip())
    if payload.source is not None:
        fields.append("source=?")
        params.append(payload.source.strip())
    if payload.note is not None:
        fields.append("note=?")
        params.append(payload.note.strip())
    if payload.tags is not None:
        fields.append("tags=?")
        params.append(json.dumps(payload.tags, ensure_ascii=False))
    if fields:
        fields.append("updated_at=?")
        params += [_now(), sid]
        execute(f"UPDATE sentences SET {', '.join(fields)} WHERE id=?", params)
    return {"item": sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,)))}


@router.delete("/{sid}")
def delete_sentence(sid: int, user: dict = Depends(current_user)) -> dict:
    if not query_one("SELECT id FROM sentences WHERE id=?", (sid,)):
        raise HTTPException(status_code=404, detail="句子不存在")
    execute("DELETE FROM examples WHERE sentence_id=?", (sid,))
    execute("DELETE FROM sentences WHERE id=?", (sid,))
    return {"ok": True}


@router.post("/{sid}/annotations")
async def add_annotation(sid: int, payload: AnnotationIn, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT text FROM sentences WHERE id=?", (sid,))
    if not row:
        raise HTTPException(status_code=404, detail="句子不存在")
    try:
        ann = await _add_annotation(sid, payload, row["text"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    schedule_prewarm([payload.surface])
    return {"annotation": ann, "item": sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,)))}


@router.delete("/{sid}/annotations/{aid}")
def delete_annotation(sid: int, aid: int, user: dict = Depends(current_user)) -> dict:
    execute("DELETE FROM annotations WHERE id=? AND sentence_id=?", (aid, sid))
    return {"item": sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,)))}


@router.post("/{sid}/translate")
async def retranslate(sid: int, force: bool = True, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT * FROM sentences WHERE id=?", (sid,))
    if not row:
        raise HTTPException(status_code=404, detail="句子不存在")
    try:
        got = await translate(row["text"], force=force)
    except TranslateError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    execute("UPDATE sentences SET translation=?, updated_at=? WHERE id=?", (got["translation"], _now(), sid))
    return {"item": sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,))), "provider": got["provider"]}


@router.post("/{sid}/grade")
def grade(sid: int, payload: GradeIn, user: dict = Depends(current_user)) -> dict:
    if not query_one("SELECT id FROM sentences WHERE id=?", (sid,)):
        raise HTTPException(status_code=404, detail="句子不存在")
    touch_review("sentence", sid, payload.quality)
    return {"item": sentence_dict(query_one("SELECT * FROM sentences WHERE id=?", (sid,)))}

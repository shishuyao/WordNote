"""复习：到期队列、评分、统计。"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from ..db import query, query_one
from ..security import current_user
from ..services.words import touch_review, word_dict, word_summary

router = APIRouter(prefix="/api", tags=["review"])


class GradeIn(BaseModel):
    kind: str = Field(pattern="^(word|sentence)$")
    id: int
    quality: int = Field(ge=0, le=5)


@router.get("/review/queue")
def queue(
    kind: str = Query("all", pattern="^(all|word|sentence)$"),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(current_user),
) -> dict:
    now = int(time.time())
    items: list[dict] = []
    word_due = query_one(
        "SELECT COUNT(*) AS n FROM words WHERE due_at IS NULL OR due_at<=?", (now,)
    )["n"]
    sent_due = query_one(
        "SELECT COUNT(*) AS n FROM sentences WHERE due_at IS NULL OR due_at<=?", (now,)
    )["n"]

    if kind in ("all", "word"):
        rows = query(
            "SELECT * FROM words WHERE due_at IS NULL OR due_at<=? ORDER BY RANDOM() LIMIT ?",
            (now, limit),
        )
        for row in rows:
            item = word_summary(row)
            item["kind"] = "word"
            item.pop("dict_json", None)
            ex = query_one(
                "SELECT en, zh FROM examples WHERE word_id=? ORDER BY (source='sentence') DESC, seq ASC LIMIT 1",
                (row["id"],),
            )
            item["example"] = dict(ex) if ex else None
            items.append(item)

    if kind in ("all", "sentence"):
        rows = query(
            "SELECT * FROM sentences WHERE due_at IS NULL OR due_at<=? ORDER BY RANDOM() LIMIT ?",
            (now, limit),
        )
        import json

        for row in rows:
            d = dict(row)
            try:
                d["tags"] = json.loads(d.get("tags") or "[]")
            except ValueError:
                d["tags"] = []
            d["kind"] = "sentence"
            items.append(d)

    return {
        "items": items,
        "due": {"words": word_due, "sentences": sent_due, "total": word_due + sent_due},
    }


@router.post("/review/grade")
def grade(payload: GradeIn, user: dict = Depends(current_user)) -> dict:
    try:
        row = touch_review(payload.kind, payload.id, payload.quality)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True, "due_at": row.get("due_at"), "interval_days": row.get("interval_days")}


def _streak() -> int:
    """连续复习天数：从今天（或昨天）往前数连续有记录的天数。"""
    rows = query(
        "SELECT DISTINCT date(reviewed_at, 'unixepoch', 'localtime') AS d "
        "FROM review_logs ORDER BY d DESC"
    )
    days: set[date] = set()
    for r in rows:
        if not r["d"]:
            continue
        try:
            days.add(datetime.strptime(r["d"], "%Y-%m-%d").date())
        except ValueError:
            continue
    if not days:
        return 0
    today = datetime.now().date()
    cursor = today if today in days else today - timedelta(days=1)
    if cursor not in days:
        return 0
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@router.get("/stats")
def stats(user: dict = Depends(current_user)) -> dict:
    now = int(time.time())
    today_start = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    week_ago = today_start - 6 * 86400

    total_words = query_one("SELECT COUNT(*) AS n FROM words")["n"]
    total_sentences = query_one("SELECT COUNT(*) AS n FROM sentences")["n"]
    total_anns = query_one("SELECT COUNT(*) AS n FROM annotations WHERE word_id IS NOT NULL")["n"]
    due_words = query_one("SELECT COUNT(*) AS n FROM words WHERE due_at IS NULL OR due_at<=?", (now,))["n"]
    due_sentences = query_one("SELECT COUNT(*) AS n FROM sentences WHERE due_at IS NULL OR due_at<=?", (now,))["n"]
    today_reviews = query_one("SELECT COUNT(*) AS n FROM review_logs WHERE reviewed_at>=?", (today_start,))["n"]
    week_reviews = query_one("SELECT COUNT(*) AS n FROM review_logs WHERE reviewed_at>=?", (week_ago,))["n"]
    total_reviews = query_one("SELECT COUNT(*) AS n FROM review_logs")["n"]

    daily = query(
        "SELECT date(reviewed_at, 'unixepoch', 'localtime') AS day, COUNT(*) AS n "
        "FROM review_logs WHERE reviewed_at>=? GROUP BY day ORDER BY day",
        (week_ago,),
    )
    daily_map = {r["day"]: r["n"] for r in daily}
    series = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        series.append({"day": day, "count": daily_map.get(day, 0)})

    recent = query(
        "SELECT s.id, s.text, s.translation, s.created_at, COUNT(a.id) AS anns "
        "FROM sentences s LEFT JOIN annotations a ON a.sentence_id=s.id "
        "GROUP BY s.id ORDER BY s.created_at DESC LIMIT 6"
    )
    return {
        "words": total_words,
        "sentences": total_sentences,
        "annotations": total_anns,
        "due": {"words": due_words, "sentences": due_sentences, "total": due_words + due_sentences},
        "reviews": {"today": today_reviews, "week": week_reviews, "total": total_reviews},
        "streak": _streak(),
        "series": series,
        "recent_sentences": [dict(r) for r in recent],
    }

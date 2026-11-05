"""离线能力：本地词库状态、待补齐词条重试、发音预合成。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..config import OFFLINE
from ..db import query_one
from ..security import current_user
from ..services import ecdict, tts
from ..services.words import pending_count, pending_words, retry_pending

router = APIRouter(prefix="/api/offline", tags=["offline"])


@router.get("/status")
def status(user: dict = Depends(current_user)) -> dict:
    counts = {
        "words": query_one("SELECT COUNT(*) AS n FROM words")["n"],
        "sentences": query_one("SELECT COUNT(*) AS n FROM sentences")["n"],
        "annotations": query_one("SELECT COUNT(*) AS n FROM annotations")["n"],
        "examples": query_one("SELECT COUNT(*) AS n FROM examples")["n"],
    }
    return {
        "offline_mode": OFFLINE,
        "ecdict": ecdict.available(),
        "audio": tts.cache_stats(),
        "pending_words": pending_count(),
        "pending_list": pending_words(10),
        "counts": counts,
    }


@router.post("/retry")
async def retry(limit: int = Query(8, ge=1, le=30), user: dict = Depends(current_user)) -> dict:
    """立刻重试"当时没查到"的词条（正常由后台每 20 分钟自动做）。"""
    return await retry_pending(limit)


@router.post("/prewarm")
def prewarm(
    voice: str | None = Query(default=None),
    user: dict = Depends(current_user),
) -> dict:
    """把全部单词/句子/划线词的发音提前合成到磁盘（离线点开即响）。"""
    texts = tts.prewarm_targets()
    scheduled = tts.schedule_prewarm(texts, voice)
    return {"scheduled": scheduled, "candidates": len(texts), "voice": voice or tts.default_voice()}

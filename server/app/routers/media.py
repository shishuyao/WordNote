"""发音：转发到本机 Supertonic 3 常驻服务，带磁盘缓存。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse

from ..config import DEFAULT_VOICE, VOICES
from ..db import get_setting
from ..security import current_user
from ..services import tts

router = APIRouter(prefix="/api/tts", tags=["tts"])
VOICE_IDS = {v["id"] for v in VOICES}


@router.get("")
async def speak(
    text: str = Query(min_length=1, max_length=400),
    voice: str | None = Query(default=None),
    user: dict = Depends(current_user),
) -> FileResponse:
    voice = (voice or get_setting("voice") or DEFAULT_VOICE or "F5").upper()
    if voice not in VOICE_IDS:
        voice = "F5"
    try:
        result = await tts.synthesize(text, voice)
    except tts.TTSError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-TTS-Engine": result["engine"],
        "X-Audio-Seconds": str(result["seconds"]),
        "X-TTS-Voice": voice,
    }
    return FileResponse(result["path"], media_type="audio/wav", headers=headers)


@router.get("/voices")
def voices(user: dict = Depends(current_user)) -> dict:
    return {
        "items": VOICES,
        "default": get_setting("voice") or DEFAULT_VOICE or "F5",
    }


@router.get("/status")
async def status(user: dict = Depends(current_user)) -> dict:
    return await tts.status()


@router.delete("/cache")
def clear_cache(user: dict = Depends(current_user)) -> dict:
    return {"removed": tts.clear_cache()}

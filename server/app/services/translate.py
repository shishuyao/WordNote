"""句子翻译：MyMemory 免 Key 接口 + 本地缓存。

为啥用它：官方免费、无需注册、直连可达（实测 ~1s）。匿名每天约 5k 字符，
填 MYMEMORY_EMAIL 环境变量可到 ~50k；所有结果进 translate_cache，同一句永不再请求。
"""

from __future__ import annotations

import re
import time

import httpx

from ..config import HTTP_UA, MYMEMORY_CHAR_LIMIT, MYMEMORY_EMAIL, MYMEMORY_URL, OFFLINE
from ..db import cache_translation, cached_translation

BAD_MARKERS = (
    "MYMEMORY WARNING",
    "QUERY LENGTH LIMIT",
    "INVALID LANGUAGE PAIR",
    "NO QUERY SPECIFIED",
    "PLEASE SELECT TWO DISTINCT LANGUAGES",
)
SENT_SPLIT = re.compile(r"(?<=[.!?。！？])\s+")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\u00a0", " ")).strip()


class TranslateError(RuntimeError):
    pass


async def _call_mymemory(client: httpx.AsyncClient, chunk: str) -> str:
    params = {"q": chunk, "langpair": "en|zh-CN"}
    if MYMEMORY_EMAIL:
        params["de"] = MYMEMORY_EMAIL
    r = await client.get(MYMEMORY_URL, params=params)
    if r.status_code != 200:
        raise TranslateError(f"MyMemory HTTP {r.status_code}")
    data = r.json()
    status = str(data.get("responseStatus", ""))
    text = ((data.get("responseData") or {}).get("translatedText") or "").strip()
    if status != "200":
        raise TranslateError((data.get("responseDetails") or f"MyMemory status {status}")[:120])
    upper = text.upper()
    if any(m in upper for m in BAD_MARKERS):
        raise TranslateError("MyMemory 免费额度用尽或被限流")
    if not text:
        raise TranslateError("MyMemory 返回空译文")
    return text


def _chunks(text: str) -> list[str]:
    if len(text) <= MYMEMORY_CHAR_LIMIT:
        return [text]
    parts, buf = [], ""
    for sent in SENT_SPLIT.split(text):
        if len(buf) + len(sent) + 1 <= MYMEMORY_CHAR_LIMIT:
            buf = f"{buf} {sent}".strip()
        else:
            if buf:
                parts.append(buf)
            buf = sent if len(sent) <= MYMEMORY_CHAR_LIMIT else sent[:MYMEMORY_CHAR_LIMIT]
    if buf:
        parts.append(buf)
    return parts or [text[:MYMEMORY_CHAR_LIMIT]]


async def translate(text: str, *, force: bool = False) -> dict:
    src = normalize(text)
    if not src:
        return {"source": "", "translation": "", "provider": "none", "cached": False}

    if not force:
        hit = cached_translation(src)
        if hit:
            return {
                "source": src,
                "translation": hit["dst"],
                "provider": hit["provider"],
                "cached": True,
            }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(12.0, connect=6.0),
        headers={"User-Agent": HTTP_UA},
        follow_redirects=True,
    ) as client:
        pieces: list[str] = []
        last_error = ""
        for attempt in range(2):
            try:
                pieces = [await _call_mymemory(client, c) for c in _chunks(src)]
                break
            except TranslateError as exc:
                last_error = str(exc)
                pieces = []
            except httpx.HTTPError as exc:
                last_error = f"网络错误：{exc.__class__.__name__}"
                pieces = []
            if attempt == 0:
                import asyncio

                await asyncio.sleep(0.8)

    translation = " ".join(p.strip() for p in pieces if p).strip()
    if not translation:
        raise TranslateError(last_error or "翻译失败")

    cache_translation(src, translation, "mymemory")
    return {
        "source": src,
        "translation": translation,
        "provider": "mymemory",
        "cached": False,
        "fetched_at": int(time.time()),
    }

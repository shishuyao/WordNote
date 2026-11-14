"""Supertonic 3 发音：走本机 audiocpp 常驻服务（127.0.0.1:8090），服务挂了回退 CLI。

实测（8845HS，CPU 8 线程）：常驻热态 ~0.8s/句（3.6×实时）；CLI 冷启动 ~4s/句，
所以必须优先服务、CLI 只当兜底。WAV 按 (音色, 文本) 的 sha1 落盘缓存，第二次点击 0 网络请求。
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..config import (
    AUDIOCPP_CLI,
    AUDIOCPP_EXE,
    AUDIO_DIR,
    DATA_DIR,
    TTS_BACKEND,
    TTS_MODEL_ID,
    TTS_MODEL_PATH,
    TTS_THREADS,
    TTS_URL,
)

_sem = asyncio.Semaphore(1)
_start_lock = asyncio.Lock()
_status = {"alive_at": 0.0, "alive": False, "loaded_at": 0.0, "loaded": False}
TS_RE = re.compile(r"[ \t]+")
AUTOSTART = os.environ.get("ST_AUTOSTART", "1") != "0"
IS_WIN = sys.platform == "win32"


class TTSError(RuntimeError):
    pass


def clean_text(text: str) -> str:
    text = (text or "").replace("\ufeff", "").replace("\u200b", "")
    text = TS_RE.sub(" ", text).strip()
    if not text:
        raise TTSError("文本为空")
    if not re.search(r"[.!?,;:。！？，；：]$", text):
        text += "."
    return text[:400]


FFMPEG = os.environ.get("WORDNOTE_FFMPEG", "ffmpeg")
SPEED_MIN, SPEED_MAX = 0.5, 1.5


def normalize_speed(value: float | str | None) -> float:
    try:
        speed = float(value) if value is not None else 1.0
    except (TypeError, ValueError):
        speed = 1.0
    return round(max(SPEED_MIN, min(SPEED_MAX, speed)), 2)


def default_speed() -> float:
    """用户设置的朗读速度（1.0 为原始速度）。"""
    from ..db import get_setting

    return normalize_speed(get_setting("tts_speed") or 1.0)


def cache_path(text: str, voice: str, speed: float = 1.0) -> Path:
    """原始速度用老 key（兼容既有缓存）；非 1.0 的每个速度单独缓存。"""
    speed = normalize_speed(speed)
    if abs(speed - 1.0) < 0.005:
        raw = f"{voice}|en|{text}"
    else:
        raw = f"{voice}|en|s{speed:.2f}|{text}"
    key = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return AUDIO_DIR / f"{key}.wav"


async def _atempo(data: bytes, speed: float) -> bytes:
    """用 ffmpeg atempo 变速（保持音高）。"""
    with tempfile.TemporaryDirectory(prefix="wn-tts-") as tmp:
        src = Path(tmp) / "in.wav"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        proc = await asyncio.create_subprocess_exec(
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-filter:a",
            f"atempo={speed:.2f}",
            "-ar",
            "44100",
            str(dst),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0 or not dst.exists():
            raise TTSError(f"变速失败：{(stderr or b'').decode('utf-8', 'ignore')[-160:]}")
        return dst.read_bytes()


def _env_no_proxy() -> dict:
    env = dict(os.environ)
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        env.pop(k, None)
    env["NO_PROXY"] = "127.0.0.1,localhost"
    return env


async def server_alive(force: bool = False) -> bool:
    now = time.time()
    if not force and now - _status["alive_at"] < 5:
        return bool(_status["alive"])
    ok = False
    try:
        async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
            r = await client.get(f"{TTS_URL}/health")
            ok = r.status_code == 200 and r.json().get("status") == "ok"
    except (httpx.HTTPError, ValueError):
        ok = False
    _status.update(alive_at=now, alive=ok)
    return ok


async def ensure_model(force: bool = False) -> bool:
    now = time.time()
    if not force and now - _status["loaded_at"] < 60 and _status["loaded"]:
        return True
    try:
        async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
            r = await client.get(f"{TTS_URL}/v1/models")
            ids = [m.get("id") for m in (r.json().get("data") or [])]
            if TTS_MODEL_ID not in ids:
                r = await client.post(
                    f"{TTS_URL}/v1/models/load",
                    json={
                        "id": TTS_MODEL_ID,
                        "path": TTS_MODEL_PATH.replace("\\", "/"),
                        "family": "supertonic",
                        "backend": TTS_BACKEND,
                    },
                )
                if r.status_code >= 400:
                    _status.update(loaded_at=now, loaded=False)
                    return False
            _status.update(loaded_at=now, loaded=True)
            return True
    except (httpx.HTTPError, ValueError):
        _status.update(loaded_at=now, loaded=False)
        return False


async def _synth_server(text: str, voice: str) -> bytes:
    payload = {
        "model": TTS_MODEL_ID,
        "input": text,
        "voice": voice,
        "language": "en",
        "response_format": "wav",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0), trust_env=False) as client:
        r = await client.post(f"{TTS_URL}/v1/audio/speech", json=payload)
        if r.status_code >= 400:
            raise TTSError(f"服务端合成失败 HTTP {r.status_code}: {r.text[:120]}")
        data = r.content
    if len(data) < 200:
        raise TTSError("服务端返回音频过短")
    return data


async def _synth_cli(text: str, voice: str) -> bytes:
    cli = Path(AUDIOCPP_CLI)
    if not cli.exists():
        raise TTSError("audiocpp_cli 不存在，无法兜底合成")
    out = AUDIO_DIR / f".tmp_{os.getpid()}_{int(time.time()*1000)}.wav"
    cmd = [
        str(cli), "--task", "tts", "--family", "supertonic", "--model", TTS_MODEL_PATH,
        "--backend", TTS_BACKEND, "--threads", str(TTS_THREADS), "--text", text,
        "--voice-id", voice, "--language", "en", "--out", str(out),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, env=_env_no_proxy(),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    try:
        if out.exists() and out.stat().st_size > 200:
            return out.read_bytes()
        raise TTSError(f"CLI 合成失败：{(stderr or b'').decode('utf-8', 'ignore')[-200:]}")
    finally:
        out.unlink(missing_ok=True)


def wav_seconds(data: bytes) -> float:
    try:
        with wave.open(io.BytesIO(data)) as w:
            return round(w.getnframes() / float(w.getframerate()), 2)
    except (wave.Error, EOFError):
        return 0.0


async def synth(text: str, voice: str = "F5") -> bytes:
    cleaned = clean_text(text)
    return await _synth_server(cleaned, voice)


def _spawn_server() -> bool:
    """拉起 audiocpp 常驻服务（脱离当前进程，窗口隐藏）。已在跑则不动。"""
    exe = Path(AUDIOCPP_EXE)
    if not exe.exists():
        return False
    log_path = DATA_DIR / "logs" / "audiocpp.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    port = urlparse(TTS_URL).port or 8090
    flags = 0
    if IS_WIN:
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    with open(log_path, "ab") as log:
        subprocess.Popen(  # noqa: S603
            [
                str(exe), "--ui", "--backend", TTS_BACKEND, "--host", "127.0.0.1",
                "--port", str(port), "--threads", str(TTS_THREADS), "--ui-management",
            ],
            cwd=str(exe.parent),
            stdout=log,
            stderr=log,
            creationflags=flags,
            close_fds=True,
        )
    return True


async def ensure_server(grace: float = 6.0) -> bool:
    """确保 audiocpp 在线且模型已加载。

    顺序：已在线 → 直接加载模型；离线 → 先给外部 watchdog（projects/supertonic/watchdog.py，
    每 10s 巡检）一点时间；仍未恢复才由本进程兜底拉起（ST_AUTOSTART=0 可关闭）。
    """
    if await server_alive(force=True):
        return await ensure_model()

    deadline = time.time() + max(0.0, grace)
    while time.time() < deadline:
        await asyncio.sleep(0.5)
        if await server_alive(force=True):
            return await ensure_model(force=True)

    if not AUTOSTART:
        return False
    async with _start_lock:
        if await server_alive(force=True):
            return await ensure_model(force=True)
        if not _spawn_server():
            return False
        for _ in range(40):  # 最多等 20s
            await asyncio.sleep(0.5)
            if await server_alive(force=True):
                ok = await ensure_model(force=True)
                if ok:
                    await asyncio.sleep(0.8)  # 让服务热一下，避免首个请求撞空
                return ok
    return False


async def _synth_raw(cleaned: str, voice: str) -> tuple[bytes, str]:
    """原始语速合成（服务优先，崩溃重启重试，最后回退 CLI）。"""
    async with _sem:
        engine = "server"
        data: bytes | None = None
        try:
            if not await ensure_server():
                raise TTSError("audiocpp 服务未运行且自动拉起失败")
            data = await _synth_server(cleaned, voice)
        except (TTSError, httpx.HTTPError) as exc:
            if await ensure_server():
                try:
                    data = await _synth_server(cleaned, voice)
                except (TTSError, httpx.HTTPError):
                    data = None
            if data is None:
                engine = "cli"
                try:
                    data = await _synth_cli(cleaned, voice)
                except TTSError:
                    raise TTSError(f"Supertonic 不可用：{exc}") from exc
        assert data is not None
        return data, engine


async def synthesize(text: str, voice: str = "F5", speed: float | None = None) -> dict:
    """返回 {path, seconds, engine, cached, speed}。

    speed 取 0.5–1.5；1.0 直接用原始音频，其它值用 ffmpeg atempo 变速（保音高）。
    """
    cleaned = clean_text(text)
    speed = normalize_speed(speed if speed is not None else default_speed())
    path = cache_path(cleaned, voice, speed)
    if path.exists() and path.stat().st_size > 200:
        return {
            "path": path,
            "seconds": wav_seconds(path.read_bytes()[:400000]),
            "engine": "cache",
            "cached": True,
            "speed": speed,
        }

    base_path = cache_path(cleaned, voice, 1.0)
    if base_path.exists() and base_path.stat().st_size > 200:
        base, engine = base_path.read_bytes(), "cache"
    else:
        base, engine = await _synth_raw(cleaned, voice)
        base_path.write_bytes(base)

    if abs(speed - 1.0) < 0.005:
        data = base
    else:
        try:
            data = await _atempo(base, speed)
            engine = f"{engine}+atempo"
        except TTSError:
            # 没装 ffmpeg / 变速失败：退回原始语速，不阻断发音
            data = base
            engine = f"{engine}+no-atempo"

    path.write_bytes(data)
    return {
        "path": path,
        "seconds": wav_seconds(data),
        "engine": engine,
        "cached": False,
        "speed": speed,
    }


def cache_stats() -> dict:
    files = list(AUDIO_DIR.glob("*.wav"))
    size = sum(f.stat().st_size for f in files)
    return {"files": len(files), "bytes": size}


def clear_cache() -> int:
    n = 0
    for f in AUDIO_DIR.glob("*.wav"):
        try:
            f.unlink()
            n += 1
        except OSError:
            pass
    return n


async def status() -> dict:
    alive = await server_alive(force=True)
    loaded = await ensure_model() if alive else False
    return {
        "server": TTS_URL,
        "alive": alive,
        "model_loaded": loaded,
        "model_id": TTS_MODEL_ID,
        "speed": default_speed(),
        "autostart": AUTOSTART,
        "cache": cache_stats(),
    }

# ---------------- 预合成（离线也能秒开） ----------------
_prewarm_tasks: set = set()
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop) -> None:
    """由 main.py 在启动时注入事件循环，供线程池里的同步路由调用预合成。"""
    global _loop
    _loop = loop


def default_voice() -> str:
    from ..config import DEFAULT_VOICE
    from ..db import get_setting

    return get_setting("voice") or DEFAULT_VOICE or "F5"


def schedule_prewarm(texts, voice: str | None = None) -> int:
    """后台把文本批量合成到磁盘缓存（不阻塞请求）。返回排入的条数。"""
    seen: list[str] = []
    for t in texts or []:
        t = (t or "").strip()
        if not t or len(t) > 400:
            continue
        if t in seen:
            continue
        seen.append(t)
    seen = seen[:60]
    if not seen:
        return 0
    coro = _prewarm(seen, voice)
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(coro)
        _prewarm_tasks.add(task)
        task.add_done_callback(_prewarm_tasks.discard)
    except RuntimeError:
        if _loop is None or _loop.is_closed():
            return 0
        asyncio.run_coroutine_threadsafe(coro, _loop)
    return len(seen)


async def _prewarm(texts: list[str], voice: str | None) -> None:
    v = (voice or default_voice()).upper()
    sp = default_speed()
    for text in texts:
        try:
            await synthesize(text, v, sp)
        except TTSError:
            continue


def prewarm_targets() -> list[str]:
    """所有单词 + 所有句子 + 划线词，供"一键预合成"用。"""
    from ..db import query

    texts: list[str] = []
    for r in query("SELECT headword FROM words ORDER BY reps DESC LIMIT 400"):
        texts.append(r["headword"])
    for r in query("SELECT text FROM sentences ORDER BY created_at DESC LIMIT 200"):
        texts.append(r["text"])
    for r in query("SELECT DISTINCT surface FROM annotations LIMIT 400"):
        texts.append(r["surface"])
    return texts
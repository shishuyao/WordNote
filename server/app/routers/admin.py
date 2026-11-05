"""管理：导出 / 导入 / 设置 / 健康检查 / 手动翻译。"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import AUDIO_DIR, DB_PATH, ECDICT_DB, VERSION, VOICES
from ..db import (
    db,
    execute,
    get_settings,
    query,
    query_one,
    set_setting,
)
from ..security import current_user
from ..services import tts
from ..services.translate import TranslateError, translate

router = APIRouter(prefix="/api", tags=["admin"])

EXPORT_VERSION = 1
EXPORT_TABLES = ("words", "sentences", "annotations", "examples", "review_logs")


class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    force: bool = False


class SettingsIn(BaseModel):
    values: dict[str, str]


@router.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "app": "wordnote",
        "version": VERSION,
        "time": int(time.time()),
        "tts": await tts.status(),
    }


@router.get("/stats/extra")
def stats_extra(user: dict = Depends(current_user)) -> dict:
    words = query("SELECT headword FROM words")
    return {
        "db_path": str(DB_PATH),
        "db_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
        "audio": tts.cache_stats(),
        "words": len(words),
        "lookup_cache": query_one("SELECT COUNT(*) AS n FROM lookup_cache")["n"],
        "translate_cache": query_one("SELECT COUNT(*) AS n FROM translate_cache")["n"],
    }


@router.get("/settings")
def read_settings(user: dict = Depends(current_user)) -> dict:
    settings = get_settings()
    settings.setdefault("voice", "F5")
    return {"values": settings, "voices_available": [v["id"] for v in VOICES]}


@router.put("/settings")
def write_settings(payload: SettingsIn, user: dict = Depends(current_user)) -> dict:
    for key, value in payload.values.items():
        set_setting(key, str(value))
    return {"values": get_settings()}


@router.post("/translate")
async def translate_text(payload: TranslateIn, user: dict = Depends(current_user)) -> dict:
    try:
        return await translate(payload.text, force=payload.force)
    except TranslateError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/export/json")
def export_json(token: str | None = Query(default=None), user: dict = Depends(current_user)) -> Response:
    data: dict = {
        "app": "wordnote",
        "version": EXPORT_VERSION,
        "exported_at": int(time.time()),
        "tables": {},
    }
    for table in EXPORT_TABLES:
        rows = [dict(r) for r in query(f"SELECT * FROM {table}")]
        data["tables"][table] = rows
    data["counts"] = {k: len(v) for k, v in data["tables"].items()}
    body = json.dumps(data, ensure_ascii=False, indent=1)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="wordnote-{stamp}.json"'},
    )


@router.get("/export/db")
def export_db(user: dict = Depends(current_user)) -> FileResponse:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    tmp = Path(tempfile.gettempdir()) / f"wordnote-{stamp}.db"
    src = db()
    dest = sqlite3.connect(tmp)
    try:
        src.backup(dest)
    finally:
        dest.close()
    return FileResponse(
        tmp,
        media_type="application/octet-stream",
        filename=f"wordnote-{stamp}.db",
        background=None,
    )


@router.post("/import/json")
def import_json(payload: dict, user: dict = Depends(current_user)) -> dict:
    tables = payload.get("tables") if isinstance(payload.get("tables"), dict) else payload
    if not isinstance(tables, dict):
        raise HTTPException(status_code=400, detail="无效的备份文件")

    now = int(time.time())
    stats = {"words": 0, "sentences": 0, "annotations": 0, "examples": 0}

    word_map: dict[str, int] = {
        r["headword"]: r["id"] for r in query("SELECT id, headword FROM words")
    }
    for w in tables.get("words") or []:
        head = (w.get("headword") or "").strip().lower()
        if not head:
            continue
        if head in word_map:
            continue
        wid = execute(
            "INSERT INTO words(headword, base_form, phonetic_uk, phonetic_us, pos, meaning_zh, "
            "meaning_en, forms, dict_json, note, source, created_at, updated_at, due_at, "
            "interval_days, ease, reps, lapses) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                head,
                w.get("base_form") or head,
                w.get("phonetic_uk") or "",
                w.get("phonetic_us") or "",
                w.get("pos") or "",
                w.get("meaning_zh") or "",
                w.get("meaning_en") or "",
                w.get("forms") or "{}",
                w.get("dict_json"),
                w.get("note") or "",
                "import",
                w.get("created_at") or now,
                w.get("updated_at") or now,
                w.get("due_at") or now,
                w.get("interval_days") or 0,
                w.get("ease") or 2.5,
                w.get("reps") or 0,
                w.get("lapses") or 0,
            ),
        )
        word_map[head] = wid
        stats["words"] += 1

    sent_map: dict[str, int] = {r["text"]: r["id"] for r in query("SELECT id, text FROM sentences")}
    old_to_new_sent: dict[int, int] = {}
    for s in tables.get("sentences") or []:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        if text in sent_map:
            old_to_new_sent[int(s.get("id") or 0)] = sent_map[text]
            continue
        sid = execute(
            "INSERT INTO sentences(text, translation, source, note, tags, created_at, updated_at, "
            "due_at, interval_days, ease, reps, lapses) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                text,
                s.get("translation") or "",
                s.get("source") or "",
                s.get("note") or "",
                s.get("tags") or "[]",
                s.get("created_at") or now,
                s.get("updated_at") or now,
                s.get("due_at") or now,
                s.get("interval_days") or 0,
                s.get("ease") or 2.5,
                s.get("reps") or 0,
                s.get("lapses") or 0,
            ),
        )
        sent_map[text] = sid
        old_to_new_sent[int(s.get("id") or 0)] = sid
        stats["sentences"] += 1

    id_to_head = {r["id"]: r["headword"] for r in query("SELECT id, headword FROM words")}
    old_word_to_head = {int(w["id"]): (w.get("headword") or "").lower() for w in tables.get("words") or [] if w.get("id")}

    existing_anns = {
        (r["sentence_id"], r["char_start"], r["char_end"]) for r in query("SELECT sentence_id, char_start, char_end FROM annotations")
    }
    for a in tables.get("annotations") or []:
        old_sid = int(a.get("sentence_id") or 0)
        sid = old_to_new_sent.get(old_sid)
        if not sid:
            row = query_one("SELECT id FROM sentences WHERE text=?", (a.get("__sentence_text", ""),))
            sid = row["id"] if row else None
        if not sid:
            continue
        old_wid = int(a.get("word_id") or 0)
        head = old_word_to_head.get(old_wid)
        wid = word_map.get(head) if head else None
        key = (sid, a.get("char_start"), a.get("char_end"))
        if key in existing_anns:
            continue
        execute(
            "INSERT INTO annotations(sentence_id, word_id, surface, char_start, char_end, note, created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (
                sid,
                wid,
                a.get("surface") or "",
                int(a.get("char_start") or 0),
                int(a.get("char_end") or 0),
                a.get("note") or "",
                a.get("created_at") or now,
            ),
        )
        existing_anns.add(key)
        stats["annotations"] += 1

    for ex in tables.get("examples") or []:
        old_wid = int(ex.get("word_id") or 0)
        head = old_word_to_head.get(old_wid)
        wid = word_map.get(head) if head else None
        if not wid or not ex.get("en"):
            continue
        if query_one("SELECT id FROM examples WHERE word_id=? AND en=?", (wid, ex["en"])):
            continue
        execute(
            "INSERT INTO examples(word_id, en, zh, source, sentence_id, seq) VALUES(?,?,?,?,?,?)",
            (wid, ex["en"], ex.get("zh") or "", ex.get("source") or "import", None, ex.get("seq") or 0),
        )
        stats["examples"] += 1

    return {"ok": True, "imported": stats}


@router.delete("/data/all")
def wipe(user: dict = Depends(current_user)) -> dict:
    for table in ("review_logs", "examples", "annotations", "sentences", "words", "lookup_cache", "translate_cache"):
        execute(f"DELETE FROM {table}")
    tts.clear_cache()
    return {"ok": True}

@router.get("/export/bundle")
def export_bundle(user: dict = Depends(current_user)) -> FileResponse:
    """离线包：一致快照的 db + 离线词库 + 全部发音缓存 + 恢复说明，一个 zip 带走。"""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    zpath = Path(tempfile.gettempdir()) / f"wordnote-offline-{stamp}.zip"
    db_snapshot = Path(tempfile.gettempdir()) / f"wordnote-snapshot-{stamp}.db"

    src = db()
    dest = sqlite3.connect(db_snapshot)
    try:
        src.backup(dest)
    finally:
        dest.close()

    counts = {}
    audio_files = sorted(AUDIO_DIR.glob("*.wav"))
    has_ecdict = bool(ECDICT_DB and Path(ECDICT_DB).exists())
    manifest = {
        "app": "wordnote",
        "exported_at": int(time.time()),
        "counts": counts,
        "audio_files": len(audio_files),
        "has_ecdict": has_ecdict,
        "restore": [
            "1) 停掉 Wordnote 服务（scripts/stop 或结束 python 进程）",
            "2) wordnote.db 覆盖到 <项目>/data/wordnote.db，并删除同目录 wordnote.db-wal / wordnote.db-shm",
            "3) ecdict.db 覆盖到 <项目>/data/ecdict.db（没有则失去离线查新词能力）",
            "4) audio/ 合并到 <项目>/data/audio/（可选，只是让发音秒开）",
            "5) 跑 scripts/start-all.ps1；账号密码与备份库里的一致",
        ],
    }

    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(db_snapshot, "wordnote.db")
        if has_ecdict:
            z.write(str(ECDICT_DB), "ecdict.db")
        for f in audio_files:
            z.write(f, f"audio/{f.name}")
        for table in ("words", "sentences", "annotations", "examples"):
            counts[table] = query_one(f"SELECT COUNT(*) AS n FROM {table}")["n"]
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr("README.txt", "\n".join(manifest["restore"]) + "\n")

    db_snapshot.unlink(missing_ok=True)
    return FileResponse(
        zpath,
        media_type="application/zip",
        filename=f"wordnote-offline-{stamp}.zip",
    )
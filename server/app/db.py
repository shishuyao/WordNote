"""SQLite 数据层：单文件库，方便整库拷走迁移。

设计要点
- 只依赖标准库 sqlite3，不引入 ORM，迁移时除了 .db 文件之外没有别的东西要带走。
- WAL 模式：读写并发更稳（服务常驻 + 浏览器轮询不会锁表）。
- 结构变更靠 user_version 里的迁移序号，新版本自动补齐，不丢数据。
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Iterable

from .config import DB_PATH, ensure_dirs

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    translation TEXT,
    source TEXT,
    note TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    due_at INTEGER,
    interval_days REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headword TEXT UNIQUE NOT NULL,
    base_form TEXT,
    phonetic_uk TEXT,
    phonetic_us TEXT,
    pos TEXT,
    meaning_zh TEXT,
    meaning_en TEXT,
    forms TEXT NOT NULL DEFAULT '{}',
    dict_json TEXT,
    lookup_state TEXT NOT NULL DEFAULT 'ok',
    note TEXT NOT NULL DEFAULT '',
    source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    due_at INTEGER,
    interval_days REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    word_id INTEGER REFERENCES words(id) ON DELETE SET NULL,
    surface TEXT NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    en TEXT NOT NULL,
    zh TEXT,
    source TEXT,
    sentence_id INTEGER,
    seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS review_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    quality INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_cache (
    q TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS translate_cache (
    src TEXT PRIMARY KEY,
    dst TEXT NOT NULL,
    provider TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ann_sentence ON annotations(sentence_id);
CREATE INDEX IF NOT EXISTS idx_ann_word ON annotations(word_id);
CREATE INDEX IF NOT EXISTS idx_words_head ON words(headword);
CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_at);
CREATE INDEX IF NOT EXISTS idx_sent_due ON sentences(due_at);
CREATE INDEX IF NOT EXISTS idx_examples_word ON examples(word_id);
CREATE INDEX IF NOT EXISTS idx_logs_time ON review_logs(reviewed_at);
"""

_local = threading.local()
_write_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def db() -> sqlite3.Connection:
    """每个线程复用一条连接。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        ensure_dirs()
        conn = _connect()
        _local.conn = conn
    return conn


def init_db() -> None:
    ensure_dirs()
    conn = db()
    with _write_lock:
        conn.executescript(SCHEMA)
        cur = conn.execute("PRAGMA user_version")
        v = cur.fetchone()[0]
        if v and v < 2:
            # v2：记录词条是否"待补齐"（当时查词失败，联网后自动重试）
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(words)")}
            if "lookup_state" not in cols:
                conn.execute("ALTER TABLE words ADD COLUMN lookup_state TEXT NOT NULL DEFAULT 'ok'")
        if v != SCHEMA_VERSION:
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        conn.commit()


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return db().execute(sql, tuple(params)).fetchall()


def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return db().execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    with _write_lock:
        conn = db()
        cur = conn.execute(sql, tuple(params))
        conn.commit()
        return cur.lastrowid if cur.lastrowid is not None else cur.rowcount


def setup_complete() -> bool:
    try:
        row = query_one("SELECT COUNT(*) AS n FROM users")
        return bool(row and row["n"] > 0)
    except sqlite3.OperationalError:
        return False


# ---------- 设置项 ----------
def get_setting(key: str, default: str | None = None) -> str | None:
    row = query_one("SELECT value FROM settings WHERE key=?", (key,))
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def get_settings() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in query("SELECT key, value FROM settings"):
        out[row["key"]] = row["value"]
    return out


# ---------- 缓存 ----------
def cache_lookup(q: str, payload: dict[str, Any]) -> None:
    execute(
        "INSERT INTO lookup_cache(q, payload, fetched_at) VALUES(?, ?, ?) "
        "ON CONFLICT(q) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
        (q.lower(), json.dumps(payload, ensure_ascii=False), int(time.time())),
    )


def cached_lookup(q: str, ttl: int = 30 * 86400) -> dict[str, Any] | None:
    row = query_one("SELECT payload, fetched_at FROM lookup_cache WHERE q=?", (q.lower(),))
    if not row:
        return None
    if ttl > 0 and time.time() - row["fetched_at"] > ttl:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def cache_translation(src: str, dst: str, provider: str) -> None:
    execute(
        "INSERT INTO translate_cache(src, dst, provider, fetched_at) VALUES(?, ?, ?, ?) "
        "ON CONFLICT(src) DO UPDATE SET dst=excluded.dst, provider=excluded.provider, "
        "fetched_at=excluded.fetched_at",
        (src, dst, provider, int(time.time())),
    )


def cached_translation(src: str) -> dict[str, Any] | None:
    row = query_one("SELECT dst, provider, fetched_at FROM translate_cache WHERE src=?", (src,))
    return dict(row) if row else None

"""全局配置与路径。

优先级：环境变量 > data/local.json（本机部署配置，已 gitignore）> 仓库内通用默认值。
这样代码里不夹带任何个人路径，换机器只改 data/local.json 或设环境变量。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

VERSION = "0.3.0"
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("WORDNOTE_DATA", ROOT / "data")).resolve()
AUDIO_DIR = DATA_DIR / "audio"
DB_PATH = Path(os.environ.get("WORDNOTE_DB", DATA_DIR / "wordnote.db")).resolve()
SECRET_PATH = DATA_DIR / "secret.key"
WEB_DIST = ROOT / "web" / "dist"

DEFAULT_PASSWORD = os.environ.get("WORDNOTE_PASSWORD", "")


def _load_local_config() -> dict:
    """读取 data/local.json（可选）：放本机的 Supertonic 路径、看护进程等。"""
    path = Path(os.environ.get("WORDNOTE_LOCAL_CONFIG", DATA_DIR / "local.json"))
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


LOCAL_CONFIG = _load_local_config()
_SPEECH = LOCAL_CONFIG.get("speech") if isinstance(LOCAL_CONFIG.get("speech"), dict) else {}


def _speech(key: str, env: str, default: str = "") -> str:
    return os.environ.get(env) or str(_SPEECH.get(key) or "") or default


# ---- Supertonic 3（audiocpp 常驻服务）----
TTS_URL = os.environ.get("ST_SERVER", "http://127.0.0.1:8090").rstrip("/")
TTS_MODEL_ID = os.environ.get("ST_MODEL_ID", "supertonic")
# 以下三项默认留空：留空 = 只回退 CLI/不自动拉起，属于"未配置发音服务"的降级状态
TTS_MODEL_PATH = _speech("model_path", "ST_MODEL_PATH")
AUDIOCPP_CLI = _speech("cli", "ST_CLI")
AUDIOCPP_EXE = _speech("server", "ST_EXE")
TTS_BACKEND = os.environ.get("ST_BACKEND") or str(_SPEECH.get("backend") or "cpu")
TTS_THREADS = int(os.environ.get("ST_THREADS") or _SPEECH.get("threads") or 8)

VOICES = [
    {"id": "F5", "label": "F5 · 女声（清亮，默认）"},
    {"id": "F1", "label": "F1 · 女声（柔和）"},
    {"id": "F2", "label": "F2 · 女声（明快）"},
    {"id": "F3", "label": "F3 · 女声（低沉）"},
    {"id": "F4", "label": "F4 · 女声（轻快）"},
    {"id": "M1", "label": "M1 · 男声（稳重）"},
    {"id": "M2", "label": "M2 · 男声（温和）"},
    {"id": "M3", "label": "M3 · 男声（低音）"},
    {"id": "M4", "label": "M4 · 男声（明亮）"},
    {"id": "M5", "label": "M5 · 男声（松弛）"},
]
DEFAULT_VOICE = os.environ.get("WORDNOTE_VOICE", "F5")

# ---- 免费翻译 / 词典 ----
MYMEMORY_URL = "https://api.mymemory.translated.net/get"
MYMEMORY_EMAIL = os.environ.get("MYMEMORY_EMAIL", "")  # 填邮箱可把日配额从 5k 提到 50k 字符
MYMEMORY_CHAR_LIMIT = 480  # 单次请求字符上限
YOUDAO_URL = "https://dict.youdao.com/jsonapi"
DICTAPI_URL = "https://api.dictionaryapi.dev/api/v2/entries/en"
HTTP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
LOOKUP_TTL = int(os.environ.get("WORDNOTE_LOOKUP_TTL", str(30 * 86400)))

# 离线模式：只查本地词库（ECDICT），不发起任何外网请求。上飞机/断网时设 WORDNOTE_OFFLINE=1
OFFLINE = os.environ.get("WORDNOTE_OFFLINE", "0") == "1"
# 本地离线词库（scripts/import_ecdict.py 生成）
ECDICT_DB = os.environ.get("WORDNOTE_ECDICT", str(DATA_DIR / "ecdict.db"))
# 后台补齐"当时查词失败"的词条，间隔秒数
LOOKUP_RETRY_INTERVAL = int(os.environ.get("WORDNOTE_RETRY_INTERVAL", "1200"))


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

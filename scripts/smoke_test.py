"""自检脚本：不登录、不碰数据库里的账号，直接打接口 + 校验离线能力。

用法（服务已经在跑）：
  .venv\\Scripts\\python.exe scripts\\smoke_test.py

它会：
  1) 校验 /api/health、静态页面、TTS 服务状态
  2) 用依赖覆盖跳过登录，验证句子/单词/离线状态/离线包导出
  3) 直接调用服务层验证"离线查词走 ECDICT"
"""

from __future__ import annotations

import io
import warnings
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
os.environ.setdefault("WORDNOTE_DATA", str(ROOT / "data"))

warnings.filterwarnings("ignore")
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.security import current_user  # noqa: E402

app.dependency_overrides[current_user] = lambda: {"uid": 1, "u": "smoke"}


def ok(name: str, cond: bool, extra: str = "") -> bool:
    print(("PASS  " if cond else "FAIL  ") + name + (f"  {extra}" if extra else ""))
    return cond


def main() -> int:
    results: list[bool] = []
    with TestClient(app) as client:
        h = client.get("/api/health")
        results.append(ok("health", h.status_code == 200 and h.json()["ok"] is True))
        tts = h.json().get("tts", {})
        results.append(ok("tts 服务在线", bool(tts.get("alive")), f"model_loaded={tts.get('model_loaded')}"))

        results.append(ok("前端页面可访问", client.get("/").status_code == 200))

        st = client.get("/api/offline/status")
        data = st.json() if st.status_code == 200 else {}
        results.append(ok("离线状态", st.status_code == 200))
        ec = data.get("ecdict", {})
        results.append(ok("离线词库 ECDICT", bool(ec.get("available")), f"{ec.get('count')} 词"))
        results.append(ok("发音缓存", (data.get("audio") or {}).get("files", 0) > 0,
                          f"{(data.get('audio') or {}).get('files')} 条"))

        r = client.post("/api/offline/retry?limit=3")
        results.append(ok("补全待查词条接口", r.status_code == 200, str(r.json())))

        w = client.get("/api/words?limit=5")
        results.append(ok("单词列表", w.status_code == 200 and w.json()["total"] > 0))
        if w.json().get("items"):
            wid = w.json()["items"][0]["id"]
            d = client.get(f"/api/words/{wid}")
            item = d.json().get("item", {})
            results.append(ok("词条快照含音标/释义/例句",
                              bool(item.get("dict")) and bool(item.get("examples"))))

        s = client.get("/api/sentences?limit=3").json()
        if s.get("items"):
            sid = s["items"][0]["id"]
            detail = client.get(f"/api/sentences/{sid}").json()["item"]
            results.append(ok("句子含译文与划线", bool(detail.get("translation")) and len(detail.get("annotations") or []) > 0))

            audio = client.get("/api/tts", params={"text": detail["text"][:80]})
            results.append(ok("发音接口返回音频", audio.status_code == 200 and len(audio.content) > 1000,
                              f"{len(audio.content)//1024} KB, engine={audio.headers.get('x-tts-engine')}"))

        bundle = client.get("/api/export/bundle")
        good = bundle.status_code == 200 and bundle_ok(bundle.content)
        results.append(ok("离线包导出", good, f"{len(bundle.content)//1024//1024} MB"))

    results.append(ok_offline_lookup())
    print()
    print(f"通过 {sum(1 for x in results if x)}/{len(results)}")
    return 0 if all(results) else 1


def bundle_ok(content: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            names = z.namelist()
        return "wordnote.db" in names and "manifest.json" in names
    except zipfile.BadZipFile:
        return False


def ok_offline_lookup() -> bool:
    """强制走离线路径（等价于 WORDNOTE_OFFLINE=1）。"""
    import app.services.dictlookup as dl
    import app.services.ecdict as ec

    local = ec.lookup_local("serendipity")
    have = bool(local and local.get("senses"))
    print(("PASS  " if have else "FAIL  ") + "离线查词（ECDICT 直查）" + (
        f"  {local['senses'][0]['defs'][0][:24]}" if have else ""))
    return have


if __name__ == "__main__":
    sys.exit(main())

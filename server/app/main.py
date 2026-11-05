"""词笺 Wordnote — FastAPI 应用入口。

单进程：API + 前端静态资源同端口（LAN http://<本机IP>:8100）。
导航：http://127.0.0.1:8100/  文档：/docs（局域网调试用）
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import DEFAULT_VOICE, LOOKUP_RETRY_INTERVAL, OFFLINE, VERSION, WEB_DIST, ensure_dirs
from .db import init_db
from .routers import admin, auth, media, offline, review, sentences, words as words_router



async def _pending_retry_loop() -> None:
    """后台把当时查词失败的词条补齐（离线模式下不跑）。"""
    import asyncio

    from .services.words import pending_count, retry_pending

    await asyncio.sleep(40)
    while True:
        try:
            if not OFFLINE and pending_count() > 0:
                result = await retry_pending(5)
                print("[lookup-retry] checked=%s fixed=%s remaining=%s" % (
                    result["checked"], result["fixed"], result["remaining"]), flush=True)
        except Exception as exc:  # noqa: BLE001  后台任务不能把服务带崩
            print("[lookup-retry] error: %s" % exc, flush=True)
        await asyncio.sleep(LOOKUP_RETRY_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    from .services import tts

    ensure_dirs()
    init_db()
    tts.set_loop(asyncio.get_running_loop())
    task = asyncio.create_task(_pending_retry_loop())
    yield
    task.cancel()


app = FastAPI(
    title="词笺 Wordnote",
    description="英文句子/单词摘抄与复习服务 · Supertonic 3 发音",
    version=VERSION,
    lifespan=lifespan,
)

PUBLIC_PATHS = ("/api/auth/login", "/api/auth/setup", "/api/auth/me", "/api/health", "/docs", "/openapi.json")


@app.middleware("http")
async def guard_and_headers(request: Request, call_next):
    t0 = time.time()
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin:
            host = urlparse(origin).hostname or ""
            if host not in {"127.0.0.1", "localhost", request.url.hostname or ""}:
                return JSONResponse({"detail": "跨站请求被拒绝"}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Response-Time", f"{(time.time() - t0) * 1000:.0f}ms")
    return response


for router in (auth.router, sentences.router, words_router.router, review.router, media.router, offline.router, admin.router):
    app.include_router(router)


@app.get("/api")
def api_root() -> dict:
    return {"app": "wordnote", "version": VERSION, "docs": "/docs", "default_voice": DEFAULT_VOICE}


if (WEB_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    """前端 history 路由回退：非 /api 的路径都交给 index.html。"""
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    if WEB_DIST.is_dir():
        candidate = (WEB_DIST / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(WEB_DIST.resolve())):
            return FileResponse(candidate)
        index = WEB_DIST / "index.html"
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {
            "app": "wordnote",
            "message": "前端尚未构建。开发模式请运行 web/ 下的 pnpm dev，"
            "或执行 pnpm build 生成 web/dist 后刷新。",
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8100, reload=False)

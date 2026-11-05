"""鉴权：scrypt 口令哈希 + HMAC 签名 Cookie（无第三方依赖，单账号家庭内网够用）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import Cookie, HTTPException, status

from .config import SECRET_PATH, ensure_dirs
from .db import query_one

COOKIE_NAME = "wn_session"
SESSION_TTL = 30 * 86400
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1

if os.environ.get("WORDNOTE_FAST_HASH") == "1":
    _SCRYPT_N = 2 ** 12


def _secret() -> bytes:
    ensure_dirs()
    if SECRET_PATH.exists():
        return SECRET_PATH.read_bytes()
    key = secrets.token_bytes(48)
    SECRET_PATH.write_bytes(key)
    try:
        os.chmod(SECRET_PATH, 0o600)
    except OSError:
        pass
    return key


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_hex, hash_hex = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(hash_hex) // 2,
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# ---------- 会话令牌 ----------
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def make_token(user_id: int, username: str) -> str:
    payload = {"uid": user_id, "u": username, "exp": int(time.time()) + SESSION_TTL}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def read_token(token: str | None) -> dict | None:
    if not token or "." not in token:
        return None
    body, _, sig = token.rpartition(".")
    expect = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    if not query_one("SELECT id FROM users WHERE id=?", (payload.get("uid"),)):
        return None
    return payload


def current_user(wn_session: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> dict:
    """FastAPI 依赖：未登录直接 401，前端据此跳登录页。"""
    user = read_token(wn_session)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或登录已过期")
    return user

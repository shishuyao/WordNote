"""鉴权路由：首启初始化、登录、登出、改密。"""

from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Cookie, HTTPException, Response, Depends
from pydantic import BaseModel, Field

from ..db import execute, query_one, setup_complete
from ..security import (
    COOKIE_NAME,
    SESSION_TTL,
    current_user,
    hash_password,
    make_token,
    read_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SetupIn(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


@router.get("/me")
def me(wn_session: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> dict:
    user = read_token(wn_session)
    return {
        "authenticated": bool(user),
        "username": (user or {}).get("u"),
        "setup_required": not setup_complete(),
    }


@router.post("/setup")
def setup(payload: SetupIn, response: Response) -> dict:
    if setup_complete():
        raise HTTPException(status_code=409, detail="已完成初始化")
    try:
        uid = execute(
            "INSERT INTO users(username, password_hash, created_at) VALUES(?,?,?)",
            (payload.username.strip(), hash_password(payload.password), int(time.time())),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="用户名已存在")
    _set_cookie(response, make_token(uid, payload.username.strip()))
    return {"ok": True, "username": payload.username.strip()}


@router.post("/login")
def login(payload: LoginIn, response: Response) -> dict:
    row = query_one("SELECT * FROM users WHERE username=?", (payload.username.strip(),))
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码不正确")
    _set_cookie(response, make_token(row["id"], row["username"]))
    return {"ok": True, "username": row["username"]}


@router.post("/logout")
def logout() -> Response:
    response = Response(content='{"ok": true}', media_type="application/json")
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.post("/password")
def change_password(payload: PasswordIn, user: dict = Depends(current_user)) -> dict:
    row = query_one("SELECT * FROM users WHERE id=?", (user["uid"],))
    if not row or not verify_password(payload.old_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="原密码不正确")
    execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(payload.new_password), user["uid"]))
    return {"ok": True}

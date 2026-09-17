"""加密 Cookie 会话。"""

import base64
import secrets
from pathlib import Path
from typing import Dict, Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request, Response
from openai import OpenAI

from config import REQUEST_TIMEOUT, SESSION_MAX_AGE


# 会话加密密钥文件（首次启动自动生成）
_SECRET_PATH = Path(".auth-secret")
_cipher: Optional[Fernet] = None


def _get_cipher() -> Fernet:
    """获取或初始化 Fernet 加密器，密钥持久化到 .auth-secret 文件。"""
    global _cipher
    if _cipher:
        return _cipher

    secret = ""
    if not secret and _SECRET_PATH.exists():
        secret = _SECRET_PATH.read_text(encoding="utf-8").strip()
    if not secret:
        secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
        _SECRET_PATH.write_text(secret, encoding="utf-8")

    _cipher = Fernet(secret.encode("ascii"))
    return _cipher


def encode_session(api_key: str, base_url: str) -> str:
    """将 API Key 和 Base URL 加密为会话 Token。"""
    payload = f"{api_key}\n{base_url}".encode("utf-8")
    return _get_cipher().encrypt(payload).decode("ascii")


def decode_session(token: Optional[str]) -> Optional[Dict[str, str]]:
    """解密会话 Token，返回字典或 None。"""
    if not token:
        return None
    try:
        payload = _get_cipher().decrypt(token.encode("ascii"), ttl=SESSION_MAX_AGE)
        api_key, separator, base_url = payload.decode("utf-8").partition("\n")
        if separator and api_key and base_url:
            return {"apiKey": api_key, "baseURL": base_url}
    except (InvalidToken, UnicodeError):
        pass
    return None


def get_session(request: Request) -> Optional[Dict[str, str]]:
    """从请求 Cookie 中读取并解密会话。"""
    return decode_session(request.cookies.get("inx_session"))


def set_session_cookie(
    response: Response,
    token: str,
    max_age: int = SESSION_MAX_AGE,
) -> None:
    """将加密后的会话 Token 写入 Cookie。"""
    response.set_cookie(
        key="inx_session",
        value=token,
        max_age=max_age,
        path="/",
        httponly=True,
        samesite="lax",
        secure=False,  # 生产环境应改为 True
    )


def create_openai_client(request: Request) -> OpenAI:
    """根据当前会话创建 OpenAI 客户端。"""
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="未登录或会话已失效。")
    return OpenAI(
        api_key=session["apiKey"],
        base_url=session["baseURL"],
        timeout=REQUEST_TIMEOUT,
    )
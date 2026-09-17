"""登录与会话状态查询。"""

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, Response

from auth.schema import LoginRequest
from auth.session import encode_session, get_session, set_session_cookie
from config_default import MODEL, SESSION_MAX_AGE


router = APIRouter()


@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    """处理登录请求，校验 API Key 并加密存储到 Cookie。"""
    api_key = payload.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请输入 INX_TOKEN_API_KEY。")
    if len(api_key) > 500:
        raise HTTPException(status_code=400, detail="API Key 长度不符合要求。")

    base_url = _normalize_base_url(payload.base_url)
    set_session_cookie(response, encode_session(api_key, base_url))
    return {"ok": True, "baseURL": base_url}


@router.get("/session")
async def session(request: Request):
    """返回会话状态和当前使用的模型名称。"""
    current_session = get_session(request)
    return {
        "authenticated": bool(current_session),
        "expiresIn": SESSION_MAX_AGE if current_session else 0,
        "model": MODEL,
    }


@router.post("/logout")
async def logout(response: Response):
    """清除当前浏览器会话。"""
    set_session_cookie(response, "", max_age=0)
    return {"ok": True}


def _normalize_base_url(value: str) -> str:
    """标准化 Base URL，确保格式正确。"""
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail="Base URL 必须使用 http 或 https。",
        )
    return parsed.geturl().rstrip("/")
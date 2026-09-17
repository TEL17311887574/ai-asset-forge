"""统一 HTTP 路由入口。"""

from fastapi import APIRouter, Request

from auth.router import router as auth_router
from auth.session import get_session
from config_default import MODEL
from image.router import router as image_router


router = APIRouter()
router.include_router(auth_router, prefix="/api/auth", tags=["登录会话"])
router.include_router(image_router, prefix="/api", tags=["图片生成"])


@router.get("/api/health", tags=["服务状态"])
async def health(request: Request):
    """检查服务以及当前浏览器会话状态。"""
    session = get_session(request)
    return {
        "ok": True,
        "configured": bool(session),
        "model": MODEL,
        "baseURL": session["baseURL"] if session else None,
    }

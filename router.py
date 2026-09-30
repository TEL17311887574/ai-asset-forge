"""统一 HTTP 路由入口（零状态版）。"""

from fastapi import APIRouter, Request

from config_default import AVAILABLE_MODELS, MODEL
from image.router import router as image_router


router = APIRouter()
router.include_router(image_router, prefix="/api", tags=["图片生成"])


@router.get("/api/health", tags=["服务状态"])
async def health():
    """服务存活检查；Key 由浏览器管理，服务端恒为「已就绪」。"""
    return {
        "ok": True,
        "configured": True,
        "model": MODEL,
        "baseURL": None,
    }


@router.get("/api/models", tags=["服务状态"])
async def models():
    """返回可用的模型列表，供前端模型切换器使用。"""
    return {"default": MODEL, "available": AVAILABLE_MODELS}

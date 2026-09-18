"""Ai Asset Forge 服务入口。

配置统一由 ``config_default`` 模块提供（根目录 ``config_default.py``）。
本模块只负责组装 FastAPI 应用，业务模块也应直接从 ``config_default`` 导入配置，
因此不存在循环依赖。
"""

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from auth.session import close_openai_clients
from config_default import CORS_ORIGINS
from image.service import get_error_message
from router import router


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用。"""
    app = FastAPI(
        title="Ai Asset Forge",
        description="本地运行的 AI 图像资产生成工作台",
        version="1.0.0",
        docs_url="/docs",
        swagger_ui_parameters={
            "displayRequestDuration": True,  # 显示请求耗时
            "defaultModelsExpandDepth": -1,  # 隐藏底部 Schemas 区域
        },
    )

    # 跨源访问：CORS_ORIGINS 为空时表示仅同源可访问，不产生 CORS 头。
    if CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(_request: Request, exc: HTTPException):
        """捕获 HTTP 异常并返回标准错误格式。"""
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ):
        """捕获请求参数校验错误。"""
        details = [
            {
                "loc": list(error.get("loc", [])),
                "msg": error.get("msg", ""),
                "type": error.get("type", ""),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            {"error": "请求参数不完整或格式不正确。", "details": details},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def handle_server_error(_request: Request, exc: Exception):
        """兜底处理器：捕获一切服务器内部异常（含 OpenAI SDK 异常）。

        FastAPI 的异常分发会优先匹配更具体的类型：
        - HTTPException          -> 业务错误，返回原始状态码与 detail
        - RequestValidationError -> 参数校验错误，返回 422
        其余任何异常（OpenAIError、RuntimeError、TypeError、网络错误等）
        都会落到这里，记录完整堆栈后统一返回 JSON，避免出现 ASGI 崩溃。
        """
        status_code = getattr(exc, "status_code", None)
        if not isinstance(status_code, int) or not (400 <= status_code <= 599):
            status_code = 500
        logger.opt(exception=exc).error(
            "服务器内部异常 [{}]: {}",
            type(exc).__name__,
            exc,
        )
        return JSONResponse(
            {
                "error": get_error_message(exc) or "服务器内部错误，请查看服务端日志。",
                "type": type(exc).__name__,
            },
            status_code=status_code,
        )

    app.include_router(router)

    # 静态文件服务（前端页面），必须放在路由之后。
    app.mount("/", StaticFiles(directory="public", html=True), name="static")

    return app


app = create_app()


@app.on_event("shutdown")
async def _shutdown() -> None:
    """服务关闭时释放 OpenAI 客户端连接池。"""
    await close_openai_clients()


if __name__ == "__main__":
    # 服务参数直接写死，避免与配置文件产生第二处事实来源。
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)

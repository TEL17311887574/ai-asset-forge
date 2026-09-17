"""GPT Image 2 Studio 服务入口。"""

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAIError

from image.service import get_error_message
from router import router


app = FastAPI(title="GPT Image 2 Studio", version="1.0.0")
app.include_router(router)


@app.exception_handler(HTTPException)
async def handle_http_error(_request: Request, exc: HTTPException):
    """捕获 HTTP 异常并返回标准错误格式。"""
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, _exc: RequestValidationError):
    """捕获请求参数校验错误。"""
    return JSONResponse(
        {"error": "请求参数不完整或格式不正确。"},
        status_code=422,
    )


@app.exception_handler(OpenAIError)
async def handle_openai_error(_request: Request, exc: OpenAIError):
    """捕获 OpenAI SDK 异常并转换为统一格式。"""
    return JSONResponse(
        {"error": get_error_message(exc)},
        status_code=getattr(exc, "status_code", None) or 500,
    )


@app.exception_handler(Exception)
async def handle_server_error(_request: Request, _exc: Exception):
    """捕获所有未处理异常。"""
    return JSONResponse(
        {"error": "服务器内部错误，请查看服务端日志。"},
        status_code=500,
    )


# 静态文件服务（前端页面）
app.mount("/", StaticFiles(directory="public", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)

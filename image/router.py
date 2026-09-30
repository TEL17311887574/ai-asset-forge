"""图片生成与编辑接口（零状态版）。

凭据由浏览器随 ``Authorization`` 头发送（Key 存 IndexedDB），
本模块只做校验与转发，服务端不保存任何 Key。
"""

from typing import Annotated, Optional, Union

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from loguru import logger

from image.service import (
    build_character_turnaround_prompt,
    build_scene_multi_view_prompt,
    clean_prompt,
    edit_image,
    generate_image,
    get_error_message,
    read_image_files,
    safe_count,
    safe_input_fidelity,
    safe_optional_prompt,
    safe_quality,
    safe_size,
)

router = APIRouter()


def extract_credentials(request: Request) -> tuple:
    """从请求头提取 API Key 与上游 Base URL（由浏览器保险库提供）。"""
    api_key = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    base_url = (request.headers.get("X-Upstream-Base-URL") or "").strip().rstrip("/")
    if not api_key:
        raise HTTPException(status_code=401, detail="未登录或会话已失效，请重新登录。")
    if not base_url:
        raise HTTPException(status_code=400, detail="缺少上游接口地址（X-Upstream-Base-URL）。")
    return api_key, base_url


def error_response(exc: Exception, context: str) -> JSONResponse:
    """将接口内部异常统一转换为 JSON 错误响应，并写入服务端日志。"""
    if isinstance(exc, HTTPException):
        logger.warning("[{}] HTTP {}: {}", context, exc.status_code, exc.detail)
        return JSONResponse(
            {"error": exc.detail},
            status_code=exc.status_code,
        )

    logger.opt(exception=exc).error("[{}] 未处理异常: {}", context, exc)
    return JSONResponse(
        {
            "error": get_error_message(exc) or "服务器内部错误，请查看服务端日志。",
            "type": type(exc).__name__,
        },
        status_code=getattr(exc, "status_code", None) or 500,
    )


@router.post("/generate")
async def generate(request: Request, payload: dict):
    """文生图接口：根据提示词生成新图片。"""
    try:
        api_key, base_url = extract_credentials(request)
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="请求体不是合法 JSON。")
        images = await generate_image(
            api_key=api_key,
            base_url=base_url,
            prompt=clean_prompt(str(payload.get("prompt", ""))),
            size=safe_size(payload.get("size")),
            quality=safe_quality(payload.get("quality")),
            n=safe_count(payload.get("n", 1)),
            model=payload.get("model"),
        )
        return {"images": images}
    except Exception as exc:  # noqa: BLE001 - 统一兜底为 JSON 响应
        return error_response(exc, "generate")


@router.post("/edit")
async def edit(
    request: Request,
    images: Annotated[list[UploadFile], Form(alias="image")],
    prompt: Annotated[str, Form()],
    size: Annotated[str, Form()] = "1024x1024",
    quality: Annotated[str, Form()] = "medium",
    n: Annotated[Union[int, str], Form()] = 1,
    mode: Annotated[str, Form()] = "edit",
    model: Annotated[Optional[str], Form()] = None,
    input_fidelity: Annotated[str, Form()] = "low",
    mask: Annotated[Optional[UploadFile], Form()] = None,
):
    """图生图接口：基于原图和提示词进行编辑、蒙版或单参考图预设模式生成。"""
    try:
        api_key, base_url = extract_credentials(request)
        image_data = await read_image_files(images)

        if mode == "characterTurnaround":
            final_prompt = build_character_turnaround_prompt(
                safe_optional_prompt(prompt)
            )
        elif mode == "sceneMultiView":
            final_prompt = build_scene_multi_view_prompt(
                safe_optional_prompt(prompt)
            )
        else:
            final_prompt = clean_prompt(prompt)

        mask_data = await mask.read() if mask else None
        images_result = await edit_image(
            api_key=api_key,
            base_url=base_url,
            prompt=final_prompt,
            images=image_data,
            size=safe_size(size),
            quality=safe_quality(quality),
            input_fidelity=safe_input_fidelity(input_fidelity),
            n=safe_count(n),
            mask=mask_data,
            model=model,
        )
        return {"images": images_result}
    except Exception as exc:  # noqa: BLE001 - 统一兜底为 JSON 响应
        return error_response(exc, "edit")


@router.post("/split-grid")
async def split_grid(request: Request, image: Annotated[UploadFile, Form()]):
    """宫格拆分（保留给旧客户端；当前前端已在本地 Canvas 完成拆分）。"""
    try:
        image_data = await image.read()
        from image.splitter import split_grid_image

        tiles = split_grid_image(image_data)
        return {
            "images": [
                {"dataUrl": data_url, "name": filename}
                for data_url, filename in tiles
            ]
        }
    except Exception as exc:  # noqa: BLE001 - 统一兜底为 JSON 响应
        return error_response(exc, "split-grid")

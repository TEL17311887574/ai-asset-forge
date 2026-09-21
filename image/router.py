"""图片生成与编辑接口。"""

from typing import Annotated, Optional, Union

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from loguru import logger

from auth.session import create_openai_client, get_session
from image.schema import GenerateRequest
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
from image.splitter import split_grid_image

router = APIRouter()


def error_response(exc: Exception, context: str) -> JSONResponse:
    """将接口内部异常统一转换为 JSON 错误响应，并写入服务端日志。

    HTTPException 保留原始状态码与 detail（例如 400/401/413）；
    其余异常一律按 500 处理，同时记录完整堆栈，便于通过日志定位。
    """
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
async def generate(request: Request, payload: GenerateRequest):
    """文生图接口：根据提示词生成新图片。"""
    try:
        client = create_openai_client(request)
        prompt = clean_prompt(payload.prompt)
        size = safe_size(payload.size)
        quality = safe_quality(payload.quality)
        count = safe_count(payload.n)

        images = await generate_image(
            client=client,
            prompt=prompt,
            size=size,
            quality=quality,
            n=count,
            model=payload.model,
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
    """图生图接口：基于原图和提示词进行编辑、蒙版或单参考图预设模式生成。

    当 ``mode="characterTurnaround"`` 或 ``mode="sceneMultiView"`` 时，后端会
    自动把 prompts/ 目录下的对应模板与用户输入拼接，前端只需提交用户自己的描述。
    """
    try:
        client = create_openai_client(request)
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
            client=client,
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
async def split_grid(
    request: Request,
    image: Annotated[UploadFile, Form()],
):
    """把带白色网格线的 2×2 宫格图拆分为四张图片。"""
    try:
        if not get_session(request):
            raise HTTPException(status_code=401, detail="未登录或会话已失效。")
        image_data = await image.read()
        tiles = split_grid_image(image_data)
        return {
            "images": [
                {"dataUrl": data_url, "name": filename}
                for data_url, filename in tiles
            ]
        }
    except Exception as exc:  # noqa: BLE001 - 统一兜底为 JSON 响应
        return error_response(exc, "split-grid")

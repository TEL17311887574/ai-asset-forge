"""图片生成与编辑服务。"""

import asyncio
import io
import re
from typing import BinaryIO, Dict, List, Optional, Union

from loguru import logger

from fastapi import HTTPException, UploadFile
from openai import APIError, AsyncOpenAI

from config_default import (
    AVAILABLE_MODELS,
    MAX_CONCURRENT_GENERATIONS,
    MAX_FILE_BYTES,
    MAX_PROMPT_LENGTH,
    MAX_SOURCE_FILES,
    MODEL,
    PROMPTS_DIR,
)


# 并发闸门：图片生成耗时长，同时放太多请求容易被上游限流，
# 超出的请求在这里排队等待而不是直接失败。
#
# 注意：asyncio.Semaphore 会绑定「创建它时」的事件循环，而本模块在 uvicorn
# 启动事件循环之前就被导入了，模块级直接创建会导致运行时出现
# "got Future attached to a different loop"。因此延迟到首次使用时创建，
# 保证信号量一定绑定在真正处理请求的那个循环上。
_GENERATION_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _get_generation_semaphore() -> asyncio.Semaphore:
    """获取（或惰性创建）并发生成信号量，必须在事件循环内调用。"""
    global _GENERATION_SEMAPHORE
    if _GENERATION_SEMAPHORE is None:
        _GENERATION_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_GENERATIONS)
    return _GENERATION_SEMAPHORE


def clean_prompt(text: str) -> str:
    """清理提示词：去除首尾空白、限制长度。"""
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空。")
    if len(text) > MAX_PROMPT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"提示词不能超过 {MAX_PROMPT_LENGTH} 字符。",
        )
    return text.strip()


# 预设提示词模板在 prompts/ 目录下维护，后端是唯一事实来源。
_TURNAROUND_TEMPLATE = "character_turnaround.txt"
_SCENE_MULTI_VIEW_TEMPLATE = "scene_multiview.txt"


def load_prompt_template(filename: str) -> str:
    """从 prompts/ 目录读取预设提示词模板。"""
    path = PROMPTS_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"提示词模板缺失: {filename}",
        )
    return path.read_text(encoding="utf-8").strip()


def build_character_turnaround_prompt(user_prompt: str) -> str:
    """把用户补充描述与角色三视图模板拼接为最终提示词。

    模板本身较长且固定，放在后端统一维护；前端只负责传用户自己的描述，
    这样模板变更无需改动前端代码。
    """
    parts = [user_prompt.strip(), load_prompt_template(_TURNAROUND_TEMPLATE)]
    return "\n\n".join(part for part in parts if part)


def safe_optional_prompt(text: str) -> str:
    """清理可空提示词：特殊预设模式允许只传参考图。"""
    if not isinstance(text, str):
        return ""
    return text.strip()


def build_scene_multi_view_prompt(user_prompt: str) -> str:
    """把用户补充描述与场景多视角模板拼接为最终提示词。"""
    parts = [user_prompt.strip(), load_prompt_template(_SCENE_MULTI_VIEW_TEMPLATE)]
    return "\n\n".join(part for part in parts if part)


def _summarize_upload(
    upload: Union[BinaryIO, List[BinaryIO]],
) -> Union[Dict[str, object], List[Dict[str, object]]]:
    """把上传文件参数转成可读日志，避免把二进制内容写进终端。"""
    if isinstance(upload, list):
        return [_summarize_upload(item) for item in upload]
    return {
        "name": getattr(upload, "name", "upload"),
        "type": type(upload).__name__,
    }


def safe_size(value: Optional[str]) -> str:
    """校验 GPT Image 2 自定义尺寸。"""
    allowed = {"auto", "1024x1024", "1536x1024", "1024x1536"}
    if value in allowed:
        return value

    if isinstance(value, str):
        match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", value)
        if match:
            width, height = map(int, match.groups())
            if (
                width >= 64
                and height >= 64
                and width <= 3840
                and height <= 3840
                and width % 16 == 0
                and height % 16 == 0
                and max(width, height) / min(width, height) <= 3
                and width * height <= 8_294_400
            ):
                return f"{width}x{height}"

    return "1024x1024"


def safe_quality(value: Optional[str]) -> str:
    """校验生成质量。"""
    allowed = {"low", "medium", "high"}
    return value if value in allowed else "medium"


def safe_count(value: Union[int, str, None]) -> int:
    """校验生成数量，兼容 multipart 表单中的字符串整数。"""
    if isinstance(value, bool):
        return 1
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 1
    return number if 1 <= number <= 4 else 1


def safe_model(value: Optional[str]) -> str:
    """校验请求中的模型名，未指定或不在白名单时回退到配置默认值。"""
    if value in AVAILABLE_MODELS:
        return value
    return MODEL


def to_openai_file(content: bytes, filename: str = "image.png") -> BinaryIO:
    """将上传文件内容转换为 OpenAI SDK 可上传的文件对象。"""
    wrapper = io.BytesIO(content)
    wrapper.name = filename
    return wrapper


def safe_input_fidelity(value: Optional[str]) -> str:
    """校验图生图保真度。"""
    allowed = {"low", "high"}
    return value if value in allowed else "low"


async def read_image_files(files: List[UploadFile]) -> List[bytes]:
    """读取并验证上传的图片文件。"""
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张原图。")
    if len(files) > MAX_SOURCE_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"最多只能上传 {MAX_SOURCE_FILES} 张图片。",
        )

    images = []
    for file in files:
        content = await file.read()
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件 {file.filename or '图片'} 超过 20 MB。",
            )
        images.append(content)
    return images


async def generate_image(
    client: AsyncOpenAI,
    prompt: str,
    size: str,
    quality: str,
    n: int,
    model: Optional[str] = None,
) -> List[Dict[str, str]]:
    """调用 OpenAI API 生成图片，返回 data URL 列表。

    通过全局信号量限制同时在跑的生成任务数；``await`` 期间事件循环可以去
    处理其它请求，这是并发能力的关键。
    """
    async with _get_generation_semaphore():
        params: Dict[str, object] = {
            "model": safe_model(model),
            "prompt": prompt,
            "size": size,
            "quality": quality,
            "n": n,
            "response_format": "b64_json",
        }
        # 调用三方接口前把实际参数打印到终端，便于本地排查生成请求。
        logger.info("[OpenAI images.generate] params={}", params)
        response = await client.images.generate(**params)
        return _image_response(response)


async def edit_image(
    client: AsyncOpenAI,
    prompt: str,
    images: List[bytes],
    size: str,
    quality: str,
    input_fidelity: str,
    n: int,
    mask: Optional[bytes] = None,
    model: Optional[str] = None,
) -> List[Dict[str, str]]:
    """调用 OpenAI API 编辑图片，返回 data URL 列表。

    与 ``generate_image`` 共用同一个并发闸门，避免文生图与图生图
    同时把上游打满。
    """
    image_parts = [
        to_openai_file(data, f"image-{index + 1}.png")
        for index, data in enumerate(images)
    ]
    payload: Dict[str, object] = {
        "model": safe_model(model),
        "image": image_parts[0] if len(image_parts) == 1 else image_parts,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "input_fidelity": input_fidelity,
        "n": n,
        "response_format": "b64_json",
    }
    # 仅在真正存在蒙版时才传入 mask 字段。
    # OpenAI SDK 会扫描请求体中的文件字段，显式传入 mask=None 会触发
    # "Expected entry at `mask` to be bytes..." 的 RuntimeError。
    if mask:
        payload["mask"] = to_openai_file(mask, "mask.png")

    log_payload = {
        **payload,
        "image": _summarize_upload(payload["image"]),
    }
    if "mask" in log_payload:
        log_payload["mask"] = _summarize_upload(log_payload["mask"])
    # 调用三方接口前把实际参数打印到终端；文件参数仅记录名称和类型。
    logger.info("[OpenAI images.edit] params={}", log_payload)

    async with _get_generation_semaphore():
        response = await client.images.edit(**payload)
        return _image_response(response)


def _image_response(response) -> List[Dict[str, str]]:
    """将 OpenAI 图片响应转换为前端可用的 data URL。"""
    return [
        item
        for item in (
            {
                "dataUrl": (
                    f"data:image/png;base64,{item.b64_json}"
                    if getattr(item, "b64_json", None)
                    else getattr(item, "url", "")
                ),
                "revisedPrompt": getattr(item, "revised_prompt", "") or "",
            }
            for item in response.data
        )
        if item["dataUrl"]
    ]


def get_error_message(exc: Exception) -> str:
    """将 OpenAI 异常转换为用户友好的错误信息。"""
    if isinstance(exc, APIError):
        return exc.message or "OpenAI API 调用失败。"
    return str(exc) or "未知错误。"

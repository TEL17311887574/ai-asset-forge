"""图片生成与编辑服务。"""

import io
import re
from typing import BinaryIO, Dict, List, Optional, Union

from fastapi import HTTPException, UploadFile
from openai import APIError, OpenAI

from config_default import (
    MAX_FILE_BYTES,
    MAX_PROMPT_LENGTH,
    MAX_SOURCE_FILES,
    MODEL,
)


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


def generate_image(
    client: OpenAI,
    prompt: str,
    size: str,
    quality: str,
    n: int,
) -> str:
    """调用 OpenAI API 生成图片，返回 Base64。"""
    response = client.images.generate(
        model=MODEL,
        prompt=prompt,
        size=size,
        quality=quality,
        n=n,
        response_format="b64_json",
    )
    return _image_response(response)


def edit_image(
    client: OpenAI,
    prompt: str,
    images: List[bytes],
    size: str,
    quality: str,
    input_fidelity: str,
    n: int,
    mask: Optional[bytes] = None,
) -> str:
    """调用 OpenAI API 编辑图片，返回 Base64。"""
    image_parts = [
        to_openai_file(data, f"image-{index + 1}.png")
        for index, data in enumerate(images)
    ]
    payload: Dict[str, object] = {
        "model": MODEL,
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

    response = client.images.edit(**payload)
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

"""图片生成与编辑服务。"""

import io
import re
from base64 import b64decode, b64encode

from fastapi import HTTPException, UploadFile
from openai import APIError, OpenAI
from PIL import Image

from prompts import load_prompt_template
from config_default import MAX_FILE_BYTES, MAX_PROMPT_LENGTH, MAX_SOURCE_FILES, MODEL, PROMPTS_DIR


def clean_prompt(text: str) -> str:
    """清理提示词：去除多余空白、限制长度。"""
    cleaned = re.sub(r"\s+", " ", text.strip())
    if len(cleaned) > MAX_PROMPT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"提示词不能超过 {MAX_PROMPT_LENGTH} 字符。",
        )
    return cleaned


def validate_size(size: str) -> None:
    """校验图片尺寸是否在支持范围内。"""
    valid_sizes = {"1024x1024", "1792x1024", "1024x1792"}
    if size not in valid_sizes:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的尺寸，请选择：{', '.join(valid_sizes)}",
        )


async def read_image_files(files: list[UploadFile]) -> list[bytes]:
    """读取并验证上传的图片文件。"""
    if len(files) > MAX_SOURCE_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"最多上传 {MAX_SOURCE_FILES} 张图片。",
        )

    images = []
    for file in files:
        content = await file.read()
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件 {file.filename} 超过 {MAX_FILE_BYTES // (1024 * 1024)} MB。",
            )
        images.append(content)
    return images


def generate_image(client: OpenAI, prompt: str, size: str) -> str:
    """调用 OpenAI API 生成图片，返回 Base64。"""
    response = client.images.generate(
        model=MODEL,
        prompt=prompt,
        size=size,
        n=1,
        response_format="b64_json",
    )
    return response.data[0].b64_json


def edit_image(
    client: OpenAI,
    prompt: str,
    images: list[bytes],
    size: str,
) -> str:
    """调用 OpenAI API 编辑图片，返回 Base64。"""
    # 合并多张图片为一张
    merged = _merge_images(images)
    response = client.images.edit(
        model=MODEL,
        image=merged,
        prompt=prompt,
        size=size,
        n=1,
        response_format="b64_json",
    )
    return response.data[0].b64_json


def generate_character_turnaround(
    client: OpenAI,
    source_image: bytes,
    custom_prompt: str,
    size: str,
) -> str:
    """生成人物面部三视图（基于原图 + 预设模板）。"""
    # 读取预设模板
    template = _load_prompt_template("character_turnaround.txt")
    
    # 合并模板和用户补充提示词
    final_prompt = f"{template}\n\n{custom_prompt}".strip() if custom_prompt else template
    
    # 调用 images.edit API（基于原图生成）
    response = client.images.edit(
        model=MODEL,
        image=source_image,
        prompt=clean_prompt(final_prompt),
        size=size,
        n=1,
        response_format="b64_json",
    )
    return response.data[0].b64_json


def _load_prompt_template(filename: str) -> str:
    """从 prompts/ 目录加载提示词模板。"""
    template_path = PROMPTS_DIR / filename
    if not template_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"提示词模板文件不存在：{filename}",
        )
    return template_path.read_text(encoding="utf-8")


def _merge_images(image_data_list: list[bytes]) -> bytes:
    """将多张图片水平拼接为一张 PNG。"""
    pil_images = [Image.open(io.BytesIO(data)).convert("RGBA") for data in image_data_list]
    total_width = sum(img.width for img in pil_images)
    max_height = max(img.height for img in pil_images)

    merged = Image.new("RGBA", (total_width, max_height), (255, 255, 255, 0))
    x_offset = 0
    for img in pil_images:
        merged.paste(img, (x_offset, 0))
        x_offset += img.width

    buffer = io.BytesIO()
    merged.save(buffer, format="PNG")
    return buffer.getvalue()


def get_error_message(exc: Exception) -> str:
    """将 OpenAI 异常转换为用户友好的错误信息。"""
    if isinstance(exc, APIError):
        return exc.message or "OpenAI API 调用失败。"
    return str(exc) or "未知错误。"

def generate_character_turnaround(
    client: OpenAI,
    source_image: bytes,
    custom_prompt: str,
    size: str,
    quality: str,
) -> str:
    """生成人物面部三视图（图生图模式）。
    
    Args:
        client: OpenAI 客户端
        source_image: 原图的字节数据
        custom_prompt: 用户补充的提示词
        size: 图片尺寸
        quality: 生成质量
    
    Returns:
        str: Base64 编码的生成结果
    """
    # 读取预设模板
    template = load_prompt_template("character_turnaround.txt")
    
    # 合并模板和用户补充提示词
    final_prompt = f"{template}\n\n{custom_prompt}".strip() if custom_prompt else template
    
    # 调用 images.edit API（因为需要基于原图生成）
    response = client.images.edit(
        model=MODEL,
        image=source_image,
        prompt=clean_prompt(final_prompt),
        size=size,
        quality=quality,
        n=1,
        response_format="b64_json",
    )
    return response.data[0].b64_json

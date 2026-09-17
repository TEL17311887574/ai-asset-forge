"""图片生成与编辑接口。"""

from fastapi import APIRouter, File, Form, Request, UploadFile

from auth.session import create_openai_client
from image.schema import GenerateRequest
from image.service import (
    clean_prompt,
    edit_image,
    generate_character_turnaround,
    generate_image,
    read_image_files,
    generate_character_turnaround,validate_size,
)


router = APIRouter()


@router.post("/generate")
async def generate(request: Request, payload: GenerateRequest):
    """文生图接口：根据提示词生成新图片。"""
    validate_size(payload.size)
    client = create_openai_client(request)
    b64_image = generate_image(
        client=client,
        prompt=clean_prompt(payload.prompt),
        size=payload.size,
    )
    return {"image": b64_image}


@router.post("/edit")
async def edit(
    request: Request,
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    images: list[UploadFile] = File(...),
):
    """图生图接口：基于原图和提示词进行编辑或变体生成。"""
    validate_size(size)
    client = create_openai_client(request)
    image_data = await read_image_files(images)
    b64_image = edit_image(
        client=client,
        prompt=clean_prompt(prompt),
        images=image_data,
        size=size,
    )
    return {"image": b64_image}


@router.post("/character-turnaround")
async def character_turnaround(
    request: Request,
    image: UploadFile = File(...),
    custom_prompt: str = Form(""),
    size: str = Form("1792x1024"),
):
    """人物面部三视图生成接口：基于原图生成三视图 + 上半身特写。
    
    默认使用预设的三视图提示词模板，用户可通过 custom_prompt 追加补充要求。
    推荐尺寸 1792x1024（横向），适合左右分栏布局。
    """
    validate_size(size)
    client = create_openai_client(request)
    image_data = (await read_image_files([image]))[0]
    
    b64_image = generate_character_turnaround(
        client=client,
        source_image=image_data,
        custom_prompt=custom_prompt,
        size=size,
    )
    return {"image": b64_image}

@router.post("/character-turnaround")
async def character_turnaround(
    request: Request,
    prompt: str = Form(""),
    size: str = Form("1792x1024"),
    quality: str = Form("standard"),
    images: list[UploadFile] = File(...),
):
    """人物面部三视图生成接口：基于原图生成三视图 + 上半身特写。
    
    默认使用预设的三视图提示词模板，用户可通过 prompt 追加补充要求。
    推荐尺寸 1792x1024（横向），适合左右分栏布局。
    """
    validate_size(size)
    client = create_openai_client(request)
    
    # 只取第一张图片
    image_data = (await read_image_files(images))[0]
    
    b64_image = generate_character_turnaround(
        client=client,
        source_image=image_data,
        custom_prompt=prompt,
        size=size,
        quality=quality,
    )
    return {"image": b64_image}

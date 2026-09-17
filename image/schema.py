"""图片生成请求模型。"""

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    """文生图请求。"""

    prompt: str
    size: str = "1024x1024"
    quality: str = "medium"
    n: int = Field(default=1, ge=1, le=4)


class CharacterTurnaroundRequest(BaseModel):
    """角色三视图请求模型（预留，当前使用 multipart 表单）。"""

    prompt: str = ""
    size: str = "1024x1024"
    quality: str = "medium"

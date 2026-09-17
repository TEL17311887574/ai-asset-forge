"""图片生成请求模型。"""

from pydantic import BaseModel


class GenerateRequest(BaseModel):
    """文生图请求。"""
    prompt: str
    size: str = "1024x1024"
    quality: str = "medium"
    n: int = 1


class CharacterTurnaroundRequest(BaseModel):
    """人物面部三视图生成请求。"""
    custom_prompt: str = ""  # 可选的补充提示词（追加在模板后）
    size: str = "1792x1024"  # 默认横向尺寸，适合左右分栏布局
    quality: str = "standard"  # 默认标准质量

class CharacterTurnaroundRequest(BaseModel):
    """人物面部三视图生成请求。"""
    custom_prompt: str = ""  # 可选的补充提示词（追加在模板后）
    size: str = "1792x1024"  # 默认横向尺寸，适合左右分栏布局
    quality: str = "standard"  # 默认标准质量

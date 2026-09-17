"""登录请求模型。"""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    api_key: str = Field(alias="apiKey")
    base_url: str = Field(alias="baseURL")

    model_config = {"populate_by_name": True}

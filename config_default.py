"""项目配置：全部可调参数集中在这里。

本项目不再读取任何外部配置文件（config.toml / .env）：
需要调整超时、模型、上传限制或会话策略时，直接修改本文件中的常量，
然后重启服务即可生效。

敏感信息（API Key / Base URL）不放这里，它们由登录页面提交，
并加密保存在浏览器的会话 Cookie 中。
"""

from pathlib import Path
from typing import List


# ---------------------------------------------------------------- 服务
# 说明：host / port / reload 等服务启动参数写死在 main.py，避免第二处事实来源。
REQUEST_TIMEOUT: float = 180.0  # 单次调用 OpenAI 的超时时间（秒）
CORS_ORIGINS: List[str] = []  # 允许跨源访问的来源；留空表示仅同源可访问

# ---------------------------------------------------------------- 模型
MODEL: str = "gpt-image-2"  # 默认模型
AVAILABLE_MODELS: List[str] = [  # 前端模型切换器可选列表
    "gpt-image-2",
    "gpt-image-2.5",
]

# ---------------------------------------------------------------- 并发
# 同一时刻允许进行的 OpenAI 生成任务数。图片生成耗时长且容易被上游限流，
# 用信号量把并发限制在可控范围，超出的请求排队等待而不是直接失败。
MAX_CONCURRENT_GENERATIONS: int = 5

# ---------------------------------------------------------------- 限制
MAX_PROMPT_LENGTH: int = 4000  # 提示词最大字符数
MAX_SOURCE_FILES: int = 16  # 最多上传参考图数量
MAX_FILE_BYTES: int = 20 * 1024 * 1024  # 单文件大小上限（20 MB）

# ---------------------------------------------------------------- 会话
SESSION_MAX_AGE: int = 30 * 24 * 60 * 60  # 会话有效期（秒）= 30 天
SESSION_COOKIE_NAME: str = "inx_session"  # 会话 Cookie 名称

# ---------------------------------------------------------------- 资源
PROMPTS_DIR: Path = Path(__file__).parent / "prompts"  # 预设提示词模板目录

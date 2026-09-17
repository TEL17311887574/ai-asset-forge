"""项目配置。"""

from pathlib import Path

# OpenAI 模型
MODEL = "gpt-image-2"

# 请求超时（秒）
REQUEST_TIMEOUT = 180.0

# 提示词长度限制
MAX_PROMPT_LENGTH = 4000

# 最多上传原图数量
MAX_SOURCE_FILES = 16

# 单文件大小限制（字节）
MAX_FILE_BYTES = 20 * 1024 * 1024

# 会话有效期（秒）
SESSION_MAX_AGE = 30 * 24 * 60 * 60

# 预设提示词模板目录
PROMPTS_DIR = Path(__file__).parent / "prompts"
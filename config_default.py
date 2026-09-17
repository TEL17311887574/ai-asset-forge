"""兼容垫片：配置已迁移到 ``config.toml`` + ``config.py``。

保留本模块是为了让历史的 ``from config_default import ...`` 继续可用，
新代码请直接 ``from config import ...`` 或 ``import config``。
"""

from config import (  # noqa: F401
    AVAILABLE_MODELS,
    HOST,
    MAX_FILE_BYTES,
    MAX_PROMPT_LENGTH,
    MAX_SOURCE_FILES,
    MODEL,
    PORT,
    PROMPTS_DIR,
    RELOAD,
    REQUEST_TIMEOUT,
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
)
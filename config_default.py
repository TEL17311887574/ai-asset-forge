"""配置加载器：把 config_default.toml 装载为模块级常量（下游 import 不变）。

手改配置请编辑 config_default.toml（唯一事实源，带注释）；
本文件只是把 TOML 键翻译成原有常量名，不含任何默认值或业务逻辑。
"""

import tomli
from pathlib import Path

_REPO_ROOT = Path(__file__).parent
with open(_REPO_ROOT / "config_default.toml", "rb") as _f:
    _cfg = tomli.load(_f)

MODEL = _cfg["model"]["default"]
AVAILABLE_MODELS = _cfg["model"]["available"]
MAX_CONCURRENT_GENERATIONS = _cfg["generation"]["max_concurrent"]
MAX_PROMPT_LENGTH = _cfg["limits"]["max_prompt_length"]
MAX_SOURCE_FILES = _cfg["limits"]["max_source_files"]
MAX_FILE_BYTES = _cfg["limits"]["max_file_bytes"]
REQUEST_TIMEOUT = float(_cfg["limits"]["request_timeout_seconds"])
CORS_ORIGINS = _cfg["server"]["cors_origins"]
PROMPTS_DIR = Path(_cfg["paths"]["prompts"].replace("${REPO_ROOT}", str(_REPO_ROOT)))

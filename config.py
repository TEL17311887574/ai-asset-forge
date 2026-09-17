"""项目配置读取层。

配置项统一维护在根目录的 ``config.toml``，本模块负责加载并暴露为
模块级常量，供 ``main.py`` / ``auth`` / ``image`` 等直接 ``import``。

Python 3.9 没有标准库 ``tomllib``（3.11+ 才有），因此优先使用
``tomllib``，回退到第三方 ``tomli``，两者 API 完全一致。
"""

from pathlib import Path
from typing import Any, Dict, List

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # Python 3.9 / 3.10
    import tomli as tomllib


CONFIG_PATH = Path(__file__).parent / "config.toml"

# 提示词模板目录
PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_config(path: Path = CONFIG_PATH) -> Dict[str, Any]:
    """读取并解析 TOML 配置文件。"""
    if not path.exists():
        raise FileNotFoundError(f"配置文件不存在: {path}")
    with path.open("rb") as file:
        return tomllib.load(file)


_config = load_config()

_server: Dict[str, Any] = _config.get("server", {})
_models: Dict[str, Any] = _config.get("models", {})
_limits: Dict[str, Any] = _config.get("limits", {})
_session: Dict[str, Any] = _config.get("session", {})


# 服务
HOST: str = _server.get("host", "0.0.0.0")
PORT: int = int(_server.get("port", 3000))
REQUEST_TIMEOUT: float = float(_server.get("request_timeout", 180.0))
RELOAD: bool = bool(_server.get("reload", False))

# 模型
MODEL: str = _models.get("default", "gpt-image-2")
AVAILABLE_MODELS: List[str] = list(_models.get("available", [MODEL]))

# 限制
MAX_PROMPT_LENGTH: int = int(_limits.get("max_prompt_length", 4000))
MAX_SOURCE_FILES: int = int(_limits.get("max_source_files", 16))
MAX_FILE_BYTES: int = int(_limits.get("max_file_bytes", 20 * 1024 * 1024))

# 会话
SESSION_MAX_AGE: int = int(_session.get("max_age", 30 * 24 * 60 * 60))
SESSION_COOKIE_NAME: str = _session.get("cookie_name", "inx_session")
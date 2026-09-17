"""提示词模板管理。"""
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt_template(filename: str) -> str:
    """加载预设提示词模板。
    
    Args:
        filename: 模板文件名（如 "character_turnaround.txt"）
    
    Returns:
        str: 模板内容
    """
    template_path = PROMPTS_DIR / filename
    if not template_path.exists():
        raise FileNotFoundError(f"提示词模板不存在: {template_path}")
    
    return template_path.read_text(encoding="utf-8").strip()
"""预设模式（模板 + 槽位）的解析与拼装。

设计要点：
- 预设注册表在 config_default.toml 的 [presets.*]，模板正文在 prompts/*.txt。
- 模板里的 {{slot_id}} 由用户填入的值替换；未填则**删除该槽位所在的整行**
  （因此模板约定：每个槽位独占一行）。这样模型不会看到残留的占位符。
- 前端通过 /api/presets 拿到 label / 参考图范围 / 槽位定义并动态渲染，
  新增预设只需改 toml + 放模板，前后端都无需改代码。
"""

import re
from typing import Dict, List, Optional

from config_default import PRESETS, PROMPTS_DIR
from image.service import load_prompt_template

# {{slot_id}} —— 只允许字母、数字、下划线，避免误伤正文里的普通大括号。
_SLOT_PATTERN = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


def _default_ratios() -> List[str]:
    return []


def list_presets() -> List[Dict[str, object]]:
    """返回给前端的预设列表（按 order 升序）。

    只暴露渲染所需字段，不含模板正文——正文留在服务端。
    """
    items: List[Dict[str, object]] = []
    for preset_id, raw in PRESETS.items():
        slots = [
            {
                "id": str(slot.get("id", "")),
                "label": str(slot.get("label", "")),
                "hint": str(slot.get("hint", "")),
            }
            for slot in raw.get("slots", [])
            if slot.get("id")
        ]
        items.append(
            {
                "id": preset_id,
                "label": str(raw.get("label", preset_id)),
                "description": str(raw.get("description", "")),
                "minRefs": int(raw.get("min_refs", 0)),
                "maxRefs": int(raw.get("max_refs", 1)),
                "ratios": list(raw.get("ratios") or _default_ratios()),
                "order": int(raw.get("order", 100)),
                "slots": slots,
            }
        )
    items.sort(key=lambda item: (item["order"], item["label"]))
    return items


def get_preset(preset_id: str) -> Optional[Dict[str, object]]:
    """取单个预设的原始定义（含模板文件名）。"""
    raw = PRESETS.get(preset_id)
    if not raw:
        return None
    return {
        "id": preset_id,
        "template": str(raw.get("template", "")),
        "minRefs": int(raw.get("min_refs", 0)),
        "maxRefs": int(raw.get("max_refs", 1)),
        "slots": list(raw.get("slots", [])),
    }


def get_preset_ids() -> List[str]:
    """全部预设 ID（用于判断请求里的 mode 是否是预设）。"""
    return list(PRESETS.keys())


def render_template(template: str, values: Dict[str, str]) -> str:
    """把模板中的 {{slot}} 替换为用户输入；未填的槽位删除整行。

    删除整行的做法：按行处理，若该行含未填充的槽位占位符则整行丢弃。
    最后把连续空行压成一个，避免留下大段空白。
    """
    filled = {
        key: str(value).strip()
        for key, value in (values or {}).items()
        if value is not None and str(value).strip()
    }

    output_lines: List[str] = []
    for line in template.splitlines():
        slot_ids = _SLOT_PATTERN.findall(line)
        if slot_ids and not all(filled.get(slot_id) for slot_id in slot_ids):
            # 该行依赖至少一个未填槽位 → 整行删除。
            continue
        rendered = _SLOT_PATTERN.sub(lambda m: filled.get(m.group(1), ""), line)
        output_lines.append(rendered)

    # 压缩连续空行
    compressed: List[str] = []
    for line in output_lines:
        if not line.strip() and compressed and not compressed[-1].strip():
            continue
        compressed.append(line)
    return "\n".join(compressed).strip()


def build_preset_prompt(preset_id: str, user_prompt: str, slots: Dict[str, str]) -> str:
    """按预设拼装最终提示词：用户补充描述 + 模板（槽位已填充）。"""
    preset = get_preset(preset_id)
    if not preset:
        raise KeyError(f"未知预设: {preset_id}")
    template = load_prompt_template(preset["template"])
    rendered = render_template(template, slots)
    parts = [(user_prompt or "").strip(), rendered]
    return "\n\n".join(part for part in parts if part)

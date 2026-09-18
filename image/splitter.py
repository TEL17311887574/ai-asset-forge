"""宫格图拆分服务。

通过行/列投影找出贯穿整张图的直线白色网格线，再按包含线条和抗锯齿
过渡的实际边界裁剪子图。检测不到完整网格线时抛出可展示给前端的错误。
"""

import base64
from collections.abc import Sequence
from io import BytesIO

from fastapi import HTTPException
from PIL import Image

GRID_SPLIT_ERROR_MESSAGE = "未找到干净的白色网格线，无法拆分宫格图。"

WHITE_LINE_COVERAGE_RATIO = 0.72
# 从严到宽尝试多档白色阈值：先生成图常见的纯白线，再兼容压缩/导出后
# 略微发灰、但整体仍明显接近白色的分隔线。
WHITE_CHANNEL_THRESHOLDS = (247, 240, 232)
GRID_LINE_WIDTH_RANGE = (1, 32)
# 只识别远离画布边缘的内部分隔线；图片外框不算宫格分隔线。
GRID_BORDER_INSET_RATIO = 0.01
GRID_MIN_IMAGE_SIZE = 128
# 支持到 3×3；后续需要更多面板时调大该限制即可。
MAX_GRID_LINE_COUNT = 3
GRID_MIN_PANEL_SIZE = 64
# 白色线和内容之间常有一段抗锯齿过渡。按亮度把这些过渡像素并入线宽，
# 避免拆分后子图边缘留下半透明白边；最多只向外找 2 个像素。
GRID_LINE_FEATHER_MAX = 2
GRID_TRANSITION_MIN_MEAN = 65
GRID_TRANSITION_MIN_CHANNEL = 50


def _encode_jpeg_data_url(image: Image.Image) -> str:
    """把拆分结果编码为前端可直接展示的 JPEG data URL。"""
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def _is_white(pixel: Sequence[int], threshold: int) -> bool:
    """判断单个像素是否达到指定档位的“接近白色”阈值。"""
    return all(channel >= threshold for channel in pixel)


def _white_projection(
    lines: Sequence[Sequence[tuple[int, int, int]]],
    threshold: int,
) -> list[tuple[int, int]]:
    """把某一方向上连续的白色坐标合并为闭区间。

    ``lines`` 中的每一项表示一条扫描线。水平检测时每项是一行像素，
    垂直检测时每项是一列像素。
    """
    line_count = len(lines[0]) if lines else 0
    required_white_count = int(line_count * WHITE_LINE_COVERAGE_RATIO)
    ranges: list[tuple[int, int]] = []
    start = -1

    for position, line in enumerate(lines):
        white_count = sum(1 for pixel in line if _is_white(pixel, threshold))
        if white_count >= required_white_count:
            if start < 0:
                start = position
        elif start >= 0:
            ranges.append((start, position - 1))
            start = -1

    if start >= 0:
        ranges.append((start, len(lines) - 1))
    return ranges


def _is_transition_line(line: Sequence[tuple[int, int, int]]) -> bool:
    """判断一条扫描线是否是白线旁边的抗锯齿过渡。"""
    channel_minima = [min(pixel) for pixel in line]
    ordered = sorted(channel_minima)
    low_value = ordered[int((len(ordered) - 1) * 0.1)]
    average = sum(channel_minima) / len(channel_minima)
    return (
        average >= GRID_TRANSITION_MIN_MEAN
        and low_value >= GRID_TRANSITION_MIN_CHANNEL
    )


def _expand_line_range(
    line_range: tuple[int, int],
    lines: Sequence[Sequence[tuple[int, int, int]]],
) -> tuple[int, int]:
    """把检测到的白线核心范围扩展到包含两侧抗锯齿像素。"""
    start, end = line_range

    for _ in range(GRID_LINE_FEATHER_MAX):
        candidate = start - 1
        if candidate < 0 or not _is_transition_line(lines[candidate]):
            break
        start = candidate

    for _ in range(GRID_LINE_FEATHER_MAX):
        candidate = end + 1
        if candidate >= len(lines) or not _is_transition_line(lines[candidate]):
            break
        end = candidate

    return start, end


def _grid_line_ranges(
    ranges: Sequence[tuple[int, int]],
    length: int,
) -> list[tuple[int, int]]:
    """过滤出有效的内部分隔线范围。"""
    border_inset = max(1, int(length * GRID_BORDER_INSET_RATIO))
    min_width, max_width = GRID_LINE_WIDTH_RANGE
    line_ranges: list[tuple[int, int]] = []

    for start, end in ranges:
        width = end - start + 1
        is_internal = start >= border_inset and end <= length - 1 - border_inset
        if min_width <= width <= max_width and is_internal:
            line_ranges.append((start, end))
    return line_ranges


def _validate_grid_lines(
    horizontal_lines: Sequence[tuple[int, int]],
    vertical_lines: Sequence[tuple[int, int]],
    width: int,
    height: int,
) -> None:
    """校验任意 M×N 宫格；至少 1 横 1 竖，最多支持到 4×4。"""
    if not (1 <= len(horizontal_lines) <= MAX_GRID_LINE_COUNT):
        raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)
    if not (1 <= len(vertical_lines) <= MAX_GRID_LINE_COUNT):
        raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)
    if width < GRID_MIN_IMAGE_SIZE or height < GRID_MIN_IMAGE_SIZE:
        raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)


def _tile_bounds(
    length: int,
    line_ranges: Sequence[tuple[int, int]],
) -> list[tuple[int, int]]:
    """根据扩展后的分隔线范围计算每个面板的起止边界。"""
    bounds: list[tuple[int, int]] = []
    start = 0

    for line_start, line_end in line_ranges:
        end = line_start
        if end - start < GRID_MIN_PANEL_SIZE:
            raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)
        bounds.append((start, end))
        start = line_end + 1

    if length - start < GRID_MIN_PANEL_SIZE:
        raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)
    bounds.append((start, length))
    return bounds


def _crop_without_lines(
    image: Image.Image,
    row_bounds: tuple[int, int],
    column_bounds: tuple[int, int],
) -> Image.Image:
    """按面板边界裁剪；边界已包含整个网格线和抗锯齿过渡。"""
    top, bottom = row_bounds
    left, right = column_bounds

    if right - left < 1 or bottom - top < 1:
        raise HTTPException(status_code=422, detail=GRID_SPLIT_ERROR_MESSAGE)
    return image.crop((left, top, right, bottom))


def split_grid_image(image_data: bytes) -> list[tuple[str, str]]:
    """拆分带直线白色网格线的 M×N 宫格图。

    支持常见的 2×2、2×3、3×2 和 3×3。返回 ``(dataUrl, 文件名)`` 列表，
    图片顺序与画面阅读顺序一致。
    """
    try:
        with Image.open(BytesIO(image_data)) as source:
            image = source.convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="图片格式无效。") from exc

    width, height = image.size
    pixels = list(image.getdata())

    row_pixels = [
        [pixels[row_index * width + column_index] for column_index in range(width)]
        for row_index in range(height)
    ]
    column_pixels = [
        [pixels[row_index * width + column_index] for row_index in range(height)]
        for column_index in range(width)
    ]

    # 不同生成图里的线亮度不完全一致。先在最宽档位得到完整网格的行列
    # 数量，再选择能识别同样数量网格线的最严格阈值，避免漏掉其中一条线。
    horizontal_candidates: dict[int, list[tuple[int, int]]] = {}
    vertical_candidates: dict[int, list[tuple[int, int]]] = {}
    for threshold in WHITE_CHANNEL_THRESHOLDS:
        horizontal_candidates[threshold] = _grid_line_ranges(
            _white_projection(row_pixels, threshold),
            height,
        )
        vertical_candidates[threshold] = _grid_line_ranges(
            _white_projection(column_pixels, threshold),
            width,
        )

    widest_threshold = WHITE_CHANNEL_THRESHOLDS[-1]
    expected_horizontal_count = len(horizontal_candidates[widest_threshold])
    expected_vertical_count = len(vertical_candidates[widest_threshold])
    horizontal_ranges: list[tuple[int, int]] = []
    vertical_ranges: list[tuple[int, int]] = []
    for threshold in WHITE_CHANNEL_THRESHOLDS:
        if not (1 <= expected_horizontal_count <= MAX_GRID_LINE_COUNT):
            break
        if not (1 <= expected_vertical_count <= MAX_GRID_LINE_COUNT):
            break
        if (
            len(horizontal_candidates[threshold]) == expected_horizontal_count
            and len(vertical_candidates[threshold]) == expected_vertical_count
        ):
            horizontal_ranges = horizontal_candidates[threshold]
            vertical_ranges = vertical_candidates[threshold]
            break

    _validate_grid_lines(horizontal_ranges, vertical_ranges, width, height)

    horizontal_ranges = [
        _expand_line_range(line_range, row_pixels)
        for line_range in horizontal_ranges
    ]
    vertical_ranges = [
        _expand_line_range(line_range, column_pixels)
        for line_range in vertical_ranges
    ]
    row_bounds = _tile_bounds(height, horizontal_ranges)
    column_bounds = _tile_bounds(width, vertical_ranges)

    results: list[tuple[str, str]] = []
    for row_index, (top, bottom) in enumerate(row_bounds):
        for column_index, (left, right) in enumerate(column_bounds):
            tile = _crop_without_lines(
                image,
                (top, bottom),
                (left, right),
            )
            filename = f"grid-split-{row_index + 1}-{column_index + 1}.jpg"
            results.append((_encode_jpeg_data_url(tile), filename))
    return results

/**
 * 宫格图拆分：Canvas 版实现，等价替代原后端 image/splitter.py（Pillow 版）。
 *
 * 算法与原版逐条对齐：行/列投影找出贯穿整张图的直线白色网格线，
 * 再按「线宽 + 抗锯齿过渡」的实际边界裁剪子图。
 *
 * 所有阈值常量与原 splitter.py 保持一致，改动它们会改变拆分行为。
 */

const GRID_SPLIT_ERROR_MESSAGE = "未找到干净的白色网格线，无法拆分宫格图。";

const WHITE_LINE_COVERAGE_RATIO = 0.72;
// 从严到宽尝试多档白色阈值：先生成图常见的纯白线，再兼容压缩/导出后
// 略微发灰、但整体仍明显接近白色的分隔线。
const WHITE_CHANNEL_THRESHOLDS = [247, 240, 232];
const GRID_LINE_WIDTH_RANGE = [1, 32];
// 只识别远离画布边缘的内部分隔线；图片外框不算宫格分隔线。
const GRID_BORDER_INSET_RATIO = 0.01;
const GRID_MIN_IMAGE_SIZE = 128;
// 支持到 3×3；后续需要更多面板时调大该限制即可。
const MAX_GRID_LINE_COUNT = 3;
const GRID_MIN_PANEL_SIZE = 64;
// 白色线和内容之间常有一段抗锯齿过渡。按亮度把这些过渡像素并入线宽，
// 避免拆分后子图边缘留下半透明白边；最多只向外找 2 个像素。
const GRID_LINE_FEATHER_MAX = 2;
const GRID_TRANSITION_MIN_MEAN = 65;
const GRID_TRANSITION_MIN_CHANNEL = 50;

/** 拆分结果导出格式，对应原版 _encode_jpeg_data_url 的 quality=92。 */
const JPEG_QUALITY = 0.92;

function gridError() {
  return new Error(GRID_SPLIT_ERROR_MESSAGE);
}

/** 判断单个像素是否达到指定档位的「接近白色」阈值。 */
function isWhite(r, g, b, threshold) {
  return r >= threshold && g >= threshold && b >= threshold;
}

/**
 * 把某一方向上连续的白色坐标合并为闭区间。
 *
 * @param data   RGBA 像素数据
 * @param width  图像宽度
 * @param height 图像高度
 * @param axis   true = 检测水平线（逐行扫描）；false = 检测垂直线（逐列扫描）
 * @param threshold 白色阈值
 */
function whiteProjection(data, width, height, axis, threshold) {
  const lineCount = axis ? height : width;
  const scanCount = axis ? width : height;
  const requiredWhiteCount = Math.floor(scanCount * WHITE_LINE_COVERAGE_RATIO);
  const ranges = [];
  let start = -1;

  for (let position = 0; position < lineCount; position += 1) {
    let whiteCount = 0;
    for (let k = 0; k < scanCount; k += 1) {
      // 逐行扫描时坐标是 (x=k, y=position)；逐列扫描时是 (x=position, y=k)
      const x = axis ? k : position;
      const y = axis ? position : k;
      const offset = (y * width + x) * 4;
      if (isWhite(data[offset], data[offset + 1], data[offset + 2], threshold)) {
        whiteCount += 1;
      }
    }
    if (whiteCount >= requiredWhiteCount) {
      if (start < 0) start = position;
    } else if (start >= 0) {
      ranges.push([start, position - 1]);
      start = -1;
    }
  }

  if (start >= 0) ranges.push([start, lineCount - 1]);
  return ranges;
}

/** 过滤出有效的内部分隔线范围。 */
function gridLineRanges(ranges, length) {
  const borderInset = Math.max(1, Math.floor(length * GRID_BORDER_INSET_RATIO));
  const [minWidth, maxWidth] = GRID_LINE_WIDTH_RANGE;
  return ranges.filter(([start, end]) => {
    const lineWidth = end - start + 1;
    const isInternal = start >= borderInset && end <= length - 1 - borderInset;
    return lineWidth >= minWidth && lineWidth <= maxWidth && isInternal;
  });
}

/** 判断一条扫描线是否是白线旁边的抗锯齿过渡。 */
function isTransitionLine(data, width, height, axis, position) {
  const scanCount = axis ? width : height;
  const minima = new Array(scanCount);
  let total = 0;

  for (let k = 0; k < scanCount; k += 1) {
    const x = axis ? k : position;
    const y = axis ? position : k;
    const offset = (y * width + x) * 4;
    const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    minima[k] = minimum;
    total += minimum;
  }

  const ordered = [...minima].sort((a, b) => a - b);
  const lowValue = ordered[Math.floor((ordered.length - 1) * 0.1)];
  const average = total / scanCount;
  return average >= GRID_TRANSITION_MIN_MEAN && lowValue >= GRID_TRANSITION_MIN_CHANNEL;
}

/** 把检测到的白线核心范围扩展到包含两侧抗锯齿像素。 */
function expandLineRange([start, end], data, width, height, axis, lineCount) {
  let nextStart = start;
  let nextEnd = end;

  for (let i = 0; i < GRID_LINE_FEATHER_MAX; i += 1) {
    const candidate = nextStart - 1;
    if (candidate < 0) break;
    if (!isTransitionLine(data, width, height, axis, candidate)) break;
    nextStart = candidate;
  }

  for (let i = 0; i < GRID_LINE_FEATHER_MAX; i += 1) {
    const candidate = nextEnd + 1;
    if (candidate >= lineCount) break;
    if (!isTransitionLine(data, width, height, axis, candidate)) break;
    nextEnd = candidate;
  }

  return [nextStart, nextEnd];
}

/** 根据扩展后的分隔线范围计算每个面板的起止边界。 */
function tileBounds(length, lineRanges) {
  const bounds = [];
  let start = 0;

  for (const [lineStart, lineEnd] of lineRanges) {
    if (lineStart - start < GRID_MIN_PANEL_SIZE) throw gridError();
    bounds.push([start, lineStart]);
    start = lineEnd + 1;
  }

  if (length - start < GRID_MIN_PANEL_SIZE) throw gridError();
  bounds.push([start, length]);
  return bounds;
}

/**
 * 创建一个尺寸为 width×height 的 DOM canvas。
 *
 * 必须用 DOM canvas（而不是 OffscreenCanvas）：导出用 toDataURL()，
 * 它只存在于主线程 canvas 上；OffscreenCanvas 没有该方法（只有 convertToBlob）。
 * 拆分在用户点击时同步执行、数据来自本地文件，不存在阻塞主线程的问题。
 */
function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * 拆分带直线白色网格线的 M×N 宫格图。
 *
 * 支持常见的 2×2、2×3、3×2 和 3×3。返回对象数组，每项含
 * ``{ dataUrl, name }``，顺序与画面阅读顺序一致。
 *
 * @param {Blob|File} blob 待拆分的宫格图
 */
export async function splitGridImage(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("图片格式无效。");
  }

  const width = bitmap.width;
  const height = bitmap.height;
  if (width < GRID_MIN_IMAGE_SIZE || height < GRID_MIN_IMAGE_SIZE) throw gridError();

  // 原图 canvas：既用于读取像素，也作为裁剪的源。
  const source = createCanvas(width, height);
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();
  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 不同生成图里的线亮度不完全一致。先在最宽档位得到完整网格的行列
  // 数量，再选择能识别同样数量网格线的最严格阈值，避免漏掉其中一条线。
  const horizontalCandidates = new Map();
  const verticalCandidates = new Map();
  for (const threshold of WHITE_CHANNEL_THRESHOLDS) {
    horizontalCandidates.set(
      threshold,
      gridLineRanges(whiteProjection(data, width, height, true, threshold), height),
    );
    verticalCandidates.set(
      threshold,
      gridLineRanges(whiteProjection(data, width, height, false, threshold), width),
    );
  }

  const widestThreshold = WHITE_CHANNEL_THRESHOLDS[WHITE_CHANNEL_THRESHOLDS.length - 1];
  const expectedHorizontalCount = horizontalCandidates.get(widestThreshold).length;
  const expectedVerticalCount = verticalCandidates.get(widestThreshold).length;

  let horizontalRanges = [];
  let verticalRanges = [];
  for (const threshold of WHITE_CHANNEL_THRESHOLDS) {
    if (!(expectedHorizontalCount >= 1 && expectedHorizontalCount <= MAX_GRID_LINE_COUNT)) break;
    if (!(expectedVerticalCount >= 1 && expectedVerticalCount <= MAX_GRID_LINE_COUNT)) break;
    if (
      horizontalCandidates.get(threshold).length === expectedHorizontalCount &&
      verticalCandidates.get(threshold).length === expectedVerticalCount
    ) {
      horizontalRanges = horizontalCandidates.get(threshold);
      verticalRanges = verticalCandidates.get(threshold);
      break;
    }
  }

  // 校验任意 M×N 宫格；至少 1 横 1 竖，最多支持到 3×3。
  if (!(horizontalRanges.length >= 1 && horizontalRanges.length <= MAX_GRID_LINE_COUNT)) {
    throw gridError();
  }
  if (!(verticalRanges.length >= 1 && verticalRanges.length <= MAX_GRID_LINE_COUNT)) {
    throw gridError();
  }

  horizontalRanges = horizontalRanges.map((range) =>
    expandLineRange(range, data, width, height, true, height),
  );
  verticalRanges = verticalRanges.map((range) =>
    expandLineRange(range, data, width, height, false, width),
  );

  const rowBounds = tileBounds(height, horizontalRanges);
  const columnBounds = tileBounds(width, verticalRanges);

  const results = [];
  for (let rowIndex = 0; rowIndex < rowBounds.length; rowIndex += 1) {
    const [top, bottom] = rowBounds[rowIndex];
    for (let columnIndex = 0; columnIndex < columnBounds.length; columnIndex += 1) {
      const [left, right] = columnBounds[columnIndex];
      const tileWidth = right - left;
      const tileHeight = bottom - top;
      if (tileWidth < 1 || tileHeight < 1) throw gridError();

      const tile = createCanvas(tileWidth, tileHeight);
      tile
        .getContext("2d")
        .drawImage(source, left, top, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);

      results.push({
        dataUrl: tile.toDataURL("image/jpeg", JPEG_QUALITY),
        name: `grid-split-${rowIndex + 1}-${columnIndex + 1}.jpg`,
      });
    }
  }
  return results;
}

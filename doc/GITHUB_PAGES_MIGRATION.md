# Ai Asset Forge → 纯 GitHub Pages 迁移方案

> 目标：去掉 FastAPI 后端，让整个工具作为**纯静态站点**跑在 GitHub Pages 上，
> 浏览器直接调用上游 OpenAI 兼容接口。
>
> 前提（已与用户确认）：
> 1. 上游 API **允许跨域**（或可以被改成允许跨域）。
> 2. API Key 存浏览器 `localStorage`（明文），接受该风险。
> 3. **终态是纯静态**：先用 `docs/` 双轨跑通，验证通过后**删除全部 Python 后端**。

---

## 一、可行性结论

**可行，但有三个必须接受的代价。**

原后端只做六件事，其中五件是转发或常量，只有宫格拆分是真正的算法：

| 后端能力 | 现状实现 | 纯静态替代 | 难度 |
| --- | --- | --- | --- |
| 静态托管 | `StaticFiles(html=True)` | GitHub Pages 直接托管 `public/` | 无 |
| API Key 保存 | Fernet 加密 + httpOnly Cookie | `localStorage` **明文** | 无（但安全性下降） |
| `/api/generate` | 服务端转发 | `fetch` 直连 `{baseURL}/images/generations` | 低 |
| `/api/edit` | 服务端转发 multipart | `fetch` 直连 `{baseURL}/images/edits` | 低 |
| 提示词模板 | 读 `prompts/*.txt` | 内联进 JS（合计约 3 KB） | 无 |
| `/api/models`、`/api/health` | 读配置常量 | 前端常量数组 | 无 |
| `/api/split-grid` | Pillow，255 行算法 | **Canvas 重写** | 中 |

**三个代价：**

1. **API Key 明文暴露在浏览器**。任何人拿到本机访问权或 XSS 即可读走 Key；
   原方案的加密 Cookie 保护完全消失。这是纯静态的物理限制，无法绕过
   （除非引入中转服务，那就不是"纯" Pages 了）。
2. **CORS 完全依赖上游**。上游一旦收紧跨域策略，站点立即全盘失效，
   且前端无法自救。
3. **并发闸门消失**。原来的 `MAX_CONCURRENT_GENERATIONS = 5` 信号量在后端，
   改成前端后用 Promise 队列模拟，但只在**当前标签页**内有效，
   多开标签页仍可能超限。

---

## 二、目录结构改造

**分两期走**：一期用 `docs/` 双轨并存（后端随时能对照回滚），
**二期验证通过后删干净，仓库根目录即站点**。

### 一期（过渡态）：双轨并存

```
AI_资产生成/
├── docs/                      # ← GitHub Pages 发布目录（新增）
│   ├── index.html             #   从 public/ 复制 + 改路径
│   ├── app.js                 #   去掉所有 /api/ 调用
│   ├── styles.css             #   原样复制
│   ├── config.js              #   新增：前端配置
│   ├── prompt-templates.js    #   新增：内联提示词模板
│   ├── api-client.js          #   新增：直连上游
│   ├── grid-splitter.js       #   新增：Canvas 宫格拆分
│   ├── .nojekyll              #   必须！否则 _ 开头的文件被 Jekyll 吞掉
│   └── vendor/lucide/lucide.min.js
├── public/                    # 过渡期保留：后端版本可对照
├── auth/ image/ main.py ...   # 过渡期保留：本地后端可回滚
└── .github/workflows/pages.yml
```

### 二期（终态）：删干净，根目录即站点

验证清单全绿后执行：

```bash
# 1. 把 docs/ 的内容提到仓库根目录
git mv docs/index.html  ./index.html
git mv docs/app.js      ./app.js
git mv docs/styles.css  ./styles.css
git mv docs/config.js   ./config.js
git mv docs/prompt-templates.js ./prompt-templates.js
git mv docs/api-client.js       ./api-client.js
git mv docs/grid-splitter.js    ./grid-splitter.js
git mv docs/.nojekyll   ./.nojekyll
git mv docs/vendor      ./vendor
rmdir docs

# 2. 删除全部后端
git rm -r auth image prompts __pycache__ .ruff_cache
git rm main.py router.py config_default.py requirements.txt .auth-secret
git rm -r public          # 已被根目录版本取代

# 3. 更新 .gitignore：删掉 .auth-secret 等后端条目
```

终态结构：

```
AI_资产生成/
├── index.html
├── app.js  styles.css  config.js
├── prompt-templates.js  api-client.js  grid-splitter.js
├── vendor/lucide/lucide.min.js
├── .nojekyll
├── .github/workflows/pages.yml
└── README.md
```

> Pages 的发布目录随之从 `/docs` 改为 `/`（仓库根）。见第四节。
>
> **删干净前的最后一道保险**：确认 `grep -rn "/api/" *.js *.html` 无输出，
> 且线上站点全流程跑通。删了就回不去了（虽然 Git 历史里还在）。

---

## 三、逐文件改动清单

### 3.1 `index.html`

**改动点：把绝对路径改成相对路径。**

```diff
-    <script src="/vendor/lucide/lucide.min.js"></script>
-    <script type="module" src="/app.js"></script>
+    <script src="./vendor/lucide/lucide.min.js"></script>
+    <script type="module" src="./app.js"></script>
```

同时检查 `<link rel="stylesheet" href="/styles.css">` 以及所有
`href="/..."` / `src="/..."`（favicon、图片等），**全部改成 `./` 开头**。

> 原因：Pages 部署在 `https://<user>.github.io/<repo>/` 子路径下，
> 绝对路径 `/app.js` 会指向 `https://<user>.github.io/app.js` → 404。

新增 `.nojekyll`（空文件即可），否则 Jekyll 构建会忽略某些文件。

### 3.2 新增 `docs/config.js` —— 前端配置单一来源

替代 `config_default.py`：

```js
// 纯前端配置：替代原 config_default.py
export const CONFIG = {
  defaultBaseURL: "https://your-api.example.com/v1", // 用户仍可在登录框改
  defaultModel: "gpt-image-2",
  availableModels: ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"],
  maxConcurrentGenerations: 5,
  maxPromptLength: 4000,
  maxSourceFiles: 16,
  maxFileBytes: 20 * 1024 * 1024,
  requestTimeoutMs: 180000,
};
```

### 3.3 新增 `docs/prompt-templates.js` —— 内联模板

把 `prompts/character_turnaround.txt`（2134 B）与 `prompts/scene_multiview.txt`（847 B）
的内容原样拷进 JS 模板字符串，替代后端的 `load_prompt_template()`：

```js
export const PROMPT_TEMPLATES = {
  characterTurnaround: `...原样粘贴 character_turnaround.txt...`,
  sceneMultiView: `...原样粘贴 scene_multiview.txt...`,
};
```

对应替换后端 `build_character_turnaround_prompt()` / `build_scene_multi_view_prompt()`
的拼接逻辑（`[userPrompt, template].filter(Boolean).join("\n\n")`）。

### 3.4 新增 `docs/api-client.js` —— 直连上游

替代 `image/service.py` + `image/router.py` + `auth/session.py`。
**注意：浏览器不能像 SDK 那样直接传 `file` 对象给 JSON 接口，必须用 `FormData`。**

```js
import { CONFIG } from "./config.js";
import { PROMPT_TEMPLATES } from "./prompt-templates.js";

export function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

// ---- 文生图：JSON 直连 ----
export async function generateImage({ apiKey, baseURL, prompt, size, quality, n, model }) {
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify({ model, prompt, size, quality, n, response_format: "b64_json" }),
  });
  return parseImages(await readJson(response));
}

// ---- 图生图：multipart 直连 ----
export async function editImage({ apiKey, baseURL, prompt, images, size, quality, inputFidelity, n, mask, model }) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("input_fidelity", inputFidelity);
  form.append("n", String(n));
  form.append("response_format", "b64_json");
  // ✅ 字段名已从现有代码确认（见下方说明）：重复的 "image"，不是 "image[]"
  images.forEach((blob, i) => form.append("image", blob, `image-${i + 1}.png`));
  if (mask) form.append("mask", mask, "mask.png");
  const response = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: authHeaders(apiKey), // ⚠️ 不要手动设 Content-Type，交给浏览器加 boundary
    body: form,
  });
  return parseImages(await readJson(response));
}

function parseImages(payload) {
  return (payload?.data || [])
    .map((item) => ({
      dataUrl: item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url || "",
      revisedPrompt: item.revised_prompt || "",
    }))
    .filter((item) => item.dataUrl);
}

async function readJson(response) {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) {
    // 尽量还原后端的友好错误文案
    const message = payload?.error?.message || payload?.error || text || `请求失败（HTTP ${response.status}）`;
    const error = new Error(typeof message === "string" ? message : "请求失败");
    error.status = response.status;
    throw error;
  }
  return payload;
}
```

> ✅ **多图字段名：已从现有代码确认，无需实测。**
>
> 证据链：
> - 前端 `public/app.js:3038-3040` 循环 `data.append("image", file, ...)` 追加多张图；
> - 后端 `image/router.py:79` 用 `Annotated[list[UploadFile], Form(alias="image")]` 接收，
>   即**同名字段重复出现**会被 FastAPI 收集成 list；
> - 后端确实能收到多图（否则图生图多图参考根本用不了）。
>
> 所以新代码**沿用重复的 `image`，不要改成 `image[]`**，与后端行为保持一致。
>
> 另有一处**现存不一致**需注意：蒙版多图路径前端发的是 `mask[]`（`app.js:3055`）
> 加一个 `mask_count`，但后端 `image/router.py:87` 只声明了**单个** `mask` 参数，
> **后端根本收不到 `mask[]` 和 `mask_count`**，多张蒙版实际上是被丢弃的。
> 迁移时请一并确认这是否是有意为之；若需要修复，这属于独立的问题，
> 不要混进本次迁移（避免把迁移和 bug 修复搅在一起无法定位）。

新增**前端并发闸门**（替代后端信号量）：

```js
let running = 0;
const queue = [];
export function withGenerationSlot(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running += 1;
      try { resolve(await task()); }
      catch (error) { reject(error); }
      finally {
        running -= 1;
        if (queue.length) queue.shift()();
      }
    };
    if (running < CONFIG.maxConcurrentGenerations) run();
    else queue.push(run);
  });
}
```

### 3.5 `docs/app.js` —— 替换 7 处调用点

原文件里所有后端交互点如下（行号对应改造前的 `public/app.js`）：

| 原行号 | 原调用 | 改成 |
| --- | --- | --- |
| 367 | `fetch("/api/auth/session")` | 读 `localStorage`，返回 `{authenticated: !!apiKey}` |
| 807 | `fetch("/api/split-grid")` | 本地 `splitGridImage(blob)`（见 3.6） |
| 3023 | `fetch("/api/generate")` | `withGenerationSlot(() => generateImage(...))` |
| 3062 | `fetch("/api/edit")` | `withGenerationSlot(() => editImage(...))` |
| 3668 | `fetch("/api/auth/logout")` | 清 `localStorage` |
| 3679 | `fetch("/api/auth/login")` | 校验格式后写 `localStorage` |
| 3752 | `fetch("/api/health")` | 按本地是否有 Key 显示状态 |
| 3765 | `fetch("/api/models")` | `CONFIG.availableModels` |

登录改造（关键：**没有服务端校验了，只能校验格式**）：

```js
const STORAGE_KEY = "ai-asset-forge.auth";

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}
function saveAuth(apiKey, baseURL) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseURL, savedAt: Date.now() }));
}
function clearAuth() { localStorage.removeItem(STORAGE_KEY); }
function normalizeBaseURL(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Base URL 格式不正确。"); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL 必须使用 http 或 https。");
  return url.toString().replace(/\/+$/, "");
}
```

> ✅ **Base URL：已从现有代码确认，保持原行为 —— 不自动补 `/v1`。**
>
> 证据链：
> - 后端 `auth/router.py:47-55` 的 `_normalize_base_url()` **只做**
>   `urlparse` 校验 + `rstrip("/")`，**没有任何补 `/v1` 的逻辑**；
> - 前端 `index.html:335` 的输入框默认值就是完整地址
>   `https://xfastapi.ai/v1`，`placeholder` 也提示 `https://.../v1`。
>
> 即：**用户填什么就是什么**，UI 已经通过默认值和 placeholder 引导用户带 `/v1`。
> 前端迁移时照抄这个行为即可，**不要自作主张补 `/v1`**——那会改变现有语义，
> 万一上游挂载点不是 `/v1` 反而搞坏。

### 3.6 新增 `docs/grid-splitter.js` —— Canvas 重写宫格拆分

这是**唯一需要真正重写逻辑**的部分。后端 `image/splitter.py` 用 Pillow 做
行/列投影找白色直线。浏览器等价物是 Canvas `getImageData`。

**算法逐条对应（务必保持阈值一致，否则行为会变）：**

```js
import { CONFIG } from "./config.js";

const WHITE_CHANNEL_THRESHOLDS = [247, 240, 232];
const WHITE_LINE_COVERAGE_RATIO = 0.72;
const GRID_LINE_WIDTH_RANGE = [1, 32];
const GRID_BORDER_INSET_RATIO = 0.01;
const GRID_MIN_IMAGE_SIZE = 128;
const MAX_GRID_LINE_COUNT = 3;
const GRID_MIN_PANEL_SIZE = 64;
const GRID_LINE_FEATHER_MAX = 2;
const GRID_TRANSITION_MIN_MEAN = 65;
const GRID_TRANSITION_MIN_CHANNEL = 50;

const GRID_SPLIT_ERROR_MESSAGE = "未找到干净的白色网格线，无法拆分宫格图。";

export async function splitGridImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  if (width < GRID_MIN_IMAGE_SIZE || height < GRID_MIN_IMAGE_SIZE) {
    throw new Error(GRID_SPLIT_ERROR_MESSAGE);
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  // ---- 工具：取像素（RGB）----
  const pixelAt = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const isWhite = (rgb, threshold) => rgb[0] >= threshold && rgb[1] >= threshold && rgb[2] >= threshold;

  // ---- 投影：沿 rows/cols 找连续满足覆盖率的区间 ----
  const project = (getLine, lineCount, scanCount, threshold) => {
    const required = Math.floor(scanCount * WHITE_LINE_COVERAGE_RATIO);
    const ranges = [];
    let start = -1;
    for (let pos = 0; pos < lineCount; pos += 1) {
      let whiteCount = 0;
      for (let k = 0; k < scanCount; k += 1) {
        if (isWhite(getLine(pos, k), threshold)) whiteCount += 1;
      }
      if (whiteCount >= required) {
        if (start < 0) start = pos;
      } else if (start >= 0) {
        ranges.push([start, pos - 1]);
        start = -1;
      }
    }
    if (start >= 0) ranges.push([start, lineCount - 1]);
    return ranges;
  };

  // 水平线：遍历每一行 y，横向扫 x
  const rowLine = (y, x) => pixelAt(x, y);
  // 垂直线：遍历每一列 x，纵向扫 y
  const colLine = (x, y) => pixelAt(x, y);

  const filterRanges = (ranges, length) => {
    const inset = Math.max(1, Math.floor(length * GRID_BORDER_INSET_RATIO));
    const [minW, maxW] = GRID_LINE_WIDTH_RANGE;
    return ranges.filter(([s, e]) => {
      const w = e - s + 1;
      return w >= minW && w <= maxW && s >= inset && e <= length - 1 - inset;
    });
  };

  // ---- 多档阈值：用最宽档确定线数，再挑能识别同样线数的最严档（与后端一致）----
  const hCand = {}, vCand = {};
  for (const t of WHITE_CHANNEL_THRESHOLDS) {
    hCand[t] = filterRanges(project(rowLine, height, width, t), height);
    vCand[t] = filterRanges(project(colLine, width, height, t), width);
  }
  const widest = WHITE_CHANNEL_THRESHOLDS[WHITE_CHANNEL_THRESHOLDS.length - 1];
  const expectH = hCand[widest].length;
  const expectV = vCand[widest].length;
  let hRanges = [], vRanges = [];
  for (const t of WHITE_CHANNEL_THRESHOLDS) {
    if (!(expectH >= 1 && expectH <= MAX_GRID_LINE_COUNT)) break;
    if (!(expectV >= 1 && expectV <= MAX_GRID_LINE_COUNT)) break;
    if (hCand[t].length === expectH && vCand[t].length === expectV) {
      hRanges = hCand[t];
      vRanges = vCand[t];
      break;
    }
  }
  if (!(hRanges.length >= 1 && hRanges.length <= MAX_GRID_LINE_COUNT)) throw new Error(GRID_SPLIT_ERROR_MESSAGE);
  if (!(vRanges.length >= 1 && vRanges.length <= MAX_GRID_LINE_COUNT)) throw new Error(GRID_SPLIT_ERROR_MESSAGE);

  // ---- 抗锯齿过渡扩展（复用后端 _is_transition_line）----
  const isTransitionLine = (getLine, index, scanCount) => {
    const minima = [];
    for (let k = 0; k < scanCount; k += 1) {
      const [r, g, b] = getLine(index, k);
      minima.push(Math.min(r, g, b));
    }
    const ordered = [...minima].sort((a, b) => a - b);
    const lowValue = ordered[Math.floor((ordered.length - 1) * 0.1)];
    const average = minima.reduce((a, b) => a + b, 0) / minima.length;
    return average >= GRID_TRANSITION_MIN_MEAN && lowValue >= GRID_TRANSITION_MIN_CHANNEL;
  };
  const expand = ([s, e], getLine, lineCount, scanCount) => {
    let start = s, end = e;
    for (let i = 0; i < GRID_LINE_FEATHER_MAX; i += 1) {
      const c = start - 1;
      if (c < 0 || !isTransitionLine(getLine, c, scanCount)) break;
      start = c;
    }
    for (let i = 0; i < GRID_LINE_FEATHER_MAX; i += 1) {
      const c = end + 1;
      if (c >= lineCount || !isTransitionLine(getLine, c, scanCount)) break;
      end = c;
    }
    return [start, end];
  };
  hRanges = hRanges.map((r) => expand(r, rowLine, height, width));
  vRanges = vRanges.map((r) => expand(r, colLine, width, height));

  // ---- 面板边界 ----
  const tileBounds = (length, ranges) => {
    const bounds = [];
    let start = 0;
    for (const [ls, le] of ranges) {
      if (ls - start < GRID_MIN_PANEL_SIZE) throw new Error(GRID_SPLIT_ERROR_MESSAGE);
      bounds.push([start, ls]);
      start = le + 1;
    }
    if (length - start < GRID_MIN_PANEL_SIZE) throw new Error(GRID_SPLIT_ERROR_MESSAGE);
    bounds.push([start, length]);
    return bounds;
  };
  const rowBounds = tileBounds(height, hRanges);
  const colBounds = tileBounds(width, vRanges);

  // ---- 裁剪并导出 JPEG（质量 92，与后端一致）----
  const results = [];
  for (let r = 0; r < rowBounds.length; r += 1) {
    for (let c = 0; c < colBounds.length; c += 1) {
      const [top, bottom] = rowBounds[r];
      const [left, right] = colBounds[c];
      const w = right - left, h = bottom - top;
      if (w < 1 || h < 1) throw new Error(GRID_SPLIT_ERROR_MESSAGE);
      const tile = new OffscreenCanvas(w, h);
      tile.getContext("2d").drawImage(canvas, left, top, w, h, 0, 0, w, h);
      const out = await tile.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      results.push({
        blob: out,
        dataUrl: await blobToDataUrl(out),
        name: `grid-split-${r + 1}-${c + 1}.jpg`,
      });
    }
  }
  return results;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}
```

**注意事项：**

- `OffscreenCanvas` 在 Safari 上支持较晚（16.4+）。若要兼容更老的浏览器，
  用 `document.createElement("canvas")` 替代。
- `getImageData` 读 canvas：因为图片来自用户本地文件/`data:` URL，
  不涉及跨域污染，**不会触发 tainted canvas**。但若将来改成直接从
  远端 URL 画图，必须给图片加 `crossOrigin="anonymous"`，否则
  `getImageData` 会抛 `SecurityError`。
- `new OffscreenCanvas(w, h)` 在较老实现里可能不支持 2 参数构造，
  稳妥写法是创建后赋 `width`/`height`。
- 原后端的 `MAX_GRID_LINE_COUNT = 3`（即最多 4×4），保持一致。

### 3.7 删除/保留

- **删除**：`docs/` 下不需要 `auth/`、`image/`、`main.py` 等。
- `requirements.txt`、`config_default.py` 等保留在仓库根目录供后端版本使用。

---

## 四、GitHub Pages 部署

### 4.1 方式 A：仓库设置直接发布（最简单）

**一期**：把静态文件放在 `docs/`。
仓库 **Settings → Pages** → Source: `Deploy from a branch` →
Branch: `main`，目录选 **`/docs`**。

**二期（删干净后）**：静态文件已在根目录，目录改选 **`/ (root)`** 即可。

访问 `https://<user>.github.io/<repo>/`。

### 4.2 方式 B：GitHub Actions（推荐，可控）

`.github/workflows/pages.yml`：

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs          # 一期用 docs/；二期删干净后改成 `.`
      - id: deployment
        uses: actions/deploy-pages@v4
```

> 如果以后想加打包（比如把 JS 打包压缩），在 upload 之前加
> `actions/setup-node` + `npm ci && npm run build`，把 `path` 指向产物目录。

### 4.3 私有仓库提醒

GitHub Pages 对**私有仓库**的支持取决于账户套餐（Free 账户的私有仓库
无法发布 Pages，或只能发布到组织内可见）。如果仓库是私有的，
先确认套餐是否允许，否则需要改成公开仓库。

---

## 五、验证清单（上线前逐条过）

**第 0 步最关键 —— 先验证 CORS，不要写代码：**

```bash
# 预检请求：必须看到 access-control-allow-origin
curl -i -X OPTIONS "https://<你的BASE_URL>/images/generations" \
  -H "Origin: https://<user>.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

# 真实请求
curl -i -X POST "https://<你的BASE_URL>/images/generations" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Origin: https://<user>.github.io" \
  -d '{"model":"gpt-image-2","prompt":"a cat","size":"1024x1024","n":1,"response_format":"b64_json"}'
```

若预检响应里没有 `access-control-allow-origin`（或不等同于你的 Origin），
**纯 Pages 方案不成立**，必须退回中转方案（见第六节）。

**其余检查项：**

- [ ] 页面能打开，无 404（重点看 `app.js`、`vendor/lucide`、`styles.css`）
- [ ] 登录框保存 Key 后刷新仍在（localStorage 生效）
- [ ] 文生图能出图
- [ ] 图生图能出图（含多图参考）
- [ ] 蒙版编辑能出图
- [ ] 宫格拆分结果与后端版本**逐像素一致**（用同一张图对比）
- [ ] 角色三视图 / 场景多视角模板拼接结果包含完整模板文本
- [ ] 退出登录后 Key 被清除
- [ ] 多标签页并发不炸（前端闸门只在单标签页有效，需实测）
- [ ] 移动端布局正常

---

## 六、如果 CORS 不成立：退回中转方案

保留 Pages 作为前端，另加一个极薄的中转（**这不是"纯" Pages，但最稳**）：

| 方案 | 免费额度 | 特点 |
| --- | --- | --- |
| Cloudflare Workers | 10 万请求/天 | 最推荐，全球边缘节点，改 CORS 头方便 |
| Vercel / Netlify Functions | 较宽松 | 与 Git 集成好 |
| Deno Deploy | 较宽松 | 部署简单 |

Worker 只需做三件事：① 剥离/改写 CORS 头 ② 注入 API Key
（此时 Key 不必存浏览器，安全性反而**优于**纯静态）③ 转发到上游。

> 这种架构下，前端仍需改造成不依赖 `/api/*` 的相对路径，
> 但登录逻辑可以简化——Key 放在 Worker 的环境变量里。

---

## 七、建议的实施顺序

1. **先验 CORS**（第 0 步）。不通就别往下走，直接看第六节。
2. 复制 `public/` → `docs/`，改 `index.html` 相对路径，加 `.nojekyll`。
3. 加 `config.js`、`prompt-templates.js`，把配置和模板搬过去。
4. 加 `api-client.js` + 并发闸门，改 `app.js` 的登录与生成调用。
5. 加 `grid-splitter.js`，改拆分调用点。
6. 删除 `app.js` 里所有 `/api/` 残留（用 `grep -n "/api/"` 兜底确认）。
7. 本地用 `python -m http.server` 在 `docs/` 下起静态服务，
   **在 `localhost` 上先跑通全流程**（此时 Origin 是 localhost，
   记得确认上游也允许它，或者临时用支持 CORS 的测试 API）。
8. 推送到 GitHub，开 Pages，按第五节清单验证。

---

## 八、决策记录（已定案）

| # | 问题 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | 多图 `/images/edits` 字段名 | **重复的 `image`**，不用 `image[]` | `app.js:3038-3040` 循环 append + `image/router.py:79` 的 `Form(alias="image")` |
| 2 | Base URL 是否自动补 `/v1` | **不补**，保持原行为 | `auth/router.py:47-55` 只做 `rstrip("/")`；`index.html:335` 默认值已含 `/v1` |
| 3 | Python 后端留不留 | **一期双轨跑通，二期删干净** | 用户决定 |

`BASE_URL` 输入框保持现状：

```html
<input id="authBaseURL" name="baseURL" type="url" required
       value="https://xfastapi.ai/v1" placeholder="https://.../v1" />
```

> 注意：`value` 里硬编码的 `https://xfastapi.ai/v1` 是**你当前的上游地址**。
> 迁移到公开的 Pages 站点前，考虑是否要把它清空或换成中立占位，
> 避免把内网/私有地址暴露在公开页面上。

**仍待你实测的一项**：第 0 步的 CORS 预检。这是唯一无法从代码推断、
且决定整个方案成立与否的前提。

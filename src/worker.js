/**
 * Worker 入口（零状态版）。
 *
 * 职责只剩两件事：
 *   1. /api/generate、/api/edit —— 把浏览器的请求原样转发给用户指定的上游
 *      （API Key 与 Base URL 由浏览器保险库随请求头提供，Worker 不落盘）；
 *   2. 其余路径 —— 托管 public/ 静态前端（Workers Assets）。
 *
 * 没有 KV、没有 secret、没有会话；部署只需 `npx wrangler deploy`。
 */

const CONFIG = {
  /** 单次调用上游的超时时间（毫秒）。 */
  REQUEST_TIMEOUT_MS: 180_000,
  /** 默认模型。 */
  MODEL: "gpt-image-2",
  /** 前端模型切换器可选列表。 */
  AVAILABLE_MODELS: ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"],
  /** 提示词最大字符数。 */
  MAX_PROMPT_LENGTH: 4000,
  /** 最多上传参考图数量。 */
  MAX_SOURCE_FILES: 16,
};

/** 提示词模板：内容与 prompts/*.txt 一致。 */
const TEMPLATES = {
  "character_turnaround.txt": `无论参考图中出现何种背景（白色、户外或任何环境），都将其完全替换，并将最终输出渲染为高级工作室肖像双联图，使用纯白无缝背景。白色背景必须在所有面板中完全一致，绝对没有环境元素、阴影或渐变。

生成一张采用非对称两部分布局的单一图像：

- 左面板（约总宽度的 1/3）：同一人物的近景上半身肖像（半身像），取景从头部到中躯干/腰部。人物必须面向镜头，呈严格正面直视视角——眼睛直视镜头，肩膀与画面平面完全平行，面部构图对称，头部无任何旋转或倾斜。姿态自然，展示面部表情、发型和上装细节。
- 右面板（约总宽度的 2/3）：同一人物的全身三视图正交组，在比例和垂直基线上精确对齐，包含：
  • 正面视图：从头到脚全身，面向镜头，中性站姿
  • 侧面视图：标准 90° 纯侧面，全身，自然姿态
  • 背面视图：后侧全身视图，展示后脑、躯干和腿部，并保持与其他两个视图相同的取景高度和脚部对齐

用一条细竖分隔线分开左、右面板。在右面板内，用另外两条细竖线分隔三个全身视图——所有线条笔直、间距均匀，呈现干净、极简的布局设计。

全程采用统一可控的工作室灯光：柔和但有方向性的主光，自然阴影塑形，真实明暗对比。对于左侧上半身肖像：清晰的眼睛细节、真实皮肤纹理和准确的面料渲染（严禁过度磨皮或喷枪修图）。对于右侧全身视图：三个角度光照逻辑一致，真实布料垂坠感，自然四肢比例，轮廓上的光线衰减准确。所有视图中头发纹理必须保持真实。

人物的身份、面部比例、发型、身体比例、服装和整体造型必须与参考图完全匹配；但是，所有面板的背景必须统一为相同的纯白工作室背景。

严格禁止添加任何文字、水印、标志、字幕、UI 元素、边框、面板标签（A/B/C/1/2/3）、角度标注、测量指南或任何其他形式的附加内容。`,
  "scene_multiview.txt": `以这张图片为参考，生成一组2×2网格的场景图，每个面板使用明显不同的摄像机角度，添加干净的1pt白色网格线分隔所有画面（内部边缘线，不要双重加粗）。所有面板必须展示相同的环境。任何面板中都不应出现角色或人物。第一行（从左到右）：1. 正面视角：直接面向场景的平视视角。2. 仰视视角：陡峭的仰视视角，相机从水平面向上倾斜60度，从左到右水平排列。3. 特写镜头：聚焦环境关键部分的紧凑详细视角，填充大部分画面。4. 俯视广角镜头：从高处俯瞰场景的高角度视角，视野开阔。确保：每个面板的摄像机位置、高度和方向明显不同。透视变化强烈且明确。所有面板的光照和风格保持一致。不要在图片上写任何文字。`,
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error("未处理异常:", error?.stack || error);
  return json({ error: "服务器内部错误，请查看日志。" }, 500);
}

/** 从请求头提取凭据（由浏览器保险库提供）。 */
function extractCredentials(request) {
  const authorization = request.headers.get("Authorization") || "";
  const apiKey = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const baseURL = (request.headers.get("X-Upstream-Base-URL") || "").trim().replace(/\/+$/, "");
  if (!apiKey) throw new HttpError(401, "未登录或会话已失效，请重新登录。");
  if (!baseURL) throw new HttpError(400, "缺少上游接口地址（X-Upstream-Base-URL）。");
  return { apiKey, baseURL };
}

// ---------------------------------------------------------------- safe_* 校验（与 Python 版一致）

function cleanPrompt(text) {
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "提示词不能为空。");
  if (text.length > CONFIG.MAX_PROMPT_LENGTH) {
    throw new HttpError(400, `提示词不能超过 ${CONFIG.MAX_PROMPT_LENGTH} 字符。`);
  }
  return text.trim();
}

function safeOptionalPrompt(text) {
  return typeof text === "string" ? text.trim() : "";
}

function safeSize(value) {
  const allowed = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
  if (allowed.has(value)) return value;
  if (typeof value === "string") {
    const match = /^(\d{2,4})x(\d{2,4})$/.exec(value);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (
        width >= 64 && height >= 64 &&
        width <= 3840 && height <= 3840 &&
        width % 16 === 0 && height % 16 === 0 &&
        Math.max(width, height) / Math.min(width, height) <= 3 &&
        width * height <= 8_294_400
      ) {
        return `${width}x${height}`;
      }
    }
  }
  return "1024x1024";
}

function safeQuality(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function safeCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 1;
  return number >= 1 && number <= 4 ? number : 1;
}

function safeInputFidelity(value) {
  return ["low", "high"].includes(value) ? value : "low";
}

function safeModel(value) {
  return CONFIG.AVAILABLE_MODELS.includes(value) ? value : CONFIG.MODEL;
}

function buildPrompt(userPrompt, templateName) {
  const template = TEMPLATES[templateName];
  if (!template) throw new HttpError(500, `提示词模板缺失: ${templateName}`);
  return [userPrompt.trim(), template].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- 上游转发

async function callUpstream(apiKey, baseURL, path, body, isMultipart) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (!isMultipart) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers,
      body: isMultipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new HttpError(504, `上游超时（超过 ${CONFIG.REQUEST_TIMEOUT_MS / 1000} 秒）。`);
    }
    throw new HttpError(502, `无法连接上游接口：${error?.message || "网络错误"}`);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const raw = payload?.error?.message ?? payload?.error ?? text;
    const message = typeof raw === "string" && raw.trim() ? raw.trim() : `上游返回 HTTP ${response.status}`;
    throw new HttpError(response.status, message);
  }

  const images = (payload?.data || [])
    .map((item) => ({
      dataUrl: item.b64_json
        ? `data:image/png;base64,${item.b64_json}`
        : item.url || "",
      revisedPrompt: item.revised_prompt || "",
    }))
    .filter((item) => item.dataUrl);

  return { images };
}

// ---------------------------------------------------------------- 路由处理

async function handleGenerate(request) {
  const { apiKey, baseURL } = extractCredentials(request);
  const payload = await request.json().catch(() => null);
  if (!payload) throw new HttpError(400, "请求体不是合法 JSON。");

  const { images } = await callUpstream(apiKey, baseURL, "/images/generations", {
    model: safeModel(payload.model),
    prompt: cleanPrompt(payload.prompt),
    size: safeSize(payload.size),
    quality: safeQuality(payload.quality),
    n: safeCount(payload.n),
    response_format: "b64_json",
  }, false);
  return { images };
}

async function handleEdit(request) {
  const { apiKey, baseURL } = extractCredentials(request);
  const form = await request.formData();
  const files = form.getAll("image").filter((entry) => typeof entry === "object" && entry.arrayBuffer);
  if (!files.length) throw new HttpError(400, "请至少上传一张原图。");
  if (files.length > CONFIG.MAX_SOURCE_FILES) {
    throw new HttpError(400, `最多只能上传 ${CONFIG.MAX_SOURCE_FILES} 张图片。`);
  }

  const prompt = form.get("prompt");
  const mode = form.get("mode") || "edit";
  let finalPrompt;
  if (mode === "characterTurnaround") {
    finalPrompt = buildPrompt(safeOptionalPrompt(prompt), "character_turnaround.txt");
  } else if (mode === "sceneMultiView") {
    finalPrompt = buildPrompt(safeOptionalPrompt(prompt), "scene_multiview.txt");
  } else {
    finalPrompt = cleanPrompt(prompt);
  }

  // 与 Python 版一致：仅取单个 mask 字段。
  const mask = form.get("mask");
  const maskFile = mask && typeof mask === "object" && mask.arrayBuffer ? mask : null;

  const upstreamForm = new FormData();
  upstreamForm.append("model", safeModel(form.get("model")));
  upstreamForm.append("prompt", finalPrompt);
  upstreamForm.append("size", safeSize(form.get("size") || "1024x1024"));
  upstreamForm.append("quality", safeQuality(form.get("quality")));
  upstreamForm.append("input_fidelity", safeInputFidelity(form.get("input_fidelity")));
  upstreamForm.append("n", String(safeCount(form.get("n"))));
  upstreamForm.append("response_format", "b64_json");
  for (const file of files) {
    upstreamForm.append("image", file, file.name || "image.png");
  }
  if (maskFile) upstreamForm.append("mask", maskFile, "mask.png");

  const { images } = await callUpstream(apiKey, baseURL, "/images/edits", upstreamForm, true);
  return { images };
}

// ---------------------------------------------------------------- 入口

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (!path.startsWith("/api/")) {
        return await env.ASSETS.fetch(request);
      }

      if (path === "/api/generate" && method === "POST") return json(await handleGenerate(request));
      if (path === "/api/edit" && method === "POST") return json(await handleEdit(request));

      if (path === "/api/split-grid") {
        return json({ error: "宫格拆分已在前端本地完成，无需请求此接口。" }, 410);
      }

      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, configured: true, model: CONFIG.MODEL, baseURL: null });
      }
      if (path === "/api/models" && method === "GET") {
        return json({ default: CONFIG.MODEL, available: CONFIG.AVAILABLE_MODELS });
      }

      return json({ error: "接口不存在。" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

/**
 * Worker 入口（零状态版）。
 *
 * 职责只剩两件事：
 *   1. /api/generate、/api/edit —— 把浏览器的请求原样转发给用户指定的上游
 *      （API Key 与 Base URL 由浏览器保险库随请求头提供，Worker 不落盘）；
 *   2. 其余路径 —— 托管 public/ 静态前端（Workers Assets）。
 *
 * 没有 KV、没有 secret、没有会话；部署只需 `npx wrangler deploy`。
 * 配置与提示词模板来自 config_default.toml 与 prompts/*.txt（两栈共用，
 * 运行时经 ASSETS 读取并按 isolate 缓存，见 loadConfig）。
 */

import toml from "@iarna/toml";

/** isolate 级缓存：toml 与模板各进程只读一次。 */
let cachedConfig = null;

/**
 * 读取共享配置与提示词模板。
 * 配置文件与模板都在仓库根/仓库内，构建时同步进 public/ 供 ASSETS 托管。
 */
async function loadConfig(env) {
  if (cachedConfig) return cachedConfig;
  // ASSETS.fetch 需要完整 URL（相对路径会抛 Invalid URL）。
  const asset = (path) => env.ASSETS.fetch(new Request(`https://assets.local${path}`));
  const [tomlResp, turnaround, multiview] = await Promise.all([
    asset("/config_default.toml"),
    asset("/prompts/character_turnaround.txt"),
    asset("/prompts/scene_multiview.txt"),
  ]);
  if (!tomlResp.ok || !turnaround.ok || !multiview.ok) {
    throw new HttpError(500, "配置或提示词模板缺失，请检查部署产物。");
  }
  const parsed = toml.parse(await tomlResp.text());
  cachedConfig = {
    config: {
      model: parsed.model?.default,
      availableModels: parsed.model?.available || [],
      maxPromptLength: parsed.limits?.max_prompt_length ?? 4000,
      maxSourceFiles: parsed.limits?.max_source_files ?? 16,
      requestTimeoutMs: (parsed.limits?.request_timeout_seconds ?? 180) * 1000,
    },
    templates: {
      characterTurnaround: (await turnaround.text()).trim(),
      sceneMultiView: (await multiview.text()).trim(),
    },
  };
  return cachedConfig;
}

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

function cleanPrompt(text, cfg) {
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "提示词不能为空。");
  if (text.length > cfg.maxPromptLength) {
    throw new HttpError(400, `提示词不能超过 ${cfg.maxPromptLength} 字符。`);
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

function safeModel(value, cfg) {
  return cfg.availableModels.includes(value) ? value : cfg.model;
}

function buildPrompt(userPrompt, templateName) {
  const template = TEMPLATES[templateName];
  if (!template) throw new HttpError(500, `提示词模板缺失: ${templateName}`);
  return [userPrompt.trim(), template].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- 上游转发

async function callUpstream(cfg, apiKey, baseURL, path, body, isMultipart) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (!isMultipart) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers,
      body: isMultipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new HttpError(504, `上游超时（超过 ${cfg.requestTimeoutMs / 1000} 秒）。`);
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

async function handleGenerate(request, cfg) {
  const { apiKey, baseURL } = extractCredentials(request);
  const payload = await request.json().catch(() => null);
  if (!payload) throw new HttpError(400, "请求体不是合法 JSON。");

  const { images } = await callUpstream(cfg, apiKey, baseURL, "/images/generations", {
    model: safeModel(payload.model, cfg),
    prompt: cleanPrompt(payload.prompt, cfg),
    size: safeSize(payload.size),
    quality: safeQuality(payload.quality),
    n: safeCount(payload.n),
    response_format: "b64_json",
  }, false);
  return { images };
}

async function handleEdit(request, cfg) {
  const { apiKey, baseURL } = extractCredentials(request);
  const form = await request.formData();
  const files = form.getAll("image").filter((entry) => typeof entry === "object" && entry.arrayBuffer);
  if (!files.length) throw new HttpError(400, "请至少上传一张原图。");
  if (files.length > cfg.maxSourceFiles) {
    throw new HttpError(400, `最多只能上传 ${cfg.maxSourceFiles} 张图片。`);
  }

  const prompt = form.get("prompt");
  const mode = form.get("mode") || "edit";
  let finalPrompt;
  if (mode === "characterTurnaround") {
    finalPrompt = buildPrompt(safeOptionalPrompt(prompt), cfg.templates.characterTurnaround);
  } else if (mode === "sceneMultiView") {
    finalPrompt = buildPrompt(safeOptionalPrompt(prompt), cfg.templates.sceneMultiView);
  } else {
    finalPrompt = cleanPrompt(prompt, cfg);
  }

  // 与 Python 版一致：仅取单个 mask 字段。
  const mask = form.get("mask");
  const maskFile = mask && typeof mask === "object" && mask.arrayBuffer ? mask : null;

  const upstreamForm = new FormData();
  upstreamForm.append("model", safeModel(form.get("model"), cfg));
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

  const { images } = await callUpstream(cfg, apiKey, baseURL, "/images/edits", upstreamForm, true);
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

      if (path === "/api/generate" && method === "POST") {
        const cfg = await loadConfig(env);
        return json(await handleGenerate(request, cfg));
      }
      if (path === "/api/edit" && method === "POST") {
        const cfg = await loadConfig(env);
        return json(await handleEdit(request, cfg));
      }

      if (path === "/api/split-grid") {
        return json({ error: "宫格拆分已在前端本地完成，无需请求此接口。" }, 410);
      }

      if (path === "/api/health" && method === "GET") {
        const cfg = await loadConfig(env);
        return json({ ok: true, configured: true, model: cfg.config.model, baseURL: null });
      }
      if (path === "/api/models" && method === "GET") {
        const cfg = await loadConfig(env);
        return json({ default: cfg.config.model, available: cfg.config.availableModels });
      }

      return json({ error: "接口不存在。" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

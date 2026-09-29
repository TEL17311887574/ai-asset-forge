/**
 * 直连上游 OpenAI 兼容接口的客户端：替代原后端
 * image/service.py + image/router.py + auth/session.py。
 *
 * 与原方案的关键差异：
 * 1. 浏览器直接调用用户填写的 Base URL，不再经过本机后端转发，因此
 *    **完全依赖上游返回 CORS 头**；上游不允许跨域时本文件的所有请求都会失败。
 * 2. 不再有服务端 Semaphore，改用本模块内的 Promise 队列做并发闸门
 *    （仅在当前标签页内有效，多开标签页无法互相约束）。
 * 3. API Key 由调用方从 localStorage 读出后传入，本模块不负责存储。
 */

import { CONFIG } from "./config.js";

// ---------------------------------------------------------------- 并发闸门

let running = 0;
/** 等待中的任务；每项是一个「启动函数」，出队后调用即开始执行。 */
const waiting = [];

/**
 * 在并发额度内执行任务；超出 maxConcurrentGenerations 时排队等待。
 * 对应原后端 image/service.py 的 asyncio.Semaphore 闸门。
 */
export function withGenerationSlot(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };

    if (running < CONFIG.maxConcurrentGenerations) start();
    else waiting.push(start);
  });
}

// ---------------------------------------------------------------- 请求工具

/** 带超时的 fetch；对应原后端的 REQUEST_TIMEOUT = 180s。 */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时（超过 ${CONFIG.requestTimeoutMs / 1000} 秒），请稍后重试。`);
    }
    // 浏览器把网络层错误统一报成 TypeError: Failed to fetch，
    // 跨域被拒时也是这个错误，这里补一句可操作的提示。
    if (error instanceof TypeError) {
      throw new Error(
        "无法连接上游接口：可能是网络不通，或该地址不允许浏览器跨域调用（CORS）。",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 解析响应；非 2xx 时尽量还原后端风格的友好错误文案。 */
async function readJson(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const raw = payload?.error?.message ?? payload?.error ?? payload?.detail ?? text;
    const message =
      typeof raw === "string" && raw.trim()
        ? raw.trim()
        : `请求失败（HTTP ${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** 把上游返回的图片数据转成前端使用的 data URL 列表。 */
function parseImages(payload) {
  return (payload?.data || [])
    .map((item) => ({
      dataUrl: item.b64_json
        ? `data:image/png;base64,${item.b64_json}`
        : item.url || "",
      revisedPrompt: item.revised_prompt || "",
    }))
    .filter((item) => item.dataUrl);
}

/** 拼出接口地址，避免出现重复或缺失的斜杠。 */
export function endpoint(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, "")}${path}`;
}

// ---------------------------------------------------------------- 生成接口

/**
 * 文生图：POST /images/generations。
 * 对应原后端 image/service.py 的 generate_image()。
 */
export async function generateImage({
  apiKey,
  baseURL,
  prompt,
  size,
  quality,
  n,
  model,
}) {
  return withGenerationSlot(async () => {
    const response = await fetchWithTimeout(endpoint(baseURL, "/images/generations"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        n,
        response_format: "b64_json",
      }),
    });
    return parseImages(await readJson(response));
  });
}

/**
 * 图生图 / 蒙版：POST /images/edits。
 * 对应原后端 image/service.py 的 edit_image()。
 *
 * 多图字段名沿用现有代码的**重复 image**（不是 image[]）：
 * 原前端 app.js 循环 append("image", ...)，原后端用 Form(alias="image")
 * 接收成 list，两者一致。
 */
export async function editImage({
  apiKey,
  baseURL,
  prompt,
  images,
  size,
  quality,
  inputFidelity,
  n,
  mask,
  model,
}) {
  return withGenerationSlot(async () => {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("n", String(n));
    form.append("response_format", "b64_json");
    if (inputFidelity) form.append("input_fidelity", inputFidelity);

    images.forEach((blob, index) => {
      form.append("image", blob, blob.name || `image-${index + 1}.png`);
    });
    // 仅在真正存在蒙版时才附加，避免上游把空文件当成有效蒙版。
    if (mask) form.append("mask", mask, "mask.png");

    const response = await fetchWithTimeout(endpoint(baseURL, "/images/edits"), {
      method: "POST",
      // 不要手动设置 Content-Type，交给浏览器自动补 multipart boundary。
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    return parseImages(await readJson(response));
  });
}

// ---------------------------------------------------------------- 校验工具
// 以下对应原后端 image/service.py 中的 safe_* 系列函数。

/** 校验自定义尺寸；非法时回退 1024x1024（对应 safe_size）。 */
export function safeSize(value) {
  const allowed = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
  if (allowed.has(value)) return value;

  if (typeof value === "string") {
    const match = /^(\d{2,4})x(\d{2,4})$/.exec(value);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (
        width >= 64 &&
        height >= 64 &&
        width <= 3840 &&
        height <= 3840 &&
        width % 16 === 0 &&
        height % 16 === 0 &&
        Math.max(width, height) / Math.min(width, height) <= 3 &&
        width * height <= 8_294_400
      ) {
        return `${width}x${height}`;
      }
    }
  }
  return "1024x1024";
}

/** 校验生成质量（对应 safe_quality）。 */
export function safeQuality(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

/** 校验生成数量，1-4（对应 safe_count）。 */
export function safeCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 1;
  return number >= 1 && number <= 4 ? number : 1;
}

/** 校验图生图保真度（对应 safe_input_fidelity）。 */
export function safeInputFidelity(value) {
  return ["low", "high"].includes(value) ? value : "low";
}

/** 校验模型名，不在白名单时回退默认值（对应 safe_model）。 */
export function safeModel(value) {
  return CONFIG.availableModels.includes(value) ? value : CONFIG.defaultModel;
}

/** 清理必填提示词（对应 clean_prompt）。 */
export function cleanPrompt(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("提示词不能为空。");
  }
  if (text.length > CONFIG.maxPromptLength) {
    throw new Error(`提示词不能超过 ${CONFIG.maxPromptLength} 字符。`);
  }
  return text.trim();
}

/** 清理可空提示词（对应 safe_optional_prompt）。 */
export function safeOptionalPrompt(text) {
  return typeof text === "string" ? text.trim() : "";
}

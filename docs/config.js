/**
 * 纯前端配置：替代原 config_default.py。
 *
 * 这是一个纯静态站点，没有任何后端，因此这里的内容会随 JS 一起公开分发。
 * 不要在这里放任何密钥 —— API Key 由用户在登录框中填写，只保存在本机 localStorage。
 */

export const CONFIG = {
  /** 默认模型（对应原 config_default.py 的 MODEL）。 */
  defaultModel: "gpt-image-2",

  /** 前端模型切换器可选列表（对应原 AVAILABLE_MODELS）。 */
  availableModels: ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"],

  /**
   * 同一时刻允许进行的生成任务数（对应原 MAX_CONCURRENT_GENERATIONS）。
   *
   * 注意：原方案用后端 asyncio.Semaphore 做全局闸门，纯前端只能在
   * 「当前标签页」内排队，多开标签页无法互相约束。
   */
  maxConcurrentGenerations: 5,

  /** 提示词最大字符数（对应原 MAX_PROMPT_LENGTH）。 */
  maxPromptLength: 4000,

  /** 最多上传参考图数量（对应原 MAX_SOURCE_FILES）。 */
  maxSourceFiles: 16,

  /** 单文件大小上限 20 MB（对应原 MAX_FILE_BYTES）。 */
  maxFileBytes: 20 * 1024 * 1024,

  /** 单次调用上游的超时时间（对应原 REQUEST_TIMEOUT，180 秒）。 */
  requestTimeoutMs: 180_000,
};

/** localStorage 中保存登录凭据的键名。 */
export const AUTH_STORAGE_KEY = "ai-asset-forge.auth";

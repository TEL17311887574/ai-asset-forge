/**
 * 工作台的静态配置。
 *
 * 将模型、尺寸和模式文案集中到一个模块，避免散落在交互代码中。
 */
export const MAX_SOURCE_FILES = 16;

export const MODEL_SIZE_PRESETS = Object.freeze({
  "gpt-image-2": Object.freeze({
    "1K": Object.freeze({
      "1:1": "1024x1024", "3:4": "768x1024", "16:9": "1024x576",
      "4:3": "1024x768", "9:16": "576x1024", "2:3": "688x1024",
      "3:2": "1024x688", "5:4": "1024x816", "4:5": "816x1024",
      "21:9": "1024x432",
    }),
    "2K": Object.freeze({
      "1:1": "2048x2048", "3:4": "1536x2048", "16:9": "2048x1152",
      "4:3": "2048x1536", "9:16": "1152x2048", "2:3": "1360x2048",
      "3:2": "2048x1360", "5:4": "2048x1632", "4:5": "1632x2048",
      "21:9": "2048x880",
    }),
    "3K": Object.freeze({
      "1:1": "2880x2880", "3:4": "2304x3072", "16:9": "3072x1728",
      "4:3": "3072x2304", "9:16": "1728x3072", "2:3": "2048x3072",
      "3:2": "3072x2048", "5:4": "3072x2464", "4:5": "2464x3072",
      "21:9": "3072x1312",
    }),
    "4K": Object.freeze({
      "1:1": "2880x2880", "3:4": "2496x3312", "16:9": "3840x2160",
      "4:3": "3312x2496", "9:16": "2160x3840", "2:3": "2352x3520",
      "3:2": "3520x2352", "5:4": "3216x2576", "4:5": "2576x3216",
      "21:9": "3840x1648",
    }),
  }),
});

export const ACTIVE_IMAGE_MODEL = "gpt-image-2";
export const RESOLUTION_PRESETS = Object.freeze({
  "1K": Object.freeze({ longEdge: 1024, fitToMaxPixels: false }),
  "2K": Object.freeze({ longEdge: 2048, fitToMaxPixels: false }),
  "3K": Object.freeze({ longEdge: 3072, fitToMaxPixels: false }),
  "4K": Object.freeze({ longEdge: 3840, fitToMaxPixels: true }),
});

export const modeContent = Object.freeze({
  generate: "描述你想看见的画面，越具体越好。",
  edit: "上传一张或多张参考图，用提示词告诉模型如何融合或修改。",
  mask: "上传原图并擦出蒙版区域，只修改你指定的部分。",
  turnaround: "上传一张人物照片，自动生成包含三视图（正面/侧面/背面）+ 上半身特写的专业参考图。",
});

export const modeLabels = Object.freeze({
  generate: "图片生成",
  edit: "图生图",
  mask: "蒙版编辑",
  turnaround: "人物面部三视图",
});
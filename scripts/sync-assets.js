/**
 * 把共享配置与模板同步进 public/（ASSETS 托管目录）。
 * config_default.toml 与 prompts/*.txt 的事实源在仓库根，部署/本地开发前
 * 复制进 public/，Worker 运行时经 ASSETS 读取。
 * Windows / Linux 通用（node:fs，不依赖 shell 命令）。
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)); // scripts/
const rootDir = dirname(root); // 仓库根

// 1. 配置
copyFileSync(join(rootDir, "config_default.toml"), join(rootDir, "public", "config_default.toml"));

// 2. 模板目录
mkdirSync(join(rootDir, "public", "prompts"), { recursive: true });
for (const file of readdirSync(join(rootDir, "prompts"))) {
  if (file.endsWith(".txt")) {
    copyFileSync(join(rootDir, "prompts", file), join(rootDir, "public", "prompts", file));
  }
}

// 校验 toml 可解析（提前发现语法错误，而不是部署后 500）
const { parse } = await import("@iarna/toml");
parse(readFileSync(join(rootDir, "config_default.toml"), "utf8"));

console.log("[sync-assets] config_default.toml + prompts/*.txt 已同步到 public/");

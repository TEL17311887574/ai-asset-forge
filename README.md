# Ai Asset Forge

一个 AI 图像资产生成工作台，支持两种部署方式，前端只有同一份：

- **本地 / VPS 部署**：纯 Python（FastAPI 后端），无需 Node.js
- **Cloudflare Workers 部署**：Worker 同时提供 API 和静态页面，免服务器，一条命令部署

功能（两种部署完全一致）：

- 文生图：调用 `/v1/images/generations`
- 图生图 / 多图参考：调用 `/v1/images/edits` 并上传 `image`
- 蒙版编辑：在页面画布擦出透明区域，再上传 `mask`
- 宫格拆分：识别生成图中的直线白色网格线，支持 2×2 到 3×3 的 M×N 布局，
  按实际线宽和抗锯齿过渡裁剪子图，输出到当前对话卡片
- 原图列表：重复上传会自动追加；已上传图片可拖拽排序，也可以逐张删除
- 项目 / 对话两级结构：侧栏先按项目分组，项目下再挂对话；支持新建、重命名、删除项目，删除项目会连同其下对话一并清理
- 多 Key 管理：登录后可保存多个 API Key，随时切换当前激活 Key，支持重命名、删除
- 比例选择：1:1、3:4、16:9、4:3、9:16、2:3、3:2、5:4、4:5、21:9
- 分辨率选择：1K、2K、3K、4K；根据比例自动计算并提交 `WIDTHxHEIGHT` 尺寸
- 生成结果：每张图右上角带下载按钮，卡片下方提供「重新编辑 / 再次生成 / 删除图片」

---

## Key 存在哪里（两种部署通用）

**API Key 保存在你浏览器本机的 IndexedDB 里**（与对话历史同一个数据库），
服务端**零存储**——不落盘、不进数据库、没有会话文件。

- 生成请求时，浏览器把激活的 Key 通过 `Authorization` 头发给服务端，
  服务端只做校验与转发，用完即弃。
- 换浏览器 / 换设备 / 清缓存后需要重新录入 Key（对话历史同样按浏览器隔离）。
- 界面上只显示脱敏 Key（如 `sk-••••9999`），完整 Key 不出现在任何 API 响应里。

服务端因此没有任何配置步骤：没有密钥文件、没有数据库、没有环境变量。

---

## 方式一：本地 / VPS 运行（Python）

1. 安装 Python 3.9 或更高版本。
2. 创建并激活虚拟环境，安装依赖：

   ```bash
   python -m venv .venv
   .venv\Scripts\activate        # Windows
   # source .venv/bin/activate   # macOS / Linux
   pip install -r requirements.txt
   ```

3. 启动：

   ```bash
   python main.py
   # 或：uvicorn main:app --host 0.0.0.0 --port 3000
   ```

4. 打开 <http://localhost:3000>，点击左下角“登录”，输入 `INX_TOKEN_API_KEY` 和 `INX_TOKEN_BASE_URL`。

登录后可以在 Key 管理器中保存多个 API Key，并随时切换当前激活 Key。切换只影响之后发起的新请求，已经开始的图片生成任务继续使用请求开始时的 Key；因此同一对话可以先后使用不同 Key 并发生成。

> 项目为纯 Python，结构和 `crawler_data_platform` 保持同一种风格：根目录提供
> `main.py`、`router.py`、`config_default.py`，具体业务放进各自模块。

### Python 版代码结构

```text
├── main.py                 # FastAPI 应用和启动入口
├── router.py               # 汇总所有业务路由（health / models）
├── config_default.py       # 全部可调参数（超时、模型、限制）
├── image/
│   ├── router.py           # 文生图、图生图接口（从请求头读取凭据）
│   ├── schema.py           # 图片生成请求模型
│   ├── service.py          # 校验、转发、响应转换
│   └── splitter.py         # M×N 宫格图直线网格检测与拆分
├── src/                    # Cloudflare Workers 版（见方式二）
└── public/                 # 浏览器页面和静态资源（两种部署共用）
```

### 并发模型

图片生成接口使用 `AsyncOpenAI` + `await`，等待上游返回期间不占用事件循环，
因此可以同时处理多个生成任务，不会出现「一个生成把整个服务卡住」的情况。

同时在跑的生成任务数由 `config_default.py` 的 `MAX_CONCURRENT_GENERATIONS` 控制
（默认 5）：超出的请求进入排队而不是直接被上游限流。调试时可用它压测，
生产时按上游额度调整。

比例与尺寸由前端 `MODEL_SIZE_PRESETS` 枚举集中管理：当前包含 GPT Image 2 的 1K、2K、3K、4K 全部比例尺寸。1K/2K/3K 使用固定尺寸枚举，4K 额外适配 GPT Image 2 的最大总像素 `8,294,400`；宽高必须是 16 的倍数、长宽比不超过 3:1。例如 16:9 + 2K 会提交 `2048x1152`，16:9 + 4K 会提交 `3840x2160`。未来如 GPT Image 2.5 的尺寸不同，可在同一枚举中增加模型配置。

---

## 方式二：Cloudflare Workers 部署

Worker 同时提供 `/api/*` 后端和 `public/` 静态前端，浏览器与 API **同源**，
不存在跨域问题。前端是同一份 `public/`，无需任何改动即可切换部署方式。

### 架构对照

| Python 版 | Workers 版 |
| --- | --- |
| `main.py`（FastAPI + uvicorn） | `src/worker.js`（入口 + 路由 + 转发） |
| `image/service.py`（safe_* 校验 + 转发 + 模板） | `src/worker.js` 内同名逻辑 |
| `image/router.py`（generate/edit/split-grid） | `src/worker.js` + 前端 Canvas 拆分 |
| `config_default.py` | `src/worker.js` 内 CONFIG 常量 |
| 无（浏览器管理 Key） | 无（同样浏览器管理 Key） |
| `public/` 静态托管 | Workers Assets（同一个 `public/`） |

唯一的行为差异：**宫格拆分**由后端 Pillow 改为前端 Canvas
（`public/grid-splitter.js`，算法与 Python 版逐像素一致），
因为 Workers 无法运行 Pillow。

安全模型一致：Key 存浏览器 IndexedDB，两个栈的服务端都只做纯转发、零存储。

### 部署（一条命令）

前置：安装 Node.js 18+（wrangler 需要跑在 Node 上）。

```bash
npx wrangler deploy
```

首次使用需要先登录 Cloudflare（浏览器授权一次，之后免登录）：

```bash
npx wrangler login
```

完成后 wrangler 会输出地址（形如 `https://ai-asset-forge.<子域>.workers.dev`），
打开即是完整前端，登录框里 Base URL 填 `https://xfastapi.ai/v1` 与平时一致。

没有 KV、没有 secret、没有环境变量——Key 在浏览器里，Worker 纯转发。

### 本地开发（Workers 版）

```bash
npx wrangler dev
```

打开 wrangler 打印的 localhost 地址即可。

### 日常运维

- 看日志：`npx wrangler tail`
- 改配置：编辑 `src/worker.js` 顶部的 `CONFIG` 常量（模型列表、限制等）后重新 deploy
- 免费额度：10 万请求/天；图像生成的长等待是 I/O 时间，不计 CPU
- `workers.dev` 域名在大陆网络偶有解析问题，访问不稳定时可在 Cloudflare
  免费绑定自己的域名

---

## 安全提示

- API Key 保存在浏览器本机 IndexedDB，服务端零存储；请勿在不受信任的设备上登录。
- 服务端不落盘、无会话文件，任何部署都不需要配置密钥。
- 界面只显示脱敏 Key；完整 Key 仅在生成请求的 `Authorization` 头中传输给
  你自己填写的上游地址。

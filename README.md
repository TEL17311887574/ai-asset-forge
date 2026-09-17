# Ai Asset Forge

一个可在本地运行的网页工具，**纯 Python（FastAPI 后端）实现，无需 Node.js / node_modules**，支持：

- 文生图：调用 `/v1/images/generations`
- 图生图 / 多图参考：调用 `/v1/images/edits` 并上传 `image`
- 蒙版编辑：在页面画布擦出透明区域，再上传 `mask`
- 原图列表：重复上传会自动追加；已上传图片可拖拽排序，也可以逐张删除
- 比例选择：1:1、3:4、16:9、4:3、9:16、2:3、3:2、5:4、4:5、21:9
- 分辨率选择：1K、2K、3K、4K；根据比例自动计算并提交 `WIDTHxHEIGHT` 尺寸

## 启动

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

登录会话有效期为 30 天，再次登录会重新计算 30 天有效期；主动退出后需要重新登录。服务端请求超时设为 180 秒，上传单文件限制为 20 MB。

> 项目为纯 Python，结构和 `crawler_data_platform` 保持同一种风格：根目录提供
> `main.py`、`router.py`、`config_default.py`，具体业务放进各自模块。

## 代码结构

```text
├── main.py                 # FastAPI 应用和启动入口
├── router.py               # 汇总所有业务路由
├── config_default.py       # 全部可调参数（超时、模型、限制、会话）
├── auth/
│   ├── router.py           # 登录、会话、退出接口
│   ├── schema.py           # 登录请求模型
│   └── session.py          # Cookie 加密和 OpenAI 客户端
├── image/
│   ├── router.py           # 文生图、图生图接口
│   ├── schema.py           # 图片生成请求模型
│   └── service.py          # 校验、文件读取、响应转换
└── public/                 # 浏览器页面和静态资源
```

## 并发模型

图片生成接口使用 `AsyncOpenAI` + `await`，等待上游返回期间不占用事件循环，
因此可以同时处理多个生成任务，不会出现「一个生成把整个服务卡住」的情况。

同时在跑的生成任务数由 `config_default.py` 的 `MAX_CONCURRENT_GENERATIONS` 控制
（默认 5）：超出的请求进入排队而不是直接被上游限流。调试时可用它压测，
生产时按上游额度调整。

OpenAI 客户端会按会话复用（内部是 httpx 连接池），服务关闭时统一释放。
比例与尺寸由前端 `MODEL_SIZE_PRESETS` 枚举集中管理：当前包含 GPT Image 2 的 1K、2K、3K、4K 全部比例尺寸。1K/2K/3K 使用固定尺寸枚举，4K 额外适配 GPT Image 2 的最大总像素 `8,294,400`；宽高必须是 16 的倍数、长宽比不超过 3:1。例如 16:9 + 2K 会提交 `2048x1152`，16:9 + 4K 会提交 `3840x2160`。未来如 GPT Image 2.5 的尺寸不同，可在同一枚举中增加模型配置。

## 安全提示

API Key 和 Base URL 由登录页面提交给本机服务端，并保存在加密、`httpOnly`、`SameSite=Lax` 的会话 Cookie 中，不会写入 `localStorage`、IndexedDB 或历史对话。服务端首次启动会自动生成被 Git 忽略的 `.auth-secret`，用于加密会话。`.env` 中不再需要 `INX_TOKEN_API_KEY` 和 `INX_TOKEN_BASE_URL`。

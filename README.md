# First Sight · 三摄硬件视觉交互与手机语音助手（课内版）

面向视障/低视力场景的可穿戴三摄视觉助手，演示闭环清晰聚焦 **四步实时链路**：

**硬件三摄采集 → 电脑本地计算 → 网页实时展示画面与输出 → 手机语音播报**

> 注：原科研线复杂空间记忆系统、评测代码与文档已完整归档至 [docs/archive/](docs/archive/) 及 Git 备份分支 `archive/pre-course-cleanup-2026-11-23`。当前 `main` 分支仅保留精简可演示的课内项目结构。

## 核心架构

- **活跃架构契约**：[docs/active/](docs/active/README.md) · **快速演示手册**：[docs/course-demo-quickstart.md](docs/course-demo-quickstart.md) · **状态与待办**：[TODO.md](TODO.md)

```text
① 硬件三摄采集   ESP32-S3 (front / left / right) ─> three_camera_demo.py (4级IP重定位 + SHA256校验)
        │
        ▼
② 电脑本地计算   Node.js 服务 (src/server.ts) ─> QwenVision (多视角描述/OCR/识物/问答) + WatchManager
        │
        ├─> ③ 网页画面与输出   电脑主控演示台 (web/index.html + desktop.js) · 支持“演示模式”全屏聚焦 + 回放页 (web/replay.html)
        │
        └─> ④ 手机语音播报     SSE 实时推送 ─> iPhone / Android 语音伴侣 (web/mobile.html + mobile.js)
```

## 快速启动（演示流程）

1. **确认环境变量**（已配置在本机环境变量即可，勿覆盖自定义端点）：
   ```powershell
   Write-Output "API_KEY=$([bool]$env:QWEN_API_KEY) BASE_URL=$([bool]$env:QWEN_BASE_URL)"
   ```
2. **启动演示服务**：
   ```powershell
   # 同局域网直连（热点 / 便携路由器 / 可互访 Wi-Fi）
   npm.cmd run demo

   # 或启用 Cloudflare HTTPS 隧道（校园网设备隔离 / 手机网页麦克风推荐）
   npm.cmd run demo:tunnel
   ```
3. **打开界面与演示模式**：
   - 电脑展示台：`http://127.0.0.1:8890/`（只读历史回放：`http://127.0.0.1:8890/replay.html`）。
   - 在顶部“设备与扫码配置”抽屉完成**手机扫码**与**三摄 IP 定位**后，点击右上角 **“演示模式”** 即可收起配置杂项，在投影画面上只保留 **四步状态栏 + 三摄实时画面 + 最新输出高亮区 + 互动控制**。
   - 手机端用 iPhone Safari / Android Chrome 扫码进入后，点击顶部 **“点击开启手机语音播报”** 即可实时收听播报。

详细现场排查（换教室自动定位三摄 IP、串口读 IP 兜底、本机摄像头测试推流）见 [course-demo-quickstart.md](docs/course-demo-quickstart.md)。

## 目录结构

| 路径 | 职责 |
|---|---|
| `src/` | 模块化 TypeScript 后端（`auth`、`camera-hub`、`sse-hub`、`tunnel`、`server`、`vision/`、`recording/`、`tests/`） |
| `web/` | 模块化前端：`shared.js` 公共组件、`index.html`/`desktop.js` 演示展示台、`mobile.html`/`mobile.js` 手机语音端、`replay.html`/`replay.js` 回放页 |
| `cam/` | ESP32-S3 固件源码（`cam/src/`）、三摄采集与 4 级 IP 定位工具（`cam/host/`） |
| `docs/active/` | 当前课内版系统架构与设计边界 |
| `docs/archive/` | 历史科研文档、原 `active` 架构、原 `TODO` 与研究产物归档 |
| `scripts/testing/` | TypeScript 自动化测试执行器与文档链接校验脚本 |

## 免费测试与构建校验

Node.js ≥ 22.13；Python 使用 `cam/.venv/Scripts/python.exe`。以下全部校验均零模型费用：

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:cam
npm.cmd run test:docs
```

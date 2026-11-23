# 当前工作与状态（课内版）

> 原科研阶段（至 2026-11-17）完整工作日志已归档至 [TODO-research-2026-11-23.md](docs/archive/TODO-research-2026-11-23.md)；本文件仅维护当前课内演示项目的状态与待办。

- **前端演示舞台重构、文档同步与推送准备完成（2026-11-23）**：
  - 将 `web/` 重构为统一模块化前端：`shared.js`、`style.css`、`index.html`+`desktop.js`、`mobile.html`+`mobile.js`、`replay.html`+`replay.js`；[src/server.ts](src/server.ts) 暴露 `/shared.js` 路由。
  - 主控台新增 **4 步实时状态栏**（硬件三摄采集 → 电脑计算调度 → 网页画面与输出 → 手机语音播报）、**最新输出高亮区（Hero Spotlight）**、可折叠 **设备与扫码配置抽屉** 及一键 **演示模式**（投影全屏聚焦）。
  - 同步更新 `README.md`、`docs/active/01-course-architecture.md`、`docs/active/02-design-rationale.md`、`docs/course-demo-quickstart.md`。
  - 免费校验覆盖：`typecheck`、`build`、`npm test`（5/5）、`npm run test:cam`（2/2）、JS 语法检查与文档链接检查均通过，随后提交并推送至 `origin/main`（不改动 `docs/archive/`、原有标签、`cam/local/`、`datasets/` 与 `research/`）。

- **仓库清理、归档与模块化重构完成（2026-11-23）**：
  - 本地保护性备份分支 `archive/pre-course-cleanup-2026-11-23` 指向清理前快照 `558810e`；原 `docs/active/`、科研文档、`TODO.md` 及根目录临时研究材料归档在 `docs/archive/`。
  - 后端重构为 `src/` 下模块化结构（`types.ts`、`auth.ts`、`sse-hub.ts`、`tunnel.ts`、`camera-hub.ts`、`recording/session-store.ts`、`vision/qwen-vision.ts`、`vision/watch-manager.ts`、`server.ts`、`index.ts`），新增 Watch 持续目标关注与只读回放。
  - 待现场验收（需实机与网络环境）：三台 ESP32-S3 在明天演示现场的自动 IP 重定位实测、iPhone/Android 真机 TTS 播报现场音量与延迟确认。

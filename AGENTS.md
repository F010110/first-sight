# Project Instructions (First Sight · 课内演示版)

## 文档与架构分工

1. 开始工作先读 `docs/active/README.md`、`docs/active/01-course-architecture.md`、`docs/active/02-design-rationale.md`，再看 `TODO.md`。
2. `docs/active/` 保存课内版有效架构与设计边界；原科研阶段文档与历史进度已归档在 `docs/archive/`（只作追溯，不再作为当前开发任务恢复）。
3. `TODO.md` 记录当前课内工程状态、验证结果、已知限制与待办。

## 严格安全与保留边界

- **禁止扫描、读取或改写私有/独立目录**：`cam/local/`、`research/`、`datasets/`（保持不动，不自动清理、搬迁或提交）。
- **禁止破坏历史归档与冻结资产**：不删除 `docs/archive/`、不移动或重推现有 Git 标签、不删除与课内演示无关的既有历史备份分支。
- **不擅自调用付费 API**：测试和回归必须使用本地模拟/桩实现，严禁在自动化测试中自动调用真实 Qwen 付费接口。
- **尊重环境配置**：`QWEN_API_KEY` 与 `QWEN_BASE_URL` 由用户本机环境变量提供，禁止在代码中硬编码或覆盖为通用端点。
- **本地输出路径隔离**：课内演示的运行时缓存、主机 IP 记录与会话回放统一写入 `run/course-demo/`，不混写其他 `run/` 历史实验目录。

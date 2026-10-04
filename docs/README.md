# 文档索引

当前系统的使用说明与架构以根目录的 [README](../README.md) 为准。本目录按主题归类其余文档。

当前版本：**V1.0（正式版）**。

## 使用 / 部署

- [手机试用（iOS / Android · 局域网 HTTPS）](mobile-trial.md) —— 两平台安装 CA、启动服务、打开页面、平台差异与排查。

## 架构与设计（当前）

- 根 [README](../README.md) —— **当前三 Agent 架构、运动模式、图片记忆、离线工具**。
- [产品设计](product-design.md) —— 产品方向与分阶段计划。

## 运动 / 惯导

- [惯性速度估计](motion-dead-reckoning.md) —— 标定、去重力、零速校正（ZUPT）与漂移说明。结论：**位移只能定性，轨迹不可靠**。

## 历史设计（部分已过时）

- [四模式时期架构](architecture-legacy-4mode.md) —— Quiet / Awareness / Task / Explore 时代的完整规格。其中的模式、Awareness 复查、帧门控等已被三 Agent 线取代，**仅作历史参考**。

## 参考评审

- [框架参考](references/framework.md)
- [空间定位方案比较](references/spatial-reference-review.md)
- [Vinci 代码评估](references/vinci-review.md)
- [空间方案草稿](references/draft-spatial.md)

## 讨论与意见（过程记录）

- [评审意见 1](notes/review-notes-1.md)
- [评审意见 2](notes/review-notes-2.md)
- [设计草稿](notes/draft.md)
- [讨论记录](notes/discussion.md)

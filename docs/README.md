# 文档导航

更新：2026-11-10。**架构及设计理由：[active/README.md](active/README.md)；当前状态、待办和维护：[TODO.md](../TODO.md)。** 两者职责分开，旧同步区不再维护为“最新决策”入口。

## 当前入口

- [项目总览与运行导航](../README.md)
- [空间记忆架构契约](active/01-spatial-memory-architecture.md) · [设计理由](active/02-design-rationale.md) · [实施计划](active/03-implementation-plan.md)
- [ULVN实验接入状态](notes/ulvn-integration-status-2026-11-10.md) · [v10失败原因及测试混杂](notes/ulvn-v10-cause-analysis-2026-11-10.md)
- [ULVN安装和匹配对照](../scripts/media/ULVN-MATCHER.md)
- [工作区整理记录与剩余工作](maintenance/workspace-review-2026-11-10.md) · [仓库组织规则](maintenance/repository-layout.md)

## 既有产品手册与历史入口

以下按各自日期/实现链路理解，不代表当前空间研究全部已完成。旧[项目信息同步区](project-sync/README.md)只供溯源。**[v2.0.0](releases/v2.0.0.md)**是单摄校园网原型发布，不是当前空间记忆完成声明。

- [更真实样本：建议11官方来源核查、已收集资产与接入边界](research/realistic-sample-source-survey-2026-10-24.md)

- [V2目录整理与验证](maintenance/v2-layout-validation.md) · [脚本导航](../scripts/README.md)

- [V2硬件／软件、前端／后端架构](./product/v2-system-map.md)
- [V2启动、配置、端口与运行手册](./application/v2-realtime.md)
- [V2仓库审查与后续整理清单](./maintenance/v2-repository-audit.md)
- [未来随身本地计算＋蜂窝同步（不实施）](./product/future-wearable-architecture.md)

## 历史设计、评测与复现

- [生活助手产品设计缺口审阅](./product/design-gap-review-2026-10-20.md)
- [硬件与模拟器暂缓保存点](./maintenance/hardware-simulation-pause-2026-10-20.md)
- [发布说明、成绩与已知问题](./releases/v1.2.0.md)
- [完整90题实测](./application/inspect-repair-full90-results.md)
- [持续空间Context架构](./application/spatial-context-refactor.md)
- [地点轨迹审核](./application/spatial-graph-human-audit.md)
- [工具分类](../sim/README.md) · [仓库维护规则](./maintenance/repository-layout.md)
- [历史归档与原工作日志](./archive/README.md)

下列研究协议与报告属于各自冻结阶段，不将旧“当前”措辞视为本版状态。

- [当前主体＋单图标注冻结协议](./research/group-identity-annotations-v3-1.json)
- [空间记忆版本历史与旧方案归档](./archive/spatial-memory-version-history.md)

## 笔记与建议

- [笔记索引](./notes/README.md)：建议、讨论、草稿、审阅笔记的入口
- [当前空间记忆设计与三个参考实现的对照](./notes/spatial-memory-design-and-references.md)

## 研究资料（非V2实时启动步骤）

1. [测试版范围、限制与测试命令](./testing-version.md)
2. [当前时间连续分组](./research/temporal-continuity-integration.md)
3. [可选回溯修复](./research/retrospective-repair-trial.md)
4. [逐图正式评分标准](./research/temporal-image-classification-standard.md)
5. [实验报告索引](./experiments/README.md)
6. [研究与手机应用的硬件鸿沟](./research/research-application-gap.md)
7. [原始建议材料索引](./notes/suggestions/README.md)
8. [头盔采集兼容接口](./research/helmet-capture-interface.md)
9. [旧手机实现状态](./archive/mobile-implementation-status.md)
10. [160°广角模拟与边缘畸变准备](./research/wide-angle-camera-preparation.md)
11. [固定查询点：可修正区域识别与标签定义](./research/fixed-region-query-evaluation.md)
12. [同区域不同组聚合：方法核查与建议试验](./research/same-region-group-aggregation-review.md)
13. [组聚合试验：恢复碎片与传播混组的失败](./research/group-aggregation-hypothesis-trial.md)
14. [全部组参与的18→1聚合完整结果](./research/full-group-aggregation-trial.md)
15. [VLM全局自动聚合：真实调用与失败](./research/vlm-global-group-aggregation-trial.md)
16. [开放生活区评分与qwen3.8-flash真实结果](./research/vlm-open-living-granularity.md)
17. [Flash卧室拒答诊断与版本冻结](./research/vlm-abstention-diagnosis.md)
18. [边界组与部分边界输出真实试验](./research/vlm-boundary-groups-trial.md)
19. [固定边界研究算法v1](./research/boundary-region-algorithm-v1.json)
20. [人工运动视频与样本点审查网站](./research/human-review-site.md)

## 分区

|目录|用途|
|---|---|
|`active/`|有效架构、理由和实施方向；当前进度仍看TODO|
|`application/`|各代应用设计与操作手册，按日期/链路区分|
|`research/`|研究资料与各阶段协议，不覆盖active；不是独立根research工作区|
|`archive/`|早期设计、方法对照和失败诊断，仅作历史参考|
|`experiments/`|数值报告与标签，原路径保留便于复现|
|`references/`|参考资料与评审|
|`notes/`|讨论、建议和草稿，不作为验收结论|

[手机试用](./application/mobile-trial.md) · [应用README](../README.md) · [任务与阻塞](../TODO.md)

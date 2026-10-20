# 文档导航

当前正式版本：**[v1.2.0](releases/v1.2.0.md)**。旧v1.0.0手机基线及v1.1测试研究记录保留，不覆盖。

## 当前入口

- [生活助手产品设计缺口审阅](product/design-gap-review-2026-10-20.md)
- [硬件与模拟器暂缓保存点](maintenance/hardware-simulation-pause-2026-10-20.md)
- [发布说明、成绩与已知问题](releases/v1.2.0.md)
- [完整90题实测](application/inspect-repair-full90-results.md)
- [持续空间Context架构](application/spatial-context-refactor.md)
- [地点轨迹审核](application/spatial-graph-human-audit.md)
- [工具分类](../sim/README.md) · [仓库维护规则](maintenance/repository-layout.md)
- [历史归档与原工作日志](archive/README.md)

下列研究协议与报告属于各自冻结阶段，不将旧“当前”措辞视为本版状态。

- [当前主体＋单图标注冻结协议](research/group-identity-annotations-v3-1.json)
- [空间记忆版本历史与旧方案归档](archive/spatial-memory-version-history.md)

## 优先阅读

1. [测试版范围、限制与测试命令](testing-version.md)
2. [当前时间连续分组](research/temporal-continuity-integration.md)
3. [可选回溯修复](research/retrospective-repair-trial.md)
4. [逐图正式评分标准](research/temporal-image-classification-standard.md)
5. [实验报告索引](experiments/README.md)
6. [研究与手机应用的硬件鸿沟](research/research-application-gap.md)
7. [原始建议材料索引](notes/suggestions/README.md)
8. [头盔采集兼容接口](research/helmet-capture-interface.md)
9. [旧手机实现状态](archive/mobile-implementation-status.md)
10. [160°广角模拟与边缘畸变准备](research/wide-angle-camera-preparation.md)
11. [固定查询点：可修正区域识别与标签定义](research/fixed-region-query-evaluation.md)
12. [同区域不同组聚合：方法核查与建议试验](research/same-region-group-aggregation-review.md)
13. [组聚合试验：恢复碎片与传播混组的失败](research/group-aggregation-hypothesis-trial.md)
14. [全部组参与的18→1聚合完整结果](research/full-group-aggregation-trial.md)
15. [VLM全局自动聚合：真实调用与失败](research/vlm-global-group-aggregation-trial.md)
16. [开放生活区评分与qwen3.8-flash真实结果](research/vlm-open-living-granularity.md)
17. [Flash卧室拒答诊断与版本冻结](research/vlm-abstention-diagnosis.md)
18. [边界组与部分边界输出真实试验](research/vlm-boundary-groups-trial.md)
19. [固定边界研究算法v1](research/boundary-region-algorithm-v1.json)
20. [人工运动视频与样本点审查网站](research/human-review-site.md)

## 分区

|目录|用途|
|---|---|
|`application/`|手机试用、产品与应用记忆设计；本轮不接入三视图研究|
|`research/`|当前视觉记忆架构、功能清单与评测协议|
|`archive/`|早期设计、方法对照和失败诊断，仅作历史参考|
|`experiments/`|数值报告与标签，原路径保留便于复现|
|`references/`|参考资料与评审|
|`notes/`|讨论、建议和草稿，不作为验收结论|

[手机试用](application/mobile-trial.md) · [应用README](../README.md) · [任务与阻塞](../TODO.md)

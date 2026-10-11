# 实验索引

实验代码保留在 `src/sim/`，可复用机制在 `src/agent/`，录制/轨迹检查工具在 `sim/`。不做破坏性搬迁，以保留现有导入、命令和历史报告链接。

## 当前结论优先阅读

1. [测试版范围与运行](../testing-version.md)
2. [实现/验证清单](../experience-implementation-checklist.md)
3. [分组原图与实际轨迹核验](../region-partition-actual-review.md)
4. [方法选择与训练决策](../region-methods-and-training.md)
5. [API-free人工评测协议与评分入口](../region-evaluation-protocol.md)
6. [固定局部范围标准及39对审图判定](../region-manual-rubric-and-assessment.md)

## 分层实验

| 层 | 代码入口 | 说明 |
| --- | --- | --- |
| 生产Place/Space记忆修订 | `src/agent/place-memory.ts` | [分层记忆](../layered-place-memory.md) |
| 概率拓扑定位基线 | `src/sim/topological-eval.ts` | [基线](../topological-baseline.md) |
| 视觉重叠分组对照 | `src/sim/grouping-eval.ts` | [分组基线](../grouping-experiment.md) |
| 观测优先经历底座 | `src/agent/experience-graph.ts` | [架构](../experience-graph.md)、[早期审计](../experience-graph-audit.md) |
| 可修订视觉关联 | `src/sim/experience-revisable-eval.ts` | [退化诊断](../experience-regression-diagnosis.md) |
| 锚点上可选视觉分组 | `src/sim/experience-grouping-eval.ts` | [分组失败诊断](../experience-place-grouping-diagnosis.md) |
| 有符号区域证据图 | `src/sim/region-partition-eval.ts` | [人工证据试验](../region-partition-pilot.md) |
| 求解/错误桥接验证 | `src/sim/region-partition-stress.ts` | 不替代原图正确性评价 |

## 研究记录

[路线图](../revisable-experience-memory-roadmap.md)、[文献核查](../place-grouping-literature-review.md)。仓库根目录 `建议3.md`–`建议7.md` 是原始建议材料，保留原文，不能当作论文已证实的结论；以核查报告的来源与限制为准。

`v1.1.0-test.1/` 保存小体积数值报告和文件SHA256清单。`run/` 继续忽略：图像、视频、完整模型输出和运行记忆不混入代码提交。数值快照不含原始录制，不能声称全新clone即可完整复现实验。

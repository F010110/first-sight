# 实验索引

## v1.1.0-test.2 当前证据

- 默认时间归类：`temporal-current-val4-formal-v3.json`；v1/v2保留失败过程。
- 可选回溯修复：`retrospective-repair-review-val4-v2.json`和`retrospective-repair-val4-formal-v2.json`。
- 误修对照：`retrospective-repair-review-val4-v1.json`和`retrospective-repair-val4-formal-v1.json`。
- [当前测试版结论](../testing-version.md)、[修复适用范围](../research/retrospective-repair-trial.md)。以下较早实验指标不是本版正式分数。

实验代码保留在 `src/sim/`，可复用机制在 `src/agent/`，录制/轨迹检查工具在 `sim/`。不做破坏性搬迁，以保留现有导入、命令和历史报告链接。

## 当前结论优先阅读

1. [测试版范围与运行](../testing-version.md)
2. [实现/验证清单](../research/experience-implementation-checklist.md)
3. [分组原图与实际轨迹核验](../archive/region-partition-actual-review.md)
4. [方法选择与训练决策](../research/region-methods-and-training.md)
5. [API-free人工评测协议与评分入口](../archive/region-evaluation-protocol.md)
6. [固定局部范围标准及39对审图判定](../archive/region-manual-rubric-and-assessment.md)

## 分层实验

| 层 | 代码入口 | 说明 |
| --- | --- | --- |
| 生产Place/Space记忆修订 | `src/agent/place-memory.ts` | [分层记忆](../application/layered-place-memory.md) |
| 概率拓扑定位基线 | `src/sim/topological-eval.ts` | [基线](../archive/topological-baseline.md) |
| 视觉重叠分组对照 | `src/sim/grouping-eval.ts` | [分组基线](../archive/grouping-experiment.md) |
| 观测优先经历底座 | `src/agent/experience-graph.ts` | [架构](../archive/experience-graph.md)、[早期审计](../archive/experience-graph-audit.md) |
| 可修订视觉关联 | `src/sim/experience-revisable-eval.ts` | [退化诊断](../archive/experience-regression-diagnosis.md) |
| 锚点上可选视觉分组 | `src/sim/experience-grouping-eval.ts` | [分组失败诊断](../archive/experience-place-grouping-diagnosis.md) |
| 有符号区域证据图 | `src/sim/region-partition-eval.ts` | [人工证据试验](../archive/region-partition-pilot.md) |
| 求解/错误桥接验证 | `src/sim/region-partition-stress.ts` | 不替代原图正确性评价 |

## 研究记录

[路线图](../research/revisable-experience-memory-roadmap.md)、[文献核查](../archive/place-grouping-literature-review.md)。原始建议材料已集中在[建议索引](../notes/suggestions/README.md)，保留原文，不能当作论文已证实的结论；以核查报告的来源与限制为准。

`v1.1.0-test.1/` 保存小体积数值报告和文件SHA256清单。`run/` 继续忽略：图像、视频、完整模型输出和运行记忆不混入代码提交。数值快照不含原始录制，不能声称全新clone即可完整复现实验。

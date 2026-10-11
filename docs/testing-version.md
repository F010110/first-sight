# v1.1.0-test.2：视觉记忆研究测试版

日期：2026-10-11。稳定应用基线仍为 `v1.0.0`；本标签是研究快照，不是可靠性验收通过。

## 固定范围

- 保留原图、时间、历史物体检索、拒绝证据、可撤回修订与持久化。
- 时间连续归属与历史组身份分开；当前归属不是已验证的物理区域，更不是导航许可。
- 默认研究链路：前/左/右三视图离线观察、视觉证据、当前经历分组、逐前缀回放。
- **回溯修复可选**：独立 `src/sim/retrospective-repair-trial.ts`，不被默认 pipeline 导入或启用，不改原始归类日志。
- 手机应用与研究分开。此轮不改实时 Agent、手机采集与接入逻辑；不把单摄手机当作三摄设备。此前版本包含应用改动，本版不声称完整手机回归通过。

## 已知结果和失败

val4开发集44张已审核心图片：默认归类有2个混合组、13/703错合并对；可选修复后1个混合组、5/703错合并对。同区域聚合率24.7%→26.3%。首次旧组识别17/40、新组建立1/4没有被事后修复改写。

修复v1有1次正确、1次错误事件，失败报告保留；v2有1次正确、0次错误事件，涉及53/54两张图。**单次成功不是可靠精度**。val5无修复提案，缺完整标签。两套真实时间回放均无受支持的历史组匹配；正式结论仍不符合。独立盲审、固定正确历史分组分类对照、版本适配与手机实测仍欠缺。

## 检查入口

```powershell
npm.cmd ci
npm.cmd run test:memory
npm.cmd run test:visual-pipeline
npm.cmd run test:retrospective-repair
npm.cmd run test:classification-standard
npm.cmd run test:grouping-benchmark
python sim/test_navigation.py
```

这些是软件机制回归，不是可靠性认证。离线真实回放需要本地录制与缓存证据，`run/`数据不随版本发布。依赖见根目录 `requirements.txt`。

## 阅读与复现

- [当前研究架构和默认回放](research/temporal-continuity-integration.md)
- [可选修复实验与命令](research/retrospective-repair-trial.md)
- [固定评分标准](research/temporal-image-classification-standard.md)
- [配对版本验收契约](research/grouping-acceptance-pipeline.md)
- [报告索引](experiments/README.md)：保留JSON报告路径，避免破坏评测输入与历史证据。
- 根目录 `TODO.md`：未完成事项和验收阻塞。

目录分工：`docs/application/`应用；`docs/research/`当前研究；`docs/archive/`历史实验与设计；`docs/experiments/`不可变数值报告；`docs/notes/`讨论材料。历史档案不代表本版结论。

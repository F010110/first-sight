# 桌面应用层

- `realtime-server.ts`：V2实时HTTP入口；编排位于`../hardware/realtime-session.ts`。
- `live-recordings.ts`：真实录像只读读取、记录开关分段与证据权限。
- `server.ts`、`prepare-campus-memory.ts`、`run-campus-pilot.ts`、`run-campus-questions.ts`：历史视频助手应用与离线准备／问答入口。
- `spatial-method-comparison.ts`：已有评测结果的只读页面投影，不启动评测。
- `.test.ts`：邻接单测与桌面应用策略测试。

付费实验、评分与验收入口统一在`../sim/evaluation/`；不再在desktop目录增加experiment／grade／score入口。这里保留的是服务、展示与应用调用，不是评分真值来源。

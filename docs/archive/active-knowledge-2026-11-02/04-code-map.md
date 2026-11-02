# 历史快照：实现地图与待恢复连接

更新：2026-11-02。路径存在不代表已接通；本页基于核心文件与历史报告审阅，不声称已逐文件审计所有源码。

|资产|入口|可复用部分 / 不能误报之处|
|---|---|---|
|短期工作Context|`src/agent/spatial-working-context.ts`|current/location/recent/anchors/retrieved/outputs、过期、限容；不是长期库|
|空间判断控制|`src/agent/spatial-context-loop.ts`、`spatial-context-protocol.ts`、`spatial-context-vlm.ts`|每轮assessment、检索续轮、来源校验、提交后发布；旧循环还支持问答耦合，恢复时必须分离|
|长期空间库适配|`src/agent/spatial-context-memory.ts`|new别名→UUID、空间判断写入/重评、实际检索器；不是只有描述的事实库|
|长期空间持久层|`src/agent/spatial-sqlite-store.ts`、`spatial-sqlite-service.ts`|observations/places/assignments/visits/transitions/revisions；精确事务/历史修订语义需恢复前专项核查|
|检索与证据|`src/agent/spatial-retrieve.ts`、`src/assistant/harness/memory-access.ts`|有界历史搜索/检查、截止与交付记录；搜索候选≠看过图|
|经历/事件组织|`src/assistant/organized-experience-memory.ts`、`incremental-experience-organizer.ts`|独立SQLite、修订、时间/知识双门禁；旧词项候选/启发式边界不等于正确空间身份|
|通用历史调查|`src/assistant/memory-investigation-question.ts`、`causal-context-question-v2.ts`|旧组织路径已弃直接locate代答，调查工具翻阅实际来源；56已去专用计数字段/流程，不能恢复52的过期强制计数协议|
|更早组织契约|`src/agent/experience-segments.ts`、`segment-interpretation-store.ts`、`experience-graph.ts`、`visual-experience-memory.ts`|可修订经历/身份/证据；需要真实输入适配，不因import类就算接通|
|原实时调度|`src/assistant/three-agent-service.ts`、`three-agent-factory.ts`、`three-agent-store.ts`|独立两槽提取、有序提交、持久任务、交互槽；factory默认暂停，capture.start/resume才启动；现fact-first finalize不生成完整空间状态|
|独立当前提取|`src/assistant/source-bound-description.ts`、`fact-first-policy.ts`|三摄一请求、来源信封绑定；短描述不证明覆盖全部视觉细节/空间身份|
|Pi持续空间|`src/assistant/harness/spatial-session.ts`、`session-context.ts`、`context-store.ts`|真正Session/压缩/检查点；完整历史污染等旧失败仍需处理|
|诊断来源账本|`src/assistant/harness/spatial-evidence-state.ts`、`source-context-projection.ts`|来源与解释分离、本轮召回资格；最近4条源投影不是完整长期架构|
|共享空间＋私有问答|`src/assistant/harness/layered-context.ts`、`first-sight-harness.ts`|请求边界组合、只读空间、独立私有Session；不恢复静态fork方案|
|退化适配器|`src/assistant/harness/realtime-spatial-context.ts`|最近5条事实发布、不可变快照；**不具备持续空间判断，不能作为完整生产者**|
|原图/调用审计|`src/agent/spatial-json-vlm.ts`、`spatial-reference-aliases.ts`、`bounded-network-retry.ts`|原图hash、局部别名、请求/响应/预算/未知预留；网络重试每次单独计费|
|旧固定地点分组|`src/agent/spatial-fixed-group-agent.ts`、`spatial-candidate-recall.ts`|候选全成员/分页/消歧等独立实验，不自动等于当前空间主线|
|独立位姿路线|`src/agent/pose-route-topology.ts`、`fixed-pose-route-assistant.ts`、`route-description-agent.ts`|保留实际位姿路径/反向说明的侧车试验，不拿理想pose给视觉身份代答|

## 评测入口的身份必须说清

- `run-realtime-memory-evaluation.ts`：最近813描述回放；已取消自动问答，仍不是完整空间Agent。
- `runSpatialPipeline` / `run-spatial-evaluation-pipeline.ts`：Pi诊断生产路径；逐方向提取＋有序逐帧Session，不是原实时调度开关。
- `run-fast-spatial-replay.ts`：预取诊断实验，不能改称原实时生产。
- `run-full-memory-standard-evaluation.ts`、`score-full-memory-standard.ts`：依赖已废止细节标准的旧入口，不直接重用。
- `score-realtime-position-memory.ts`：状态/来源结构审计，缺显式关系时报告未建立；不是完整能力主评分。
- `memory-state-review.ts` / `run-memory-state-review.ts`：读取已有状态的标签裁判准备/执行；不调用空间Agent补判断。
- `full-memory-questions.ts`：原15/37门槛与独立分支，只有空间关卡后经决定启用。
- `src/desktop/annotation-review-server.ts`、`web/annotation-review/`：hash绑定原图、审核追加日志与对照展示；不应把网页填字段当算法修复。

## 恢复验收矩阵

需逐项记录：选定实现 / 实际入口调用证据 / 专项测试 / 真实小样本 / 尚缺内容。以下目前均**未完成完整集成验收**：

1. 当前判断从原图到长期assignment再到短期location；新观察不继承旧位置。
2. 明确的短期淘汰、长期保留及证据读回，不用全历史摘要作弊。
3. 同区域连续、转场、同场所异区、真正重访、相似异地、未知/歧义。
4. 持续状态/压缩不污染直接观察，过期未决点撤下但历史保留。
5. 来源隔离、有序提交、失败中断、幂等恢复、实际版本检查点。
6. 问答只读空间、空间动态推进、私有历史隔离。

不要根据旧类名选择“最先进”版本；以01契约与可验证数据流决定复用范围。

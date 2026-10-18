# 时间入口与默认摘要：逐变量修复

修复前tag：`spatial-memory-before-time-summary-20261018`（ff155c2）。旧90题、原答案/分数/评测产物冻结，不覆盖。不修改空间识别、合并、地点分区算法，不调整走廊标签或回答任务提示词。

## 阶段1：只增加日历查询

学校样本按用户授权假设首帧为`2026-10-18 09:00:00 +08:00`。`run/school-calendar-v1/clock.json`明确kind=assumed；保持原activity/source时标，不伪造真实拍摄日期，20分钟段间空白保持原跨度。新public日历题在独立`calendar-questions.json`，不改旧题库。

底层SQL继续使用原at_ms索引/截止权限；只在入口把完整日历时间转换为同一源时钟，支持ISO带时区及完整中文年月日时分秒，拒绝无效日期/时区和混合冲突边界。工具新增atTime/afterTime/beforeTime；旧query/数值时间接口保留。查询结果在已配置clock时标注日历时间与captured/assumed来源。

隔离编译dist/calendar-v1；8项相关TS测试通过。离线对90题内52个明确历史地址做“原段秒→日历字段”真实SpatialRetriever逐项对照，候选ID全部相同，0模型调用，回执`run/school-calendar-v1/equivalence.json`。因此时间适配本身未改变这些检索候选；不把它当作模型端到端准确率保证。

## 阶段2：只增加受限历史摘要，不改工具关闭策略

统一Qwen发送层每次请求注入一个MEMORY_SUMMARY_JSON，包括工具续轮、最终回答、协议重试。即使无历史，也明确传空摘要/未知，不编造学校背景。RequestAgent从真实retriever因果快照取已提交的逐观察判断；getSceneMemory、感知working-state、场景及变化baseline各有来源。三类直接空间识别HTTP入口也使用同一摘要包装，原识别prompt、分区/合并规则不改。旧dist与冻结结果不动；盲判分器不注入系统记忆，避免评测污染。

自动压缩使用确定性摘录而非新增VLM调用：去重计数、用户背景（必须显式提供）、最近项、早期/高频锚点，最多8项/2400字符，单项220字符，附来源ID、观察时间、可用时间及截断/省略信息。历史源库不删不覆写，可随时重检；SQL只读取截止前的reason，过滤pending、其他recording、延迟判断和当前/未来观察，不读可能包含未来信息的可变place summary。默认取最早16＋最近96条组成有限视图，明确不是全历史摘要。摘要不会给图片增加inspected权限，也不能替代原图引用或证明当前仍在某地。

为控制变量，`runtime.memorySummary=false`只供同题开发对照；默认开启。工具可用性修复尚未混入此阶段。新增摘要上限/压缩/源保真、因果遮蔽和真实HTTP每轮恰好一个摘要的断言，含既有工具调用、v2目标白名单等14项TS测试通过。单独编译dist/summary-v1，尚不声称正确题无语义退化，需同题实验验证。

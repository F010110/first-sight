# 时间入口与默认摘要：逐变量修复

修复前tag：`spatial-memory-before-time-summary-20261018`（ff155c2）。旧90题、原答案/分数/评测产物冻结，不覆盖。不修改空间识别、合并、地点分区算法，不调整走廊标签或回答任务提示词。

## 阶段1：只增加日历查询

学校样本按用户授权假设首帧为`2026-10-18 09:00:00 +08:00`。`run/school-calendar-v1/clock.json`明确kind=assumed；保持原activity/source时标，不伪造真实拍摄日期，20分钟段间空白保持原跨度。新public日历题在独立`calendar-questions.json`，不改旧题库。

底层SQL继续使用原at_ms索引/截止权限；只在入口把完整日历时间转换为同一源时钟，支持ISO带时区及完整中文年月日时分秒，拒绝无效日期/时区和混合冲突边界。工具新增atTime/afterTime/beforeTime；旧query/数值时间接口保留。查询结果在已配置clock时标注日历时间与captured/assumed来源。

隔离编译dist/calendar-v1；8项相关TS测试通过。离线对90题内52个明确历史地址做“原段秒→日历字段”真实SpatialRetriever逐项对照，候选ID全部相同，0模型调用，回执`run/school-calendar-v1/equivalence.json`。因此时间适配本身未改变这些检索候选；不把它当作模型端到端准确率保证。

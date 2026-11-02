# Pi空间session重跑与问题分支（实施中）

> 问题分支设计已被用户纠正，当前方案见[59](59-live-spatial-module-and-private-question-context.md)：持续空间模块与独立用户问答模块动态组合，而非问题session fork。下文保留为实现过程记录。

## 用户修正后的架构

不再把旧60秒recentContext包装成Pi输入后直接复测。必须先从全部原图按时序重新运行空间记忆Agent，形成正式、连续、可压缩的空间session；保存每个时刻的上下文。问题Agent继承对应时刻的session，并只在自己的分支写入问题、调查、答案和completed-question-context。空间Agent不读这些问答。

连续产品会话可以积累自己的问答记录；独立评测题仍从各自空间时刻fork，避免互相泄漏答案。源session即使已经处理到未来，fork也只选择指定祖先tip。

## 已实现

- `src/assistant/harness/spatial-session.ts`：一个持久Pi空间lane连续接收观察。record_context工具提交当前来源绑定的观察、假设和未决点。没有题目/私有标注输入。
- `session-context.ts`：把Pi消息、最近compaction及保留尾部物化为可查看的上下文，不删除原始session entries。
- 每个观察保存context JSON、SHA256、session metadata、tipId、时间、来源、memoryRef和skill版本；这些构成可审查的时刻检查点。
- `first-sight-harness.ts`支持从空间检查点fork。此模式不注入旧recentContext，召回使用这次新空间运行产生的事实，不用旧提取结果。已继承的可见记录与新工具召回分开记账。
- 问题完成后写question_context自定义entry及物化context.json；不回写空间session。问题结论始终标记为模型结果，不升级为空间事实。
- 行为提示独立为first-sight-assistant、memory-investigation、visual-inspection、context-compaction和spatial-memory五个小Skill。旧实现保留供历史回归，不删除用户历史服务。
- Pi会话和工具执行是真实AgentHarness；HTTP仍经原有审计/用量的JSON兼容bridge，不冒称供应商原生tool calling。

## 验证

新测试证明：先处理o1再处理含未来哨兵的o2后，从o1检查点提问只得到o1上下文；问题与答案写入问题session；源空间session文件哈希不变。另有上下文快照、通用读取/inspect、来源校验、Skill加载及会话压缩测试。

本轮完整本地测试487/487通过。随后增加问题Agent的Skill角色隔离（不能加载空间生产/压缩专用Skill），重新编译及4个harness专项测试通过。尚无新空间session架构的真实问答分数。

此前Pi迁移v1/v2/v3小试保留，但不能代表此新架构：它们仍基于旧短期窗口。观察到来源引用重复失败、独立decision工具规划循环、错误目标匹配和当前场景替代历史。独立decision工具已经移除，简短assessment与实际工具调用同轮进行。不得以这些旧小试分数声称空间session架构已验证。

## 正在执行的完整空间重跑

命令：

```
node dist/current/sim/evaluation/replay-pi-spatial-session.js run/unioncity-questions90-v2-run1/input.json run/unioncity-pi-spatial-replay-v1 --confirm-paid
```

只传入813组公开原始三摄、各自ID和时钟；不加载旧事实、旧答案、地图或42段标注。输出为新目录，不覆盖旧数据库/索引/服务。当前由后台任务执行，完成状态必须以complete.json为准，不能把已启动当已完成。

`prepare-unioncity-pi-session-pilot.py`在完整813个检查点和哈希校验通过之前拒绝生成后续问答试验。准备的新问答快照来自新空间更新，正常分支绑定准确时刻的spatialBase。禁用/直接供图控制仍是独立空历史session，不把“继承全部session但关工具”冒称旧的memory-disabled控制。

## 尚待完成

1. 完整空间重跑及其实际输入/压缩/逐时刻检查点审计；故障时保留失败和未知用量，不盲目重放未结算operation。
2. 从新session复测原7题，再评估完整15题/37分支。
3. 扩展channel评估区分继承session中的信息与真正工具召回；不能把已有session内容自动算自主长期检索成功。原规模扩大门槛不放松。
4. 在线持续服务目前仅增加显式pi-harness-v1入口，现有服务没有自动切换；最终切换必须接上持续空间session，而非旧窗口兼容入口。

未完成上述事项前，不启动90题，不声称系统重构和新架构验证已全部完成。

# Pi harness 实施方案（设计，尚未迁移运行时）

## 已核查的底座

- 当前依赖已经是 `@earendil-works/pi-agent-core@0.85.1`、`pi-ai@0.85.1`，无需先升级。
- `src/agent/request-agent.ts` 等已有 Pi Agent，但当前长期记忆问答 `memory-investigation-question.ts` 仍为手写 JSON 动作循环。
- 本地包不只有 Agent，还公开了 AgentHarness、会话存储、lanes、skills、压缩和 hooks。
- 采用本地类型定义，不直接照搬上游 main：本地 Agent 有 prepareNextTurn，网上 main 已出现 prepareRequest/finishTurn 等变更。
- `harness/context` 的 Context 是执行/取消/遥测上下文，不是模型的世界上下文，不能混为一谈。

## 推荐结构

使用 `AgentHarness.create` 而不是在外面重造会话/压缩框架。保留现有观测生产、事实数据库和组织索引；替换问答执行层。

拟新增目录：

```
src/assistant/harness/
  first-sight-harness.ts       # Pi 会话、lane、请求生命周期
  context-store.ts            # 版本化运行上下文和提交游标
  context-projector.ts        # 按调用/评估边界投影上下文
  memory-tools.ts             # 已有机械访问操作的 Pi tool 适配
  evidence-ledger.ts          # 已交付记录、原图和来源权限
  skill-registry.ts          # 受信 skill 目录、加载和版本记录
  compaction-policy.ts        # 压缩准备、校验、提交
  provider-boundary.ts        # 原有用量、请求审计、取消和超时
skills/first-sight/
  memory-investigation/SKILL.md
  visual-inspection/SKILL.md
```

第一版只提供只读记忆和 skill 加载工具，不向 Agent 开放默认 bash 或任意文件读取。Skill 文档加载也只允许白名单目录；skill 不拥有扩权能力。

## 系统上下文：持续维护，按请求生成快照

系统维护的上下文不等于把所有环境文字提升为 system 指令。

1. 稳定 system policy：角色、证据与时间边界、通用检索决策要求、安全规则。
2. 动态 runtime context：当前时钟、数据新鲜度、最近观测、活跃用户目标、可用历史范围、未决事项；始终标记数据来源和版本。视觉文字和摘要不是指令。
3. 工作会话：对话、检索结果、笔记、已加载 skills、会话压缩摘要。
4. 外部不可变证据：原图、原始观察、事实记录。它们不因上下文压缩而删除。

观测提交后更新 context-store；在每次模型请求边界读取一致版本，经 `transform_context` 投影。当前推理中的更新在下一请求可见，不在一条正在发送的请求里改变证据范围。需要主动提醒时使用排队消息，不为每帧强制唤醒模型。

上下文版本至少标记 recordingId、事件时间、knowledge/commit cutoff、最近源引用、freshness、摘要覆盖边界。评估分支固定 cutoff；线上下一轮可推进。系统当前事实与模型猜测/用户陈述分开，冲突不自动覆盖。时钟断点和重启不得靠叙述抹平。

## 自主搜索决策

稳定 system policy 只要求通用证据充分性检查：问题指向什么对象/时刻？当前可见证据是否对应？是否需要查过去或澄清？

需要可审计时用简短 decision 记录：现有证据是否足够、需要的证据范围、下一步（回答/召回/澄清）。不是长篇思维链，不包含第几次等题型专用变量。实际检索仍由 Agent 工具选择完成；不得用中文关键词正则强制路由，也不以 decision 格式填写成功代替检索成功。

先采用一个问答 lane 直接持有通用记忆工具，减少“答题Agent根本不委托就看不到记忆”的瓶颈。独立调查 lane 可在确有上下文隔离需求时后续加入；不是第一版强制双Agent。观测生产仍与问答分离。

## Skills

复用 Pi `loadSkills` 和 resources 中的 skill 元数据。常驻只放名称、描述和版本；按需加载正文。自动选择需要模型可调用的受限 skill 加载工具；`lane.skill(...)` 是应用显式调用入口，不应误称其自动识别问题。

- memory-investigation：通用检索操作、来源含义、局部未命中和不存在的区别。
- visual-inspection：描述可能遗漏细节、图像实际交付、视角/可见范围局限。

工具签名放在工具 schema，不在 skill 重复维护。无计数题skill、题号、参考答案或私有评测路径。Skill 无法替代工具层权限。公共决策原则不能藏在尚未加载的 skill 中，否则又出现不搜索就不知道该搜索的问题。

## 压缩

复用 Pi 自动阈值压缩和 `lane.compact`。在安全边界定期检查是否需要压缩，不按每几次读取强制写笔记。时间周期只是检查触发器，结合上下文token/图像预算和新增内容判断；无新增信息不反复摘要。

- 不可压缩掉：system policy、当前用户问题、固定数据 cutoff、活跃工具调用及其结果配对、最近必要证据。
- 摘要保留：用户目标、带来源的已发现内容、候选与反例、未决点、已搜索/未检查范围、可恢复来源游标。
- 原图不变成“摘要宣称看过即可引用”；工具层保存独立 inspected/delivered ledger，必要时重新inspect。
- 压缩结果作为可修订工作摘要，不升级为事实或认证“不存在”。
- 压缩写入新的会话 entry，保留原始事件。校验引用、覆盖边界和工具配对后原子提交；失败保留原上下文，不提交半份摘要。

Pi 默认摘要偏编码会话，需用 before_compaction 提供适合观测记忆的摘要策略并验证。外部近期环境摘要与对话压缩分开更新，不能把全量视频历史不断塞进会话摘要。

## 具体 Pi 接入点（0.85.1）

- `AgentHarness.create({session, models, model, tools, resources, compaction, ...}, executionContext)` 创建运行时。
- `transform_context`：请求前按截止时间重建动态上下文；不会把新观测偷偷加入冻结评估分支。
- `before_tool` + 工具自身校验：白名单、来源和时间权限；工具执行时重新校验，避免上下文提示充当权限控制。
- `before_request` / `before_payload` / `after_response`：保留原请求审计、JSON兼容设置、usage、未知预留及错误语义；压缩调用也需要经过同一计量边界。
- `before_compaction`：自定义摘要与来源校验。
- `JsonlSessionRepo`：第一版耐久会话；避免新接 SQLite backend 依赖。JSONL不会替代原事实SQLite库。
- `lane.resume` 等恢复API：重启前先核查开放operation，不能盲目重放工具或假装失败请求完成。只读工具也保留请求/结果审计。

现有 createQwenModel 只导出 model/streamFn，而 AgentHarness 需要 Models。新增 provider factory 或兼容性返回 models，保留旧调用者。新harness路径禁用旧 withMemorySummary 的隐式注入，以免两份上下文互相矛盾；旧路径行为不变。现有 spatialJsonVlm 的记账不能因为改走原生tool calling而丢失，需抽出可共用请求边界，不是假定 Pi 自带项目的用量/预留规则。

## 迁移与验收

1. 先抽取只读 MemoryAccess 和 EvidenceLedger，与旧循环共用；旧运行归档不改。
2. 建立 Pi harness 的隔离新入口，接入 mock provider、原生工具、一个独立 skill。
3. 接入动态 context-store、请求快照和压缩；测试记录不断更新、未来/晚到结果过滤、原图退出窗口、恢复和压缩失败。
4. 接入现有评估runner，显式新runtime开关，默认旧服务不动。同题对比；原15题/37分支门槛不变，不能用迁移成功代替效果过关。
5. 小物件/不存在等新的真实题先交用户审阅。本地合成测试可先验证机制，不冒充真实VLM成功。

这是一份实施设计；尚未安装/升级依赖、切换服务或宣称已完成harness迁移。

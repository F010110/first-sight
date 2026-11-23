# 空间记忆：当前完整设计 与 三个参考实现的对照

更新：2026-11-05。本文只做**现状描述与对照**，不是架构变更提案；架构契约见 `docs/active/01`、理由见 `02`、状态见 `TODO.md`。

参考对象（来自 `docs/notes/suggestions/建议14.md`）：

- **StreamMind / StreamArena**（arXiv 2608.05703；`JIA-Lab-research/StreamArena`）
- **DirectMe / UCS-Bench**（ICML 2026；`cocowy1/UCS-Bench`）
- **EventMemAgent**（ECCV 2026；`lingcco/EventMemAgent`）

证据范围：上述仓库的 README/目录结构/`method/streammind/agent.py` 契约、论文摘要与 leaderboard。**未逐行阅读它们全部源码**，因此下面对参考实现的描述只到"它们自己文档所声称的结构"，不外推到实现细节。

---

## 一、当前完整设计

### 1.1 输入、时钟与窗口

| 项 | 实现 | 位置 |
|---|---|---|
| 输入 | 公开 `public-source.json`，每条含 id / atMs / 三摄（front/left/right）路径与 sha256 | `run/gmod-annotated-rerender-v2-final/public-source.json` |
| 原始时间 | `atMs` 为源时钟；`sourceAtMs` 保留采集时间 | `src/sim/evaluation/spatial-window-plan.ts` |
| 投递时钟 | `atMs += max(2000, Δ×2)`；本轮 2s 一帧 | 同上 |
| 窗口 | 固定 **8s 时间桶**，每窗最多 **4 次观察**；满 4 或定时器到期即封口；录制切换强制封口 | `service.ts`（`bucket.length===4` / `flushWindow`） |
| 归档 | 原图按 sha256 落盘到 `originals/`，元数据与事实入 SQLite | `service.ts` `observe` / `SpatialLongTermStore.archive` |
| 计划窗口数 | 按 `Math.floor(atMs/8000)`+录制变化计数（100 帧=25 窗，813 帧=204 窗） | `run-spatial-memory.ts` |

### 1.2 调度、容量与实时

| 机制 | 行为 | 位置 |
|---|---|---|
| 准入容量 | 未判断观察计入 `admitted`；默认 `maxPending=12`，强制实时为 **32** | `run-spatial-memory.ts` |
| 投递节拍 | `deliveryDueAt` 按投影 atMs 排期；`--require-realtime` 下不可与 `--replay-time-scale=2`、`queue` 同用 | 同上 |
| 实时判定 | 投递滞后 > 一个节拍即记违规；违规则 `completed=false`；收据输出 `realtime{enforced,maxDeliveryLagMs,deliveryViolations,toleranceMs,backpressureWaits,skippedWindows,satisfied}` | 同上 |
| 忙时跳过 | 提交链进入时若已有其它窗口排队 → **立即跳过本窗**（不等识别），证据已耐久，后继从 `skippedBefore` 重读 | `service.ts`（`queuedWindows.size`） |
| 跳过内容 | `skipWindow` 存 `{startMs,endExclusiveMs,recordingId,observations:[{id,atMs,facts}],reason}`；不产出位置判断、不写地点成员 | `long-term-store.ts` |
| 容量释放 | 跳过即 `release()`；重开库不把跳过窗计入容量 | `service.ts` |
| 判断预算耗尽 | 单窗超过轮次上限 → 记为 `judgment-budget-exhausted` 跳过（整轮最多 5 次），超过则中止 | `service.ts` |
| 覆盖义务 | 实时模式：`已判断窗 + 跳过窗 = 计划窗`；另给 `fullWindowCoverage` | `run-spatial-memory.ts` |

### 1.3 图片理解（perception，无历史）

| 项 | 实现 | 位置 |
|---|---|---|
| 粒度 | 一窗一次调用（≤4 观察 ×3 摄 = ≤12 图） | `models.ts` `perceiveWindow` |
| 输入隔离 | 只给当前窗口的观察与时间，不收历史/身份/候选 | 同上；`spatial-json-vlm.ts` 校验 perception 字段白名单 |
| 输出 | 每个观察 ID 一条 `{summary, details[]}`，逐观察绑定 | 同上 |
| 失败处理 | 最多 3 轮有界反馈（只补缺失来源）；仍缺则**单帧回落**（每帧≤2 次、同样无历史） | `service.ts` `extractWindow` |
| 事实缺失 | 空事实=未拿到证据，不伪造；空间判断会拒绝无事实窗口 | 同上 |

### 1.4 空间推断（Pi 持续会话）

| 项 | 实现 | 位置 |
|---|---|---|
| 运行载体 | Pi `AgentHarness` + JSONL Session + skill `spatial-memory-v2` | `pi-reasoner.ts`、`skills/first-sight/spatial-memory-v2/SKILL.md` |
| 工具 | `memory_timeline` / `memory_find` / `memory_read` / `memory_inspect` / `memory_place` / `memory_skipped_sources` / `memory_add` | `pi-reasoner.ts` |
| 输入 | 本窗 ≤12 图（仅首轮）、facts、工作Context状态头、revisit 候选、`skippedBefore`（含最近一个跳过窗的原图） | 同上 |
| 轮次 | 单窗最多 **12** 次请求；中间轮必须带完整 assessment 且不得提交 relations/revisions | 同上 |
| 状态取值 | `known` / `new` / `unknown+boundary.regions`；**裸 unknown 拒绝** | `contracts.ts`、`pi-reasoner.ts` |
| 身份证据 | `known` 必须引用已交付工作Context或已检查历史观察；缺证据时最多 3 次自动补给（给地点最新窗口原图 + 可引用 ID），之后禁止再提 known | `pi-reasoner.ts` |
| 新地点 | `new` 触发对自动召回候选的图检查并重判；需具体布局，有 `previousRegion` 时需区域变化证据 | 同上 |
| 跳过窗补判 | 每轮把最近一个跳过窗的三摄一并交付，要求用 `revisions` 归入判定地点或写进 unresolved | 同上 |
| 改名 | `memory_add.rename{name,reason,sourceIds}`，追加 `__place_name` 版本，不改 ID/旧名/旧快照 | 同上、`long-term-store.ts` |
| 压缩 | 提交后**后台**用"除最近 4 条外的历史"预生成摘要；触发时若就绪则即时套用并把增量消息原样并入 retainedTail；未就绪才同步压缩 | `pi-reasoner.ts` |
| 压缩阈值 | `reserveTokens: 64000`、保留尾部按 token 预算 | 同上 |

### 1.5 提交与长期记忆（schema v4）

| 表 | 作用 |
|---|---|
| `observations` | 观察原文、facts、错误；`id` 唯一、按 seq 时间序 |
| `states` / `checkpoints` / `checkpoint_bindings` | 每次整窗判断的不可变快照、Context 检查点、Pi 分支与工具参数绑定 |
| `places` / `visits` / `place_records` | 地点、访问、窗口归属（原始归属不可改写） |
| `place_notes` / `place_note_sources` | Agent 笔记与来源（同文去重，来源可追加） |
| `place_profile_revisions` | 追加式档案修订；保留键 `__place_name` 存名字版本 |
| `revisions` | 观察级重新归属（迟到证据），追加不改旧快照 |
| `relation_assertions` | same-facility / different-region 关系 |
| `skipped_windows` / `skipped_members` | 跳过窗及其成员；`consumed_version` 标记被后继消费 |
| `window_members` | 窗口成员（覆盖核算依据） |
| `events` | 跳过、拒绝、时序、失败等审计事件 |

事务语义：整窗提交（地点/访问/成员/笔记/名字/回执/检查点）同一事务；失败整笔回滚；Context 只在提交成功后发布。

### 1.6 短期 Context

| 项 | 实现 |
|---|---|
| 主体 | Pi Session（工具轨迹、模型输出、失败）自动记录 |
| 结构化状态头 | 当前位置、观察范围、地点/访问、来源、提交版本（用于一致发布与恢复） |
| 投影 | 去重后的 recent/anchors/retrieved + 本轮实际读回证据；有界 |
| 压缩 | 见 1.4；压缩产物是工作摘要，不是长期事实 |
| 恢复 | 同会话检查点恢复，校验 session/tipId/skill 版本/context hash；新会话不自动回灌历史 |

### 1.7 运行收据与评测

| 项 | 实现 |
|---|---|
| 收据 | `complete.json`（v6）+ 每次尝试 `complete-recovery-*.json`；含 `inputDrainComplete`、`completed`、`coverageObligationMet`、`realtime`、`judgmentFailureSkips`、耗时分位、两条 lane 的 token/费用 |
| 计时 | `delivery.jsonl`（投递）、`task-timing*.json`（每窗 seal/perception/judgment 分段耗时） |
| 裁判 | 独立只读流水：盲取证（12 窗/块）→ 对照参考与候选 → 综合；机械分数上限；Max/Flash 可切（Flash 需显式开启并记录降级） |
| 测试 | 全库 588 项通过（含实时、跳过、压缩、改名、证据门禁） |

### 1.8 关键不变量

1. 原图与观察不可改写；解释可追加修订，不覆盖历史。
2. 没有事实就不做空间判断；没有判断就不伪造位置（跳过窗只作证据）。
3. 引用必须对应本轮实际交付/检查过的来源。
4. 长期提交成功后，工作Context与检查点才发布。
5. 实时性只约束输入投递，不用"等 Agent"换节拍。
6. 压缩摘要不是长期事实，长期库不压缩。

---

## 二、当前实测数字（供对照用）

| 指标 | 100 帧（rt100-v8） | 813（多次尝试） |
|---|---|---|
| 空间推断 p50 / p90 | 5.54s / 10.23s | 7.0–8.0s / 15–22s |
| 单轮窗占比 | 21/22 | 95%+ |
| 投递滞后 p50 / p95 | 23 / 33 ms | 24 / 69 ms（rt 系列） |
| 跳过比例 | 3/25 | 40–53%（rt-v5/v6） |
| 每窗图片体积（首轮） | ≈2.4 MB | 同 |
| 压缩频率 | 2–3 次/22 窗 | 0.14–0.2 次/窗 |

---

## 三、与三个参考实现的对照

| 维度 | **First-Sight（当前）** | **StreamMind / StreamArena** | **DirectMe / UCS-Bench** | **EventMemAgent** |
|---|---|---|---|---|
| 目标 | 持续三维（三摄）观察 → 空间位置/地点/访问的耐久记忆 | 小时级流式视频问答（RTP/回溯/工具/主动） | 第一视角连续空间推理问答 | 在线视频问答 |
| 输入节拍 | 固定 2s/观察、8s/窗 | 驱动按墙钟 2fps 推帧，`on_frame` 不阻塞 | 逐帧离线建图 | 视频流，自适应采样 |
| 快慢分离 | 提取与判断分两条泳道；判断单写入 | **前端（交互/监控）与后端（记忆构建/检索）分离**，各自独立调度 | 建图（离线）/存储/检索分层 | 记忆构建与推理分离（工具化） |
| 忙时策略 | 跳过本窗，证据留给后继；判断预算耗尽也记显式缺口 | 驱动从不等 Agent；Agent 自行决定何时 `commit_answer`（首次生效） | 无实时约束（离线引擎） | 事件级 reservoir 维持有界活跃上下文 |
| 提交模型 | 整窗事务提交 + 不可变版本 + 检查点 | **承诺式提交**：`commit_answer(qid)` 任意时刻、先到先得 | 场景图落盘后检索 | 事件写入 + 检索 |
| 记忆组织 | 地点→访问→窗口→观察/来源；笔记与名字版本化 | **三层 SQLite 记忆**（会话/事实/长期），OCR 索引 + 关键词+向量检索 | **度量 3D 场景图**（物体/地点/位姿/时间） | **事件中心层级记忆**（事件分段 + 事件级采样） |
| 时间语义 | 源时钟 + 投影时钟分离；按版本/可用时间/事件截止投影 | 视频时间戳；检索带时间锚定 | 查询时刻因果检索（只看之前） | 事件时间线 |
| 压缩 | Pi 会话 + 后台预压缩（增量原样保留） | 未在文档中强调压缩机制 | 不涉及 | **事件级有界上下文（≤32 帧）** |
| 检索 | SIFT+RANSAC 地点候选 + 时间线/地点分页 + 原图检查 | 关键词+向量 + OCR + 视觉核实的回溯 | 空间结构化检索 | 记忆检索 + OCR + 开放词表检测 |
| 工具选择 | 固定 skill + 证据门禁 | 固定五角色流水 | 固定规则/VLM 生成 | **GRPO 学习何时用哪个工具** |
| 评测 | 独立整体裁判（盲取证→对照→综合，机械上限） | 统一 JSONL + LLM judge；测每题延迟 | 基准 QA（多选/VLM） | OVO-Bench / StreamingBench |
| 实时性口径 | 投递节拍 + 每窗推理分段耗时 | 查询到回答延迟 | 不主张实时 | 在线但非硬实时 |

---

## 四、可借鉴项（按收益/风险排序）

| # | 借鉴点 | 来源 | 解决我们什么问题 | 落地形态（不改语义） | 风险 |
|---|---|---|---|---|---|
| 1 | **承诺式提交 + 非阻塞驱动** | StreamMind `agent.py` | 忙时只能整窗跳过，覆盖掉到 50% | 允许 2–3 个窗口同时在判，各自带 `windowId` 承诺提交；先到者入库，后到者走修订；输入永不等待 | 乱序提交会打破"连续前缀"约束，需重定义提交顺序与检查点 |
| 2 | **事件级有界活跃上下文** | EventMemAgent | 上下文膨胀 → 压缩频繁（0.14–0.2/窗） | 活跃上下文只留"换区/边界/进入离开"事件代表 + 最近 k 窗，窗口全文留在库里按需检索 | 事件由谁定义？必须先有事件语义，否则会退化成摘要 |
| 3 | **场景自适应采样/窗口** | StreamMind v2 | 固定 8s 对静止段浪费、对变化段不够细 | 静止段延长窗口、变化段提前封口；窗口长度版本化 | 改变实验定义（窗口数变化），需重新基线 |
| 4 | **独立 MemoryWriter 角色** | StreamMind 五角色 | 判断与档案维护耦合，单窗变慢 | 判断只产出 assessment；地点档案/笔记写入交给轻量后续任务 | 写入延迟会让档案滞后于判断 |
| 5 | **时间锚定检索 + 看图核实** | StreamMind v2 | 813 规模检索成本高 | 先按时间范围缩小候选，再 `memory_inspect` 核实 | 与现有 SIFT 候选需统一排序策略 |
| 6 | **分层存储接口** | DirectMe `mapping/storage/retrieval` | 我们的 store 已分层，但检索入口偏少 | 增加只读检索层（时间/地点/事件）而不改 schema | 低 |
| 7 | **统一记录 schema + 共享 judge** | StreamArena | 我们每次运行产物格式略有差异 | 把 `complete.json`/`task-timing` 固化为可跨运行比较的 schema | 低 |

## 五、不建议照搬

| 参考做法 | 原因 |
|---|---|
| DirectMe 的度量 3D 场景图与位姿 | 它自己就把建图放在离线；我们不做精确坐标，硬接会引入新的失败面 |
| StreamMind 的 397B 级基座成绩 | 不能用来推断我们 Flash 的水平 |
| EventMemAgent 的 GRPO 工具策略 | 需要重训模型，与"skill + 证据门禁"路线冲突 |
| StreamMind 的主动监控（Pro） | 属问答侧能力，本轮不在空间生产范围内 |

---

## 六、下一步（待确认）

1. 先做 #1 的**最小版本**：限流在判窗口数（2–3），允许乱序完成、按 `windowId` 承诺提交，输入完全不等；用 100 帧对比"跳过率 / 空间推断 p90"。
2. 若 #1 有效，再做 #2 的事件级活跃上下文，把压缩从"每 5 窗一次"降到"每 20 窗一次"。
3. #3 会改变窗口定义，需要单独一轮基线，不与 #1/#2 混在一起验证。

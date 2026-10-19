# 空间记忆算法完整流程与用户问答

本文描述当前SQLite空间记忆主线，不把实验性V2、传统SceneAgent、理想证据oracle混称一个算法。代码定位以文件/函数为准。学校已生成的记忆库不因本次QA修复重新识别，旧成绩保持冻结。

## 1. 总图

```text
同一时刻左/前/右原图 + observationId + 时间 + recordingId
 → 原始证据归档/哈希 → SQLite observations（pending）
 → 小窗口调度（最多4个观察）
 → SQLite有限地点目录/历史代表图 + 默认摘要 + 本窗口原图
 → qwen3.8-flash：places / assignments / reason
 → 协议校验 → 原子提交地点、归属、visit、transition
 → 下一窗口；最后flush至pending=0

用户问题 + 当前原图
 → 建立问题截止时间与权限 → 默认压缩摘要
 → VLM选择直接回答，或SEARCH → INSPECT原图 → VLM回答
 → 检查JSON、已查看来源与必需引用
 → 必要时一次锁定正文的元数据回退
 → 有效回答/拒答，或保留原失败；保存原始输出、轨迹和用量
```

这里输出的是有证据链的离散地点记忆与自然语言答案，不是精确3D地图、完整建筑平面图或已证明可通行的导航图。

## 2. 第一组图片：观察与时钟

一个SpatialObservation代表观察者同一时刻的一个位置：id、atMs、frames及可选recordingId/sourceAtMs。左/前/右三图不是三个地点；图片路径本身也不提供物理区域真值。学校样本共有10段、851个三视图观察、2553张原PNG。

学校sourceAtMs是录像内秒数；atMs是活动轴，跨段有间隔；日历层另提供MemoryClock。当前首帧固定假设2026-10-18 09:00:00 +08:00，kind=assumed，不声称真实拍摄日期。源轴不重写，不填补跨段空白。正式设备应由可信采集元数据提供captured日期和时区。

原图归档和SHA256负责证据保真，拓扑SQLite主要保存路径与结构化观察，不等于把所有图像二进制塞进提示。回放/评测在给模型当前图前核验哈希。其他生产入口应保持同等采集信任边界，不能把学校入口的校验自动视为所有设备都有。

## 3. 入库与窗口调度

`spatial-sqlite-store.ts`的ingest写入observations，先pending=1。观察已入库不代表地点判断已成功。`SpatialSqliteService.tick`串行处理，避免两个识别请求同时修改地点身份。

每次取最早至多4个pending观察。非flush时，最早等待至少10秒且距离上次开始至少5秒；不足条件就等待。这是服务端调度，不是每5秒一定调用模型。失败保留pending，调用方可以有界重试/恢复，不能当成成功吞掉。

`context()`默认最多6个地点：最近地点、可选文本匹配、当前节点的部分常见邻居再补最近项。正常识别调用未传关键词，因此不应描述成全库视觉近邻搜索。主线没有向量图像embedding或全历史精确重识别保证。

## 4. VLM如何判断具体地点

`spatial-topology-vlm.ts: topologyVlm`使用qwen3.8-flash、enable_thinking=false、temperature=0、max_tokens=1800。有限目录提供id/summary；按最近时间选至多3个地点的最新代表观察，随后发送本窗口目标图。同一路径去重，最多通常是3×3历史图＋4×3目标图，而不是无限图像。

每次HTTP请求还带默认摘要，摘要不替代上述原图。识别要求：判断观察者所在空间而非隔门可见空间；一个窗口可跨多个地点；不能仅因旋转或新物体新建；开放区域不按功能名强拆；历史身份必须使用目录ID；新候选用new-N；不足时placeId=null。

输出JSON包含places和assignments。每个当前观察恰好一个assignment，含observationId、placeId、reason。已知地点可复用id；新候选必须有正面图像依据，但运行时协议校验不能证明模型判断在物理上一定正确。

识别器检查结构、白名单、重复和完整性。格式不合格最多再请求一次纠正；不会无限重试，失败落日志。这个识别阶段已有协议纠正不同于问答阶段的“正文锁定”回退，不能混为一谈。

## 5. 提交、重访与长期保存

服务再次验证，new-N映射为持久UUID，新节点初始candidate；已知节点沿用身份。每地点最多保留2个代表观察，更新时保留早期和较新参照，但全部原观察仍留库，非代表图仍可检索。

`commit`事务写入assignments、place数据并清除对应pending，更新visit和transition。连续相同地点、相同recording的观察可折叠为一次visit；跨地点的相邻观察形成有端点来源的转换经验。转换边说明“观察序列曾这样变化”，不证明门可通、路径安全或两个端点在同一层。

null归属意味着不确定，不强行建立新区域。地点重访是VLM对有限目录与参照的身份判断，不是只要名字都叫走廊就合并。有限候选漏掉远期地点时仍可能误拆，当前90题并未完整验收重访merge/split质量。

`revise`提供带理由/证据的确认、合并、拆分与undo，识别运行时不允许修订。保留修订记录及可恢复状态；不能把人工修订或实验V2结果静默替换已评分的记忆库。

## 6. 最后一组图片与恢复

停止输入后用flush逐次处理剩余窗口，直到pending=0。最后不足4个观察仍需处理，不把尾帧丢弃；最后一帧不是特殊语义结束标记。服务恢复读取SQLite的pending与状态，不要求重新调用VLM识别所有旧图。

最终产物是原始证据、观察表、地点表、assignment、visit、transition与修订/请求日志；不必为每一帧生成一段给用户朗读的文本。学校库已有217个提交窗口、pending=0；本次不重新生成它，因此新摘要对识别器的影响尚未在这个库上重放验证。

## 7. 用户提问入口与因果边界

`RequestAgent.observe`接收用户ask/watch要求和当前最多3张图。当前图按时间排序，附CURRENT来源标签；已提供历史图附HISTORICAL标签，一标签只对应紧随的一图。当前图不能证明历史事实，历史图不能证明当前仍然存在某物。

`spatialAlgorithmSession`把学校公开段秒地址映射到真实SpatialRetriever过滤条件，不用时间档案冒充空间算法。查询截止为问题之前；判断尚未返回的观察通过judgmentUnavailableIds遮蔽。评测可先建好库再通过截止模拟因果可用信息；这不是允许模型看到未来。

withCurrentEvidence只把真正交付的当前观察登记inspected。搜索候选和摘要文字不能登记为已看图。理想oracle是独立的对照证据通道，不向算法组提供private task答案/理想来源列表。

## 8. 每次模型调用的默认摘要及自动压缩

`memory-summary.ts`提供统一有界信封，qwen-provider在每次实际发送时注入，包括工具续轮、最后回答与锁定元数据修复，不持续追加到原对话导致无限增长。没有可靠历史就传空entries和unknown说明，不凭数据集叫school而塞入“这是学校”。

SQLite问答摘要仅取截止前已提交的逐观察reason，不读可能在离线回放末尾更新过的place summary。过滤pending、不可用判断和不匹配recording。最多取早期16条＋最近96条构成有限视图，再确定性去重计数；优先显式用户背景、最近项及早期/高频锚点。默认最多8条、每条正文220字符、整个JSON2400字符；包含sourceIds、时间、截断/省略计数以及非视觉证明警告。有clock时也带assumed/captured映射。

压缩不调用付费模型，不改写原库，不推断新事实。它是有限摘录，不是全历史无损总结，不保证会保留每条重要环境信息。用户背景必须由可信上层明确作为user-context输入，目前不能把userKnownFacts里系统自己说过的话自动当用户确认。其他感知/旧场景入口使用各自working-memory来源，不是与SQLite完全等价的实现。

## 9. SEARCH与INSPECT

工具retrieve_visual_history在同一接口支持两种操作。SEARCH用短字面关键词、placeId、时间范围/分页查候选，返回来源、时间、地点关联和提示；它不是图片证据。当前题也保留可选工具，不再因为当前图已就绪就完全撤掉历史访问。

日历入口支持atTime/afterTime/beforeTime，完整ISO时间优先，也支持完整中文年月日时分秒。MemoryClock映射回原at_ms，复用原索引和截止权限；无效日期、冲突边界报错。只说“昨天”或模糊时间的完整自然语言归一化还不是现成能力，不能声称任意日期表达都支持。学校52个明确源地址的日历对照候选一致。

INSPECT必须使用实际检索过且受截止允许的准确ID，读取原图并受图像预算限制。只有成功查看才加入inspected。学校算法会话预算12张历史图，搜索limit=4；不是把全库发给模型。查询失败不证明全历史不存在该对象。

工具每轮返回后VLM继续推理。若明确要求的来源都到齐，且本次确实新增查看了历史图，就关闭工具进入最终回答。第6个工具回合到限也明确移除发送层tools/required，再留最终JSON回答/拒答机会；运行有abort和请求预算，不允许无限循环。

## 10. 回答、引用验证与默认锁定回退

最终回答包含answer、kind、shouldSpeak、done、confidence、historicalEvidenceIds、abstained等。问答是一次性完成，watch另有只触发一次的状态。置信度是模型输出，不是校准正确率。

首先解析JSON并验证引用属于实际已交付/inspect的集合，非拒答要求有效引用；配置了requiredEvidenceIds时要求覆盖明确来源。无法支持的历史事实应该拒答，不能从装饰相似推出同一楼层。

本次接入默认的一次元数据回退：只在协议校验失败时，用同一个对话里已经给过的图请求一个patch，关闭工具，仍携带摘要；只允许historicalEvidenceIds与abstained两个键。运行时把patch应用到原JSON，其他字段全部原样保留，再验证。不会自动补ID，不重新生成事实答案，不在多个答案里择优。原输出、patch、成功/失败和用量通过trace保存；失败抛出的rawAnswer仍是原回答。

回退不能修复事实说错、没有看过所需图片、原JSON无法锁定或模型坚持违规。引用合法也不等于图像语义支持答案；完整的拒答语义一致性和题目来源检查仍由评测answerFailures/人工审核承担，不能宣称运行时已能自动证明语义正确。

## 11. 最终评测连接方式

`memory-provenance-evaluation.ts`现在要求准备时提供--calendar=目录；复制并冻结clock.json/calendar-questions.json，检查源replay哈希、90个唯一问题与原公开题id/原文/当前来源/截止一致。两组都向模型发送日历问题与同样的因果摘要；oracle只在证据选择上不同。原公开源地址保留给审计/来源校验，不把private标签引入算法。

冻结文件包含实际编译JS、摘要/时钟/锁定回退模块及日历输入。新版每题只执行一次事实回答，内部最多一次锁定元数据续轮，不再使用旧runner的两次全文回答修正。所有结果包括失败写出；smoke及判分门槛通过前full禁止启动。全局用量限制保留，内部回退也经过beforeModelCall计费预算，未获得用量的调用按保守额度预留。

旧90题＋已执行元数据回退的三卡93.3/94.1/97.2仍是旧版离线复算；新版尚无完整成绩。本次只是集成/离线测试，不启动在线smoke/full，也不修改冻结题目标签、原judge receipts或用户审核记录。

## 12. 关键实现入口与尚未证明事项

| 职责 | 文件 |
|---|---|
| 观察/事务/visit/修订 | src/agent/spatial-sqlite-store.ts |
| 调度/提交/恢复 | src/agent/spatial-sqlite-service.ts |
| 主线图像空间识别 | src/agent/spatial-topology-vlm.ts |
| 搜索/查看/因果摘要 | src/agent/spatial-retrieve.ts |
| 时间/摘要/请求包装 | src/agent/memory-clock.ts、memory-summary.ts、qwen-provider.ts |
| 问答/默认元数据回退 | src/agent/request-agent.ts、locked-protocol.ts |
| 评测源轴桥接/当前图登记 | src/sim/spatial-memory-evaluation-session.ts、current-evidence-session.ts |
| 最终候选评测执行 | src/sim/memory-provenance-evaluation.ts |

待验证：新版真实端点smoke与完整90题成绩、跨环境重访身份、长期大规模索引延迟、复杂楼层操作、自然导航与状态变化、多用户背景持久写入、真实采集时钟。实验V2、几何/运动研究、旧SceneAgent不因同仓存在就算已加入本次评分算法；也没有硬件整合、全记忆付费基线或无人值守上线批准。

## 13. 本次集成验证记录

- 修复前候选审计在`docs/application/final-memory-offline-audit.md`，不能用那份旧candidate-freeze代表本次代码。
- TypeScript隔离编译`dist/final-integration-v1`通过；16项请求/锁定回退/摘要/时间测试及9项检索/原锁定修复/源权限回归测试通过，共25项，无付费模型请求。
- 两组各90题的日历输入准备/哈希/确定性替换预检通过，分别留在`run/final-calendar-preflight-v1-spatial`、`run/final-calendar-preflight-v1-oracle`。这两个目录仅是离线预检，不存在模型预测或新成绩。
- 在线执行必须使用全新目录，不把prepare-only的空smoke目录视作smoke成功。准备时同时传`--calendar=run/school-calendar-v1`；正式执行不传`--prepare-only`。两组使用同一份日历资产及代码冻结。
- 在线元数据补丁测试覆盖成功、企图改正文失败、每次都有摘要、无新增工具访问、额外调用计数和原始raw保留。当前修复仍需真实端点smoke验证；不因本地测试通过就宣称全量成绩提升。

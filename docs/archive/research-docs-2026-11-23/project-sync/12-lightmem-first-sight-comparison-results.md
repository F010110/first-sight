# LightMem-Ego × First-Sight：生活记忆对照验证结果与停止报告

日期：2026-10-27。任务依据：[11-lightmem-first-sight-comparison-task-handoff.md](11-lightmem-first-sight-comparison-task-handoff.md)。本文件为本次新增报告，未更新/覆盖同步目录其他文档。

## 结论摘要

**本次完成了固定版本源码/依赖/输入/数据权限预检和隔离的原生存储接口冒烟，没有完成配对生活记忆QA。双方在物品最后所见、历史路线、动态物品三类任务上的本次准确率均为“未评测”，不是0%，不排名。**

原因不是“LightMem源码不存在”或“First-Sight不能存历史”：两方确有实质实现，且本次都保存了相同的原图。停止点是：完整LightMem运行环境/文本embedding及全链成本门槛未齐备；现有真实生活素材标为仅本机预览，不能未经确认就送Qwen；没有现成、合规、独立答案齐备的三类共同任务集。没有用静态Tartan假测物品移动，也没有临时替某一方补拓扑、状态跟踪或新模型。

**现成方法足以作为生活采集、证据存储、分层检索和问答的工程起点；现有证据不足以支持“可靠视障长期生活记忆”的产品承诺。**本次未证明任一方法在同信息/同预算条件下更准。

## 1. 范围、版本、时间与变更

|项目|本次固定值/范围|
|---|---|
|First-Sight主对照|tag `v2.1.0`，commit `1ba4ea05df3a3378a771bb2b1625d8e34bc77734`，只读核对并提取必要源码|
|LightMem-Ego|commit `3c023dfec301bb2f9624f82cee76007ac3ac0646`，使用已有批准临时目录Git对象；不追新版本|
|工作区HEAD|开始时`5095d1e27b4ee9f9d3e1168d5bca0b43ef2253ba`，不当产品release；未用未提交模块替代v2.1.0|
|开始记录|2026-10-27 15:12:04.529346 UTC；此前先读必需交接资料，未执行上游|
|最长截止|2026-10-30 15:12:04.529346 UTC；实际第1天即停止环境扩展，不耗满三天|
|实际起止/耗时|以`run/lightmem-first-sight-comparison/20261027T151204Z/completion.json`为准；不把等待时间算成三天实验|
|付费调用/费用|本次0次/USD0；没有评分模型调用或私人影像上传|
|未做|无广泛文献搜索、无新benchmark/采集/训练、无新产品功能、无系统重构、无模型权重或大型数据下载、无Docker/生产服务/硬件启动|

原始工件目录：`run/lightmem-first-sight-comparison/20261027T151204Z/`（已在既有run忽略范围内）。`task.json`记录时间盒；`preflight.md`在执行上游前明确NO-RUN完整QA、GO零网络本机存储检查；源码提取有commit/path/hash收据。

本次仅新增两份评测工具：`scripts/evaluation/lightmem-first-sight-env-probe.py`、`scripts/evaluation/lightmem-first-sight-storage-smoke.py`。不改两套系统源码；First-Sight必要文件从tag提取到批准临时目录并单独编译，没有使用当前工作区`dist/current`，也没有更换8884服务。

## 2. 已有能力：不能把几个证据层混在一起

“源码存在”“本次原生接口实际通过”“旧模型运行证据”“本次用户任务验证”分别列出。

|能力|First-Sight v2.1.0|LightMem-Ego固定commit|本次用户任务验证|
|---|---|---|---|
|原始视觉证据与时间|`RealtimeMemory`/快照/因果截断存在；本次3图归档及只读加载通过|`FrameStreamStore`/`MCurStore`存在；本次3图流接收、缓冲保存/重开通过|仅IO，不是找物准确率|
|当前/历史问答|只读问题Agent有search→inspect→answer；本次预设回调走通，非真实LLM|current/short/long路由与QA引擎存在；本次未调用QA|未评测|
|短/长期记忆|会话原件落盘；其他SQLite空间模块在仓库存在不等于当前实时入口都已集成|M_cur/M_st/M_lt、refine/consolidation和图检索有源码；本次只测存储层，未建真实M_st语义或M_lt|未评测长期保持/跨session|
|最后所见/物品查找|可从历史原图问物体，但不是稳定物品实例/生命周期表|找物、entity tracking、最新证据规则有实质代码；官方有小规模在线结果|未做共同最后所见题|
|历史路线|原生问答可以回忆图像/访问线索；prompt明确断档不能证明路线连续。后续pose-route侧车不在tag中|历史事件可供通用QA；未核实可靠地点/连通性/朝向路线链|未做共同路线题；不补路线器后冒充原生|
|动态物品|原图可记录变化；无已验证稳定实例/遮挡/未拍到移动的生命周期推理|state_changes/visual_objects、实体跟踪及编辑/rollback等存在；不是已验证的世界状态跟踪|未评测|
|恢复|只读历史路径存在且本次通过；生产构造器直接重开已有库失败|本次M_cur与M_st元数据文件重新构造对象读取通过；未测跨进程/跨session问答|不宣称端到端恢复|
|真实视障可用性|未验证本轮三类长期生活任务|demo/眼镜客户端不能代替视障人群验证|双方均无本次证据|

### 历史成绩只能作背景

- First-Sight：`run/hardware/realtime-history-check-v2/result.json`确有历史原图中风扇/线缆等物体的回答，3次模型调用、估算USD0.0009927576；本次只读查看，未重跑。它不是最后所见或动态物品任务，也不作为本轮v2.1.0配对成绩。
- First-Sight旧90题：`docs/application/inspect-repair-full90-results.md`报告87题满分、3题零分、主要得分96.67；标签为assistant-source-assisted开发标签，自动语义评分无独立人审，且是历史v1.2.0相关静态开发集。不能当v2.1.0新准确率。
- LightMem根README固定版本报告：5视频/约45.7分钟/27查询；找物人评55.6%，整体人评55.6%；这是作者小规模原型结果，本次未复现，完整公开数据/脚本未确认。
- 两个不同数据集上的96.67和55.6**不能相减或排名**。EM²Mem离线榜单、独立research 26题、后续位姿图74/190检查、旧Tartan24题17/24也不迁入本对照。

## 3. 输入接口、依赖、成本与可复现性预检

### 3.1 接口及信息权限

|维度|First-Sight v2.1.0|LightMem-Ego|对照要求/本次状态|
|---|---|---|---|
|视觉输入|实时前摄JPEG归档，派生PNG供模型；问答快照包含可用原图/判断|stream start＋带索引/时间/hash的帧，当前缓冲/微事件；还支持视频chunk|有视觉共同轨；本次仅同源PNG直入存储，不称摄像头全链|
|时间/会话|主机请求时间，快照截至asOf；实时会话独立|relative/client/source timestamp；会话/跨session路由有代码|需要统一真实前缀、不能把时间戳接口等同曝光同步|
|音频|本次固定实时问答轨为文字＋视觉|有音频/ASR/转录和眼镜链|视觉共同轨可以不启音频；不据视觉子配置否定其原生音频优势|
|检索与原图|最近摘要＋词项search后inspect，历史肯定回答受原图引用约束|分层路由、M_st词项/BM25类规则、M_lt embedding/图，必要时附原图|不能给一方预选答案片段/手写caption，另一方自行建忆|
|当前画面/历史|当前原图先可见，历史按工具取证；停止后当前判断拒答|M_cur有窗口/新鲜度，历史分层取证|双方限制同一前缀/当前图；窗口机制不强行改成一样|
|位姿/地图|冻结实时轨无后续pose路线侧车|未核实IMU/可靠通路链|本次不给任何一方pose/地图/oracle|
|输出|文字、sourceIds、abstained、时刻|自然语言＋时间/事件/帧证据；另有流输出/编辑|语义评分需映射真实证据，不强迫同一JSON格式才算兼容|

LightMem源码位置已只读核查：`src/backend/api_server.py`有`/stream/start`、`/stream/{session_id}/frame`、`/ask/{session_id}`等；FrameStreamStore单独支持PNG/JPEG/WebP，默认流抽帧与状态历史上限可配置。本文不把接口路由静态存在当HTTP部署测试通过。

### 3.2 环境：严重障碍不无限排查

|现有环境|实际只读检测|判断|
|---|---|---|
|Windows `.venv` Python3.14.7|numpy/PIL/cv2/openai等在；fcntl、FastAPI/httpx/networkx/igraph/faiss/torch/transformers/sentence-transformers等不在|不适合原样启动Linux锁依赖的完整LightMem后端|
|WSL Ubuntu Python3.14.4|fcntl/numpy在；PIL/cv2/openai/httpx/FastAPI及图/模型库等不在|足以运行本次选定纯存储模块；不是完整建忆/QA环境|
|已有research/envs/3dmem Python3.9.23|PIL/cv2/openai/httpx/torch/faiss等在；igraph/transformers/sentence-transformers等缺|低于上游声明Python>=3.10，不安装/修改研究环境来强行兼容|

ffmpeg/ffprobe不在上述进程PATH；这不证明机器其他目录绝对没有。没有为本任务安装/重锁131项依赖或启用复杂服务栈。源码pyproject/requirements有固定版本，现有环境不匹配；未声称所有锁版本一定可在CPython3.14安装。

**visual mock不等于完整mock系统。** README说默认`EM2MEM_VISUAL_BACKEND=mock`，backend `.env.example`是remote，worker CLI默认vlm2vec；实际需显式固定配置。文本embedding wrapper仅见local/qwen3或remote路径，默认Qwen3-Embedding-4B；本次没有提供已验证模型/服务，没下载权重。

但**不能说“没有文本embedding就完全不能问答”**：`online_query/query_engine.py`含M_cur快路径及长期未就绪的M_st fallback。它们仍需模型客户端等相应依赖/数据，并非本次已跑通。我们没有用替换retriever或手工写语义记忆的方式绕开完整系统后再声称复现。

### 3.3 模型与费用

统一Qwen只能称适配对照。后续如运行，caption/refine、合并/图构建、embedding、检索推理、最终回答、重试和评分都必须计入每方预算，并记录一次建忆、多次查询摊销及缓存。不能仅让两方最终回答用相同模型就说成本公平。

旧Flash adapter估价为输入USD0.1356/M、输出USD0.4584/M；100k输入＋10k输出约USD0.018144。**这只是token算例，不是完整LightMem建忆报价。**完整链调用次数、embedding成本和默认重试未在本机实际量得，尚不能冻结一个可信的对等建忆/QA预算。

因此云端推理门槛未通过，本次费用预算和实际均为0。没有通过公共demo上传数据，也没有把缺接口/环境偷偷计为模型答错。

## 4. 现有数据与三类任务兼容矩阵

清点了4份已有真实视频manifest，文件存在/大小记录在`existing-data-inventory.json`，本次未再次全片重算hash、未重新标注整片。

|任务/素材|共同可测部分|不能公平计分的原因|最终状态|
|---|---|---|---|
|最后所见：UTE P01/P04、EgoLife两段20分钟|语义任务双方可表达，已有生活视频可能包含物品事件|manifest明确local-preview-only，UTE还写不外部上传；未确认此次云处理权限；无已冻结共同实例/最后可知事件gold|潜在共同可测，但数据/许可与工程门槛未齐；本次不兼容定量运行，不计0|
|最后所见：Tartan|允许共同静态原图IO、静态地标出现回忆的候选|不等于真实生活物品实例最后所见；旧位置锚点gold不是物品gold|仅IO冒烟；未作为最后所见任务|
|历史路线：Tartan|有实际机器人通行记录，可在未来检查共同历史回忆|v2.1.0未有后续路线器，LightMem专项路径维护未核实；旧24题是其他架构题集，不临时补图/oracle后当原生|原生可靠路线支持未确认/不对称，未计分|
|动态物品：Tartan|无适当变化证据|静态机器人轨迹不支持被拍到移动/未拍到移动等目标|数据不支持，未计分|
|动态物品：UTE/EgoLife|可能有变化，不能武断说不存在|本轮未核验实例移动gold；权限限制同上|证据/权限未就绪，不制造答案|
|旧校园90题/硬件历史QA|已有开发答案和历史输出，可作历史取证背景|不是本次三类生活任务的共同测试集；不能把旧预测交给LightMem建忆或移用分数|未作为公平配对成绩|

缺接口/数据/环境与模型已经给错答案必须分开。这里没有实际模型回答，因此任务错误数为“未产生”，不是用“不兼容”隐去已运行错题。

## 5. 真正执行的检查及结果

### 5.1 共同输入、隔离与适配差异

输入是已有TartanGround P0006前摄第0/20/40帧，原时钟0/2000/4000ms，三张PNG保持原始字节和hash，无音频/pose/语义caption/答案。清单位于`storage-smoke-readonly/common-input.json`。

两方源码均从固定Git commit提取到新批准临时目录，并记录路径/hash，未改源码。First-Sight单独编译提取文件；LightMem仅用现有WSL Python运行已审阅模块，不安装包。脚本禁用Python socket连接及JS fetch，不启动server/worker。

适配明确如下：First-Sight通过`RealtimeMemory.archive`写PNG相关字段，不走相机JPEG校验/生产者；`jpegPath`只是未使用的接口占位。LightMem通过原生FrameStreamStore接帧、M_cur更新；M_st事件是**测试器构造的provisional元数据fixture**，不是帧差分段或真实caption。这个测试不能称相同完整建忆流程。

### 5.2 已保存的每次尝试，不拼接失败

|目录|结果|解释|
|---|---|---|
|`storage-smoke/`|测试器保守的`__init__`安全门禁停止，未执行上游模块|不是任一系统任务失败；审查包初始化后补齐同commit源文件闭包，不改上游|
|`storage-smoke-reviewed/`|First-Sight新库写入后，直接构造器重开报`ERR_SQLITE_ERROR: table originals already exists`|是生产构造器不支持该恢复方式的真实工程边界。保留原库/日志，没有补IF NOT EXISTS或重置库；该尝试未走到LightMem|
|`storage-smoke-readonly/`|显式采用发布版历史检查工具已有只读SQL路径后，双方本地存储检查完成|独立新目录，不拼接前两次成功前缀；不把只读路径通过改记成生产构造器恢复通过|

### 5.3 最终局部冒烟实际通过项

**First-Sight（冻结源码）：**

- 3张原图写入会话库，时间保留；截至2s快照只含前2张，没有4s未来帧。
- 关闭写入连接后，发布版历史检查工具同款只读SQL读取与原快照相同。
- 预设回调返回search、inspect、answer，原生问题Agent走完3次控制回调。
- 停止采集时，当前问题不调用回调而拒答。

**LightMem-Ego（固定源码）：**

- 3帧原生流接收，`memory_accepted=true`，时间和原图字节保留。
- M_cur当前缓冲对象重新打开读到3帧。
- 显式元数据fixture追加到M_st并重新打开读取。

共同3帧hash逐一一致。原始结果在`storage-smoke-readonly/{first-sight-smoke.json,lightmem-smoke.json,summary.json}`。只有存储/控制流检查，没有真实LLM调用，没有语义建忆或用户题，故不报“准确率100%”。

记录的内部耗时约55ms（First-Sight片段）及1.68s（LightMem片段），前者脚本QA、后者多文件缓冲/事件写入，含不同运行时；另有WSL/编译启动耗时。**不是同一工作量，不能据此比较查询速度或效率。**

### 5.4 用户任务结果（本次）

|层级|最后所见|历史路线|动态物品|
|---|---|---|---|
|配对QA样本数|0|0|0|
|证据找对率|未评测|未评测|未评测|
|事实回答准确率|未评测|未评测|未评测|
|信息不足处理正确率|未评测|未评测|未评测|
|真实用户帮助效果|未评测|未评测|未评测|

存储检查、预设回调、既有单元测试、作者README数字均不能填入该表。

## 6. 尚未完成与工程限制

1. LightMem完整依赖/真实文本embedding与长记忆构建未配置；原生帧差检测/refine/consolidation/QA未执行。mock视觉配置不足以解决这个问题。
2. 未获得生活素材此次云处理权限及适当共同gold。未查看过的物品变化标未知，不推定不存在或编造事件。
3. First-Sight v2.1.0当前实时会话与生产者恢复受限；只读历史可用不等于跨session可持续更新。检索主要基于空间摘要及有界原图工具，不能推断成熟对象索引。
4. LightMem M_cur/M_st/M_lt及编辑代码支持更丰富的组织，仍需验证实例区分、过期状态、原图回退及跨session实际效果。
5. 可靠历史路线：两方原生当前观察→路线事实→方向说明保障均无本轮证据，First-Sight后续pose侧车只能另列配置，不混进v2.1.0。
6. 小片段对象重开不是跨进程长期恢复；任何一方删除/rollback接口都不能直接证明原件、索引、缓存和备份彻底删除。
7. 无监督视障实际使用、语音/读屏交互、场景隐私和实时安全均未验证。

## 7. 现有方法是否足以支持核心需求？

|核心需求|本次可支持的判断|不能给的承诺|
|---|---|---|
|“最后记录到我的物品在哪里”|双方的证据存储/检索/原图问答是可用工程起点；LightMem已有直接找物设计，First-Sight有实际历史物体问答证据|不能给实例级最后所见准确率、多次移动/相似物品鲁棒性或“现在肯定还在”保证|
|“那个屋子怎么走来着”|历史图像/事件可以支持回忆描述，缺证据时应澄清；已知几何可交程序，不必强迫VLM重算|仅靠通用QA或事件图不能认定路径连续、方向正确、用户可安全行走；本轮未验证任何一方原生指路|
|动态物品持续记忆|事件/state_changes是合理表示入口，能设计来源/时间与未知状态|源码有字段不等于自动维护最新稳定实例；不能保证未拍到的移动、遮挡或跨session身份|

因此：**不需要为基础生活记忆另造所有模块；但“已有方法足以支持可靠核心产品”目前证据不充分。**本次不能区分哪方更准，也不能把工程阻塞当成某方法理论上不行。

## 8. 可迁移的通用研究问题候选（本轮不启动新科研）

|候选问题|为什么可能跨系统|当前证据级别/与工程bug的区别|
|---|---|---|
|最后记录与世界当前状态的区别|任何不连续视觉记忆都存在视野外移动和采集空白|需求与机制层共同问题；本次没有配对错题，不能说两方已实测同样失败|
|同款物品的实例身份与多次移动|caption/embedding/空间摘要都可能丢失实例细节|可迁移假说；需有真实变化和实例gold后验证|
|压缩/分层后的证据可追溯性|事件合并、摘要和有限原图预算可能丢失关键时刻|两方结构上相关；本次只证明原件存储可用，未量化压缩损失|
|历史路线语言的方向和可理解性|相机/人体朝向、反向复用、地标可见性不由流畅文字自动保障|产品共性需求，原生能力证据不足；不能拿First-Sight后续侧车错话证明LightMem也错|
|未知/不充分证据的校准与交互澄清|找不到检索结果不等于物品不存在，历史线索不等于当前事实|已有拒答/证据充分性代码不等于校准已正确；需要共同题验证|

相反，`RealtimeMemory`构造器重复建表、Python平台差异、worker依赖与配置默认值不一致首先是**工程/部署问题**，不直接包装成通用科研贡献。缺生活数据/云权限是评测前提，不是算法缺陷。

## 9. 停止点与继续所需决定

本轮已停止完整运行推进，不安装大型依赖、不下载模型、不反复调prompt。三天是上限而不是必须耗满；当前独立阻塞已足够阻止公平QA，故第1天即结束本轮。

若用户希望继续做真正准确率对照，需要先明确三个最小条件，而不是新增产品功能：

1. **数据权限与答案**：指定已有、允许本次Qwen处理的生活片段及已知事实；或允许对既有片段做少量独立证据核验。不启动新大benchmark或招募。
2. **环境资源**：提供现成Python>=3.10的兼容LightMem运行环境及文本embedding资源/服务；或批准一个有大小/时间上限的独立依赖适配。不可污染研究环境。
3. **配对预算**：冻结共同输入、开发/测试边界及每方总建忆＋查询＋评分成本上限，记录不支持项。只用短期fallback也必须明确不评价完整长期能力。

在这些前提满足前，合理结论就是“**已完成可行性与局部IO验证；性能对照尚未完成，暂无可报告准确率**”，不是用演示或单元测试补一个分数。

## 10. 工件与复核

本轮目录`run/lightmem-first-sight-comparison/20261027T151204Z/`：

- `task.json`、`preflight.md`、`completion.json`、`result-summary.json`；
- `initial-git-status.txt`、`static-source-provenance.json`；
- 三份`*-environment.stdout.json`、对应stderr；
- `existing-data-inventory.json`；
- 三个`storage-smoke*`目录，保留停止点、SQLite和完整命令/源码提取hash/原图共同输入收据；
- 通过的`storage-smoke-readonly`含`summary.json`、两方结果、First-Sight预设回调轨迹，以及原生LightMem会话文件。

零付费环境探测可单独运行：

```powershell
.venv/Scripts/python.exe scripts/evaluation/lightmem-first-sight-env-probe.py
wsl.exe -d Ubuntu -- python3 /mnt/d/Projects/Projects2026/VLM/scripts/evaluation/lightmem-first-sight-env-probe.py
```

存储检查需要先建立新任务目录/时间盒并复制审阅后的preflight，不能覆盖本次原目录；之后运行：

```powershell
.venv/Scripts/python.exe scripts/evaluation/lightmem-first-sight-storage-smoke.py NEW-RUN-ROOT --attempt storage-smoke-readonly
```

这是维护复核命令，不是自动授权新模型运行。本报告不回写旧同步摘要、研究资料、冻结答案或原实验成绩。

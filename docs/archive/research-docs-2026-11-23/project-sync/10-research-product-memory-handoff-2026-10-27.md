# 长期生活记忆：研究、产品与数据的完整已知信息同步

快照日期：2026-10-27。编写来源：本会话全部已知上下文、`research/STATUS.md`、本会话报告及本目录00–04现有快照的只读核对。本文件为**新增独立交接文档**；未修改本目录其他文件。

覆盖“目前已知”而非宣称穷尽整个仓库。未复制原始数据、论文全文、第三方源码、密钥、端点或个人影像。本文件不会自动同步机器/资产。最新用户指令、实际代码和原始运行证据优先；各处“当前”均指其写作时点，不构成实时状态监控。

## 1. 现在到底要做什么

### 用户已明确的产品目标

面向盲及低视力用户，建设**真正能用的长期生活记忆**，典型请求：

- “最后一次拍到我的钥匙在哪里？”
- “那个屋子怎么走来着？”
- “我上次从哪里进去的？以前经过这里吗？”
- “不是那个杯子，是我常用的那个。”

产品应根据当前画面、历史记忆、用户请求，用自然语言提供有依据的帮助。物品最后所见和地点/路径记忆是两条并列主能力；“不做物体级精密重建”不等于排除找物。用户不是机器人，不要求action chunk、速度控制、抓取或自动走到终点。

先把工程闭环实现好，不把基础接线当科研创新。不预设VLM必须替代成熟几何计算，也不为避开已有方法刻意另造轮子。公开实现应作为参考方法，特别是尚未接入的IMU。

### 必须修正的过时理解

1. “地点中心、不以物品为中心”是研究探索阶段的收窄，**不是当前排除找物的产品要求**。
2. “没有完整公开闭环”只能限定于之前核查的惯性不确定性＋VLM空间记忆组合；**LightMem-Ego已经公开生活采集→分层记忆→找物/历史问答→自然语言回答**，不能再说生活记忆闭环无人实现。
3. “语义导航”最终指自然语言路线说明，不是本项目必须开发机器人控制器。
4. 多帧/长上下文/重启恢复，不自动等于多日生活记忆；旧benchmark分数不等于真实用户可用率。

## 2. 信息等级与本目录已有新进展

本会话做过的代码阅读、实验和报告见后文。下面是**只读现有同步文档所知，未在本会话重新运行或独立复核**的产品进展，避免忽略另一条工作线：

- `00-current-state.md`、`01-goals-and-decisions.md`称当前组合为固定版地点识别→程序保存pose通行经历/拓扑→程序定位与正反向路线检索→独立说明Agent写语言并缓存。
- 识别器不接pose代答；程序处理几何、路径、方向，说明Agent不重新算角/选路。这一后续分工不同于早期闭环文档中“VLM负责广泛路径提议”的草案，**不能为统一文档而倒改代码**。
- `02-architecture-and-code.md`列出`pose-route-topology.ts`、`fixed-pose-route-assistant.ts`、`route-description-agent.ts`及对应评测入口；称尚未接新图到8884硬件/网页、尚无真实IMU主链/跨会话坐标对齐/节点修订/人体朝向确认。
- 该快照报告P0006已有42/77完成前缀、821pose、6地点候选/9地点间边/28地点内轨迹；74几何＋190连续性检查、2次语言调用结构通过。**均不代表端到端准确率**，反向语言“向后行进”仍有歧义。
- 该快照报告旧24题17/24=70.83%，是不同架构、旧反向规则及开发题，不是当前路线说明正确率。
- 该快照报告正式产品冻结`v2.1.0`，tag `1ba4ea05df3a3378a771bb2b1625d8e34bc77734`；本次不复核远端或服务版本，不移动tag。
- 费用、工件和精确策略以本目录02–04原文为入口，不能用本会话研究结果覆盖它们。

若不同工作线对“程序还是VLM负责路径”的说法冲突，应先确认用户最新决定。共同不变：语言必须有原始画面/路线证据，不重复让VLM计算已知几何，不宣称真实安全导航。

## 3. 项目已有模块和未完成闭环

### 本会话实际阅读过的代码资产

|路径|已知作用|边界|
|---|---|---|
|`src/agent/spatial-sqlite-store.ts`|观测、地点、关联、visit、transition、revision及事务/检索/修订|现有schema1；v2运动表等是草案，不能说已迁移|
|`src/agent/spatial-topology-service.ts`|JSON地点图、窗口识别、merge/split/confirm/undo|与SQLite worker不混称；时间转移不自动保证可通行|
|`src/agent/spatial-working-context.ts`|当前观察、recent6/anchor4/retrieved4，有界60秒视图|不是长期原始存储；当前unknown不能沿用旧地点|
|`src/agent/experience-graph.ts`|原始经历、节点、visit、可修订关联|源码transition明确`traversable:false`，不能当自动通路|
|`src/agent/spatial-place-contract.ts`|候选组scope/全成员分页核验、来源检查|模型判断非真值；结构通过不等于地点语义正确|
|`src/agent/spatial-topology-vlm.ts`|Qwen多图地点分配、JSON校验与有限协议修复|历史代码不等于当前固定生产入口|
|`src/dead-reckoning.ts`|浏览器IMU局部航位推算、静态校准、ZUPT，依赖融合orientation|不是全局定位；不等于纯IMU预积分；未证明已接当前空间记忆链|
|`src/realtime-motion.ts`|时间窗平移/转向语义摘要|不是原始IMU、不是标定协方差|
|`src/agent/agent.ts`|旧路径存在motionReport/motionTimeline输入参数|参数存在不证明当前目标系统已接IMU|

### 目前仍需明确标未完成/未验收

- 当前目标主链真实接收同步原始IMU；时钟、坐标、重力、外参、gap与bias契约。
- 在真实多日、多地点、多人/同款物品变化中可靠保持身份。
- 原始证据→长期记忆→当前画面→语言帮助的独立产品准确率。
- 非视觉可用交互、真实用户受益、隐私与完整删除、长期运行可靠性。
- 不得仅因目录有实现、测试数量多或API冒烟成功就宣称全链上线。

## 4. 已写工程计划（不是已实现）

`docs/product/vlm-imu-spatial-memory-closed-loop.md`最初建立P0–P6：契约/fixture→RGB记忆→IMU证据→VLM提议/写入门禁→重定位/纠错→语言路线→可选科研。已修正终点为语言而非waypoint执行。

重要设计：

- 来源分开：raw IMU、惯性派生运动、VIO posterior、动作历史、GTpose oracle。
- 运动证据带时间、坐标系、质量、原始引用；无协方差写null，不虚构sigma。
- 结构化运动摘要送API，**不是已训练IMU-VLM token融合**。
- VLM输出需校验ID、时间、引用和冲突，不能直接任意写库。
- merge/split/undo保留原始观测和revision，不能为了结果好看删除冲突。
- 后续本目录已知程序路线侧车已推进，该计划的具体代码落点/职责不能未经核查直接执行。

本会话仅写计划、查文献；没有据此启动新实现、训练、服务、采集或付费批次。

## 5. 最重要的新参考：LightMem-Ego

详见`research/reports/lightmem-ego-product-reference-audit.md`。

- 论文[2607.11487v1](https://arxiv.org/html/2607.11487v1)，2026-07-13；[官方repo](https://github.com/zjunlp/LightMem-Ego)，MIT，实质实现。固定commit`3c023dfec301bb2f9624f82cee76007ac3ac0646`。
- 产品链：手机浏览器/Rokid RGB＋音频→时间对齐→M_cur→微事件M_st→异步M_lt episodic/semantic→分层检索→原图/文本/音频转录证据→自然语言回答。
- 实读`online_short_term/frame_stream_event_builder.py:26–85`、`mst_to_episodic.py:26–101`、`online_query/memory_router.py:106–159`、`query_engine.py:807–860`、`online_memory_edit/service.py:67–150,211`等（均相对其`src/backend/`）。
- 微事件不是地点边界；动态路由有关键词/规则实现，不能全归为VLM；存在原图回退，不是纯caption-only；有编辑/rollback，不等于自动空间纠错。
- 默认visual embedding backend为mock：不做真实帧级embedding匹配，但回答仍可附原图；对照必须记录配置。
- 本次稀疏后端未找到IMU/odometry/relocalization/traversability链；不代表穷尽全仓库；可靠路径/朝向与视障可用性未确认。
- 当前README在线评测5视频/约45.7分钟/27查询，每类9题；找物R@1=22.2%、R@3=66.7%、人评55.6%；整体R@3=74.1%、人评55.6%。小规模原型，不是多日视障用户验证。
- 当前README与论文延迟数字不同：论文长期QA phone/glasses P50=14.87/19.96秒，README=10.57/8.61秒；不混版本。
- EM²Mem [2609.00551](https://arxiv.org/abs/2609.00551)是另一篇长期引擎研究，其EgoLifeQA/Ego-R1/Video-MME成绩不当在线27题或用户成功率。
- 在线评测数据/复现脚本仍在roadmap，本轮未确认完整公开。
- 未安装/执行第三方代码，未打开其采集demo上传私密数据，未下载权重。

决策建议：把它作为生活记忆首要参考/候选基线，不整库替换当前系统。空间可靠性、用户理解、过期/缺失处理与真实多日证据是要正面验证的产品差异，不声称所有组合首次。

## 6. 十篇邻近方法：身份、源码和排除

主报告：`research/reports/spatial-memory-paper-code-audit.md`；URL/hash/commit：同名`.provenance.json`；采集脚本：`research/scripts/audit_spatial_memory_sources.py`。

|方法|已核实机制/区别|开源判断|
|---|---|---|
|CROSS 2605.02227v2|惯性前端、运动协方差、多假设、回环/PGO、持久拓扑；核心不是生成式VLM；`planner.py:196–200`文本目标pass|实质源码`jiaming-ai/CROSS`，commit`2b560ceaaac8f439655cc53d0ab0238c483c1c1b`|
|Embodied-Navigator 2608.17512v2|Qwen视觉＋XYTheta编码、anchor/trajectory/recent；不是raw IMU；单episode长历史；anchor选择存在纸码疑点|`ZJU-OmniAI/Embodied-Omni/embodied_navigator`，commit`78ef297d342d1f44bb15975e36555f8abee18448`|
|NavHarness Towards Lifelong 2609.34276v1|RGB-D ORB-SLAM3＋agent工具＋house notes/journal/照片/consolidation；另有GT配置；不是IMU|`billzhao1030/NavHarness`，commit`9a4c12f820631b6a17576651180a5cbddd079264`|
|OmniVLA 2509.19480v1|当前RGB＋语言/goal image/目标相对pose→VLA action；外部topological memory完整发布链未核实|`NHirose/OmniVLA`，commit`5182600cb4a9ee07684e17cdd2a6cbafc56b8a68`|
|FARM 2606.15476v3|posed RGB-D对象Gaussian融合；caption、LLM谓词解析＋程序几何关系＋VLM评分；非地点导航双层记忆|`GoldenGait/FARM-Project`，commit`2fcaf8602e741341a70ca980133f7ff05cfc83a2`|
|Mem2Ego 2502.14254v3|RGB-D/pose＋frontier/landmark/visitation；非明确惯性双层|未确认官方核心repo；版本作者有变化，不能照抄v2名单|
|MemClaw-RAG ICRA2026|FAST-LIO2 LiDAR＋IMU前端；MGR/Mem0/SelfClaw/HALP；raw IMU进VLM不明|未确认核心repo；program与DOI作者不一致；无关同名软件不代替|
|sensVLA 2609.17021v1|当前20维state含3台IMU的18通道，MLP进VLM；history/BEV另进action expert；无长期记忆|未确认官方核心repo，但必须承认IMU→VLM论文先例|
|SpaMEM 2604.22409v3|动态空间benchmark，不是导航记忆方法；short/long是probe模式|HF subset不等于核心代码；未确认核心repo|
|Concept-Guided 2608.23650v1|LiDAR/odometry、CORTEX工作图＋NetworkX room/door持久图，无VLM|框架不能冒充论文agents；未确认核心repo；同标题已有2025期刊/预印本|

同名陷阱：Towards Lifelong NavHarness不是`navharness.github.io` Adaptive Goals（2609.39915）。CROSS当前快速扩展代码/榜单与论文v2传感/成绩不能混用。Motion-MLLM 2603.17980v2有GRU惯性motion tokens进VLM，未确认公开核心代码；不入开源表仍需作为先例。

## 7. 其他已知研究边界

- `vlm-spatial-reasoning-geometric-dependency.md`：GraphEQA依赖Hydra/TSDF，ConceptGraphs依赖posed RGB-D；Mobility VLA用COLMAP/PnP支撑图，GraphPad为辅助几何先例。VLM＋几何图不是新组合。
- `place-centric-vlm-imu-memory-neighbors.md`：Motion-MLLM、CROSS、VLG-Loc、NavMind等；论文阅读和源码核查级别不同。
- `spatial-memory-and-direct-vlm-comparators.md`：Direct应与图像检索、视频RAG、事件/摘要记忆及自适应视频搜索比较；ReMEmbR、两篇不同VideoAgent、VideoTree、EgoLife等均应区分身份和证据。
- `vinseval-and-ipnet-critical-review.md`、`imu-robustness-related-work.md`：VINSEval为FlightGoggles仿真评估，IPNet为bias先验；OpenVINS/TLIO/mi-VINS/ORB-SLAM3各有条件，不把加噪声本身当新算法。
- R4曾检索到A-EQA74.00/单agent72.82，未确认官方完整代码；Pred-EQA等已有更强公开方法，不说“没有更强baseline”；SAGE依赖专用训练，与当前不部署本地小VLM约束不兼容。

## 8. Benchmark适配结论与数据方向转变

详见`benchmark-fit-for-language-route-memory.md`及`ego4d-vcn-spamem-evonav-assistive-data-design.md`（均在`research/reports/`）。

|Benchmark|参考价值|不能冒称|
|---|---|---|
|FindingDory 2506.15635v2|先历史后任务、目标帧/序列、HL-SR/HL-SPL可隔离低层执行；HSSD/OVMM|60模板不是60样本；val100历史episode/5876任务；目标选择不是路线正确；pose/GPS/Compass不是IMU|
|3DMem-Bench/3DLLM-Mem 2505.22657v2|跨房间Spatial/Nav/Layout EQA、caption/操作；1860+865+167测试任务|不是UMass 3D-Mem，也不是已有26题；官方Code只有占位README，未确认完整可用包|
|EMem-Bench 2609.28236v1|2554 episode，视觉/动态/失败/经验迁移；实质官方代码在Embodied-Omni|SR需要动作执行和最终世界状态；部分房间虚拟跳转、metadata/action候选不能当RGB定位或连续惯性|
|LMEE 2601.10744v1|多目标探索＋记忆QA；官方evaluation/HF；166任务/828目标/406问题|正文部分58任务/145问题不当full；22.4GB不是已下载；runner用pose/TSDF/pathfinder；QA不是指路|
|Ego4D EM|真实第一人称；NLQ时间窗、VQ最后出现track、部分VQ3D位移、MQ活动区间|检索片段不等于非视觉可用说明；不能默认同人多日同宅或EM原生IMU|
|VCN 2609.34687v1|旧视觉经验＋当前观察；目标识别/导航分开诊断；1250测试episode|覆盖优化tour再滑窗抽题非自然生活；许可CC-BY-NC-SA/MP3D需审；非产品默认感知|
|SpaMEM v3|变化与视觉/理想文本历史分层诊断|16个teleport视角不是穿戴连续视野；末episode probe非真实跨日|
|EvoNav 2609.08292v2|3–5阶段、视野外局部变化，保留仍有效旧记忆|论文层参考，未确认官方完整发布；模拟器occupancy/随机重排不等于用户路线；非EvoWorld/EvolvingNav|

**最新用户决定：不再让任务定制benchmark主导产品；可以借鉴其构建法，但从视障长期生活需求出发。** 原生能力轨/扩展路线轨可保留为辅助，不将数据选型建议升级成必须运行指令。

## 9. 数据构建的当前方案（待执行）

主文件`docs/product/assistive-long-term-memory-data-plan.md`；补充研究文档见上。当前无本会话新采集/招募授权。

### 三层，而非只有QA题库

1. **需求来源**：可访问访谈/语音日记，收集真实记忆困难、已有应对方法、是否想要AI、愿记录什么。与盲/低视力参与者共设计并补偿，不用蒙眼健视者代表。
2. **自然多日经历**：同一用户同一环境，真实活动与多次到访，保留普通背景/停拍/回头/坐下/物品离镜；先经历后具体问题，不按未来题目筛图。自然无答案问题保留。
3. **受控挑战**：相似物品、未拍到移动、关闭容器、反向路线、换朝向、纠正/删除；和自然数据分开，不刻意制造危险。

建议小试采3–5个真实日期，每天2–3个20–30分钟自选窗口仅是工程规模提议，不是统计样本量或已采事实。具体先确认场所、参与者同意、资源与实际负担。

### 标注必须分开

- 世界实际状态（合法独立记录有才填，否则unknown）。
- 系统截至发问时可知证据：最后可见事件、实例候选、位置层级、采集空缺、实际经历路径。
- 答案边界：必需信息、多个可接受路线/说法、应澄清之处、禁止断言；不唯一字符串匹配。
- 用户可使用的地标与名称、身体/相机朝向；未采音频/触觉不编相应真值。
- 实际帮助：找到/理解、检查几个位置、追问次数、错误线索浪费时间、取消/协助者介入。

关键例：停拍后钥匙被移走，正确说“最后记录在玄关托盘，之后未知”，不能因为世界已在抽屉就判系统必须知道，不能说“肯定仍在托盘”。

### 评测和安全

- 分事实准确、帮助效果、长期恢复与成本，不能只用流畅度或LLM裁判总分。
- 对照包括当前图-only、近期窗口、简单检索、长期记忆、长期记忆＋惯性，同前缀/预算；不预设IMU总有效。
- 自然请求和构造挑战、RGB与IMU轨、真实与仿真轨分列；开发/测试按用户/环境划分，避免近邻帧泄漏。
- 用户自己的白杖/导盲犬/定向行走策略继续使用；系统非避障/过街/楼梯安全保证。
- 原始住宅数据、第三人同意、云上传、保留/删除/缓存/备份须预先明确；不能因“不是科研”忽略合规/伦理。
- 先因果离线回放，再可访问交互，最后适当监督的真实用户验证。文字页面答对不代表视障可用。

## 10. 已知数据与资产：范围不要扩大

### 本会话研究资产

- HM3D用户提供`hm3d-minival-glb-v0.2.tar`，10个普通GLB；官方184题交集冻结26题/7场景。无完整semantic资产，GraphEQA等原生复现仍受限。
- findingdory环境/部分metadata存在，不表示完整资产和正式任务已跑。
- ReplicaCAD/自建仿真只作工程/机制验证，不当HM3D官方成绩或真实用户生活。
- 文献临时目录：`C:\Users\helele\AppData\Local\Temp\opencode\spatial-memory-audit-20261027`，含论文HTML/text、MemClaw PDF、5库源码/hash manifest；LightMem另在`lightmem-ego-audit`。临时资产不保证永久/跨机器存在。

### 现有同步文档补充资产（只读获知）

- TartanGround HF revision`388faf9c800568cfc6828fa47e063f8369397eb3`；P0001 1129组三摄/112.8秒/约3.43m/s；P0006 1504组/150.3秒/约1.54m/s。机器人轨非视障生活。
- P0006路线侧车只用0–82秒完成前缀，不含84秒失败和后续pending；地图/pose仅评测或几何侧，不偷偷输入地点识别器。
- 现有同步文档称UTE P01/P04、EgoLife两段20分钟工程素材存在；本会话未复核全片、许可或可用性。
- RGB点云底图稀疏非测绘平面图；语义点云未完整下载。慢放不修正速度/IMU物理一致性。
- 数据许可不等于原始引擎工程可再分发，公开网页视频不等于训练/商业许可或私人同意。

## 11. 独立research实验：原始结果与限制

### 3D-Mem API基线（已完成历史）

- 26题固定分母，26进程退出0，25题正式回答；frontier area=0造成1题无答。
- Flash裁判归一化58.65/100，Plus59.62/100；非准确率，非论文成绩复现。Plus模型`qwen3.7-plus-2026-05-26`，25/26项相同，唯一3→4。
- 推理136成功API调用、447178总token，3.688小时；评分用量另计；不以流程完成率代正确率。
- 运行主链保留原生融合/清理/快照/探索；raw GLB、EGL、模型API等适配单列。报告`minival26-baseline-results.md`、`minival26-plus-scoring-and-errors.md`。

### Direct强VLM两题先导

- 纸桶：3D-Mem+Flash=3、Direct+Flash=1、Direct+Max=5。
- 饮水：对应4、1、1；Direct回答水槽，参考为冰箱饮水机。
- 只有2题、重渲染非字节同图、缺3D-Mem+Max配对；不支持任一方法普遍优势。见`direct-vlm-pilot-v1-results.json`及protocol。

### 惯性与VIO（独立实验，未接产品）

- 旧纯惯导先导尝试6/9，异常保护停止；2题/单seed/米级误差，不算正常VIO。第2题MPU-like末误差约29.4m；对象清理删33而planner旧snapshot仍引用33，触`KeyError:33`，未修复重跑。
- V2实际图像OpenVINS smoke：30秒、601图/6010IMU每条件；统一原生静止初始化，3.2秒首有效，537/601时刻有效。
- 低噪/BMI-like/MPU-like位置RMSE0.0561/0.6131/0.2833m，末帧0.0709/0.3899/0.3253m；单seed，非硬件等级排名。MPU中断后独立重跑，旧失败保留。
- v1纯旋转动态初始化发散，不能用；V2未有完整下游3D-Mem分数。本会话无研究实验运行任务，不据此推断其他工作线后台。
- 更早OpenVINS18组使用合成视觉特征/GT初始化，不是实际RGB跟踪。标定开关/seed可改变噪声趋势，不简单归因于白噪声。
- 早期ARI0.325、对象31→67等只是简化关联（未原生融合/清理/检索），**不得冒称完整3D-Mem成绩**。见`full-evaluation-and-sensor-errors.md`重要更正。

## 12. 环境与持续约束

- 工作区Windows `D:\Projects\Projects2026\VLM`，git研究分支`research/3dmem-imu-noise`；存在大量其他用户工作，禁止批量stage/revert/delete。
- 研究模型通过Qwen API，不部署本地小VLM；Flash答题、Plus独立评分为既有约束。凭据只环境变量，不打印端点/响应体秘密。
- GPU历史核查RTX4060 Laptop 8GB；WSL环境3dmem Python3.9/Habitat0.2.5无Bullet/Torch2.0.1cu118；findingdory Habitat0.3.1/Torch2.5.1cu124；OpenVINS无ROS/Ceres2.1。环境历史非本次全量重验。
- EGL/D3D12环境需对应NVIDIA适配配置，headless+Bullet曾段错误，锁依赖避免Eigen/SuiteSparse混装；不擅自改宿主系统。
- 先冻结题目/答案/输入/预算；失败保留分母，不按错题调参，不拼接成功前缀，有限重试，不自动加额度或换模型。
- 噪声从测量传播，不硬加输出漂移冒充IMU；GT仅用于传感器生成/oracle/评分，不进入一般推理；时间/单位/重力/坐标/外参必须核验。
- 新论文/代码只读审查，不执行未知安装脚本、不下载权重/大型数据或启动付费服务，除非具体授权。
- 文档任务不等于授权真实用户研究、招募、录音录像或云上传；生产服务/硬件不因研究任务被停止或替换。

## 13. 本轮提交索引（本会话均未推送）

|commit|内容|
|---|---|
|`acdf106`|情景记忆与Direct对照方向|
|`f22ce81`|VLM空间推理几何依赖|
|`dfe6235`|地点中心VLM/惯性邻近方法|
|`0d6f6f4`|十篇全文＋官方核心代码审计及provenance|
|`b9d88df`|闭环工程计划初稿|
|`3e890f7`|修正IMU未接入、终点为自然语言路线|
|`0326001`|四记忆benchmark适配|
|`97d720c`|视障生活记忆产品数据计划|
|`36b91e6`|Ego4D/VCN/SpaMEM/EvoNav及生活数据设计|
|`92e7b37`|LightMem-Ego产品参考审计|

上述commit不是产品release，不推断远端状态；同步文件自身后续commit不预填SHA。

## 14. 下一会话如何接续

1. 先读本目录00–04当前产品状态，再读本文件LightMem/数据/研究部分，避免回到过时计划。
2. 确认任务是信息同步、模块参考、数据设计还是实际运行；文档不自动授权实验。
3. 优先利用LightMem-Ego结构参考，明确本项目已有能力/缺口；不为了新颖性回避成熟工程。
4. 主数据先需求与小规模真实多日经历，不再靠筛长机器人轨迹证明生活有效性。
5. 若要接IMU，先确认原始采样/时钟/佩戴/坐标；若要评路线，先冻结正确路线/方向/语言事实与失败出口；若要找物，先标最后可知证据而非只标真实当前位置。
6. 实施前检查工作区已有修改与其他会话活动；只操作本任务文件，原数据和失败不覆盖。
7. 用户特别要求：**不要动`docs/project-sync/`中的其他文件**。本次仅新增本文件；未来维护也需尊重明确范围，不擅自补齐README里列出但当时未存在的其他文件。

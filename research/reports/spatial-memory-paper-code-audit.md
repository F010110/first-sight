# 地点中心视觉—惯性空间记忆：论文与核心代码核查

核查日期：2026-10-27。范围：用户指定10篇，全文与官方源码静态交叉检查；未运行外部项目、下载权重或复现论文成绩。**公开核心代码可检查，不等于完整系统已发布，更不等于本机可运行。** 对未确认公开代码的方法，只报告论文证据，不纳入开源主表。

## 1. 仅含已确认实质代码的主表

Yes/No针对所列功能，不代表完整符合目标。原始IMU列指系统是否处理测量值，不指是否进入VLM；“长期”区别单episode历史与跨任务持久化。Unclear表示没有足够公开实现证据。

|论文名称|论文链接|官方仓库|VLM推理|原始IMU|VIO/Pose|短期记忆|长期记忆|在线记忆更新|长期导航|关键源码位置|
|---|---|---|---|---|---|---|---|---|---|---|---|
|CROSS|[v2](https://arxiv.org/html/2605.02227v2)|[jiaming-ai/CROSS](https://github.com/jiaming-ai/CROSS)|No：核心定位非生成式VLM|Yes：当前仓库惯性前端；不进入VLM|Yes：delta pose及运动协方差|Yes：临时关键帧/当前跟踪状态，非VLM working memory|Yes：持久关键帧与拓扑/位姿图|Yes：算法管理、回环与PGO|Yes：论文研究跨会话重定位；语义目标代码不完整|`cross/core/system.py:599,909,1044–1164`；`hypothesis.py:76–172`；`cross/imu/preintegration.py:37–108`|
|Embodied-Navigator|[v2](https://arxiv.org/html/2608.17512v2)|[Embodied-Omni](https://github.com/ZJU-OmniAI/Embodied-Omni/tree/78ef297d342d1f44bb15975e36555f8abee18448/embodied_navigator)|Yes：历史/当前图像与pose共同决定像素导航目标|No：公开输入是pose|Yes：XYTheta token；仿真或ROS TF|Yes：最近观察|Yes：论文称long-term anchors+trajectory，但限episode|Yes：规则构造历史，VLM输出间接影响anchor|Unclear：长指令导航有；跨天重定位无充分证据|`src/agent/dthink_pixel_agent.py:127–243,283–285,318–358,463–479`；`src/utils/qwen_vl_utils/pos_process.py:6–53`；`src/model/qwen2_5_vl/modeling_qwen2_5_vl.py:1148,1643–1650`，路径均相对`embodied_navigator/`|
|NavHarness: Towards Lifelong Embodied Navigation|[v1](https://arxiv.org/html/2609.34276v1)|[billzhao1030/NavHarness](https://github.com/billzhao1030/NavHarness)|Yes：多轮视觉agent调用导航/记忆工具|No：核查配置为RGB-D SLAM|Yes：ORB-SLAM3；另有GT配置|Yes：任务记录、上下文及handover|Yes：跨任务house notes、照片、journal|Yes：agent读写、独立consolidation|Yes：跨任务/模拟天；不是惯性漂移实验|`core/harnesses/navh/memory/longterm.py:1–26,52–143`；`memory/placegraph.py:74–196`；`session/consolidate.py:23–63`|
|OmniVLA|[v1](https://arxiv.org/html/2509.19480v1)|[NHirose/OmniVLA](https://github.com/NHirose/OmniVLA)|Yes：多模态VLA策略；不等于显式空间记忆推理|No：未见原始IMU输入|Yes：目标相对位置/朝向；不是自身VIO轨迹|No：核查核心未见显式短期空间存储|Unclear：论文外部topological memory，不等于公开模型内存|Unclear：外部图创建/维护链未核实|Unclear：论文路线导航有，持久记忆实现未核实|`inference/run_omnivla.py:127–187,190–244`；`vla-scripts/train_omnivla_dataset.py:428–444`|
|FARM|[v3](https://arxiv.org/html/2606.15476v3)|[GoldenGait/FARM-Project](https://github.com/GoldenGait/FARM-Project)|Yes：查询解析+视觉证据评分；几何关系主要由程序求值|No|Yes：posed RGB-D|No：未见明确短期导航记忆层|Yes：可保存对象空间地图；非地点导航记忆|Yes：几何/特征关联融合，异步caption|No：任务是对象检索，不是长期重定位系统|`src/scene_graph/pipeline/orchestrator.py:86–186`；`retrieval/spatial_reasoning/query_parser.py:17–50`；`scene_state_io.py:203,244`|

### 版本固定与永久源码入口

所有行号只对以下commit成立；当前仓库更新不能自动继承本结论。

|方法|commit|永久源码入口|
|---|---|---|
|CROSS|`2b560ceaaac8f439655cc53d0ab0238c483c1c1b`|[system](https://github.com/jiaming-ai/CROSS/blob/2b560ceaaac8f439655cc53d0ab0238c483c1c1b/cross/core/system.py#L1044)、[IMU](https://github.com/jiaming-ai/CROSS/blob/2b560ceaaac8f439655cc53d0ab0238c483c1c1b/cross/imu/preintegration.py#L37)、[planner](https://github.com/jiaming-ai/CROSS/blob/2b560ceaaac8f439655cc53d0ab0238c483c1c1b/cross/core/planner.py#L196)|
|Navigator|`78ef297d342d1f44bb15975e36555f8abee18448`|[agent](https://github.com/ZJU-OmniAI/Embodied-Omni/blob/78ef297d342d1f44bb15975e36555f8abee18448/embodied_navigator/src/agent/dthink_pixel_agent.py#L160)|
|NavHarness|`9a4c12f820631b6a17576651180a5cbddd079264`|[consolidation](https://github.com/billzhao1030/NavHarness/blob/9a4c12f820631b6a17576651180a5cbddd079264/core/harnesses/navh/session/consolidate.py#L23)|
|OmniVLA|`5182600cb4a9ee07684e17cdd2a6cbafc56b8a68`|[inference](https://github.com/NHirose/OmniVLA/blob/5182600cb4a9ee07684e17cdd2a6cbafc56b8a68/inference/run_omnivla.py#L127)|
|FARM|`2fcaf8602e741341a70ca980133f7ff05cfc83a2`|[mapping](https://github.com/GoldenGait/FARM-Project/blob/2fcaf8602e741341a70ca980133f7ff05cfc83a2/src/scene_graph/pipeline/orchestrator.py#L86)|

## 2. 五个开源候选的机制与基线价值

这是指定清单中五个满足“存在实质代码”的候选，**不是五篇都高度接近目标**。相关性优先级：Navigator（网络融合与双层历史）、NavHarness（持久记忆管理）、CROSS（惯性不确定性与长期定位），然后OmniVLA、FARM两个局部对照。

### 2.1 Embodied-Navigator：最接近“pose进入VLM＋双层历史”

- **输入/数据流**：多方向RGB、指令、传感器pose → anchor图像/推理文本＋中间trajectory＋recent observation → XYTheta编码与视觉/语言token送Qwen2.5-VL → 相机选择和像素点 → 深度/几何投影与控制器执行。深度用于行动落地，不能据此说原始IMU进入网络。
- **VLM职责**：跨观察理解指令、选择视角/目标像素、按需推理。pose不是仅在外部控制使用：`modeling_qwen2_5_vl.py:1643–1650`将位置编码scatter进输入embedding。
- **记忆责任**：`dthink_pixel_agent.py:160–243`以程序筛anchor、构造trajectory和最近观察；prompt限制最多5个anchor并组织分块。不是任意可编辑的持久拓扑数据库，也未见VLM显式执行节点合并/回环纠错。
- **纸码差异**：论文STI描述包含`(t,x,y,yaw)`；`pos_process.py:6–53`实际位置条目是`[x,y,theta]`。序列顺序不应冒称独立时间测量token。anchor判定使用`len(cot)>5`，而step传入完整`text_out`，`_run_model_twice`在283–285行提前返回；因此“仅推理时创建anchor”是否按论文落实仍需运行单测确认，不能直接认定完整一致。
- **定位来源**：`src/env/dthink_env.py:536–562`为仿真sensor pose；`src/server/ros2_pixel_vln_client.py:213–264`为TF pose。均不是原始六轴IMU。未见输入pose协方差或惯性bias。
- **长期鲁棒性**：深度扰动与navmesh约束不是惯性长期漂移实验；episode内长历史不等于跨日重定位。
- **相对CROSS/基线**：更适合改“运动/pose token如何参与VLM推理”；不具备CROSS的概率多假设定位。适合作网络侧候选基线，但需模型权重、依赖与环境验证；本机未复现。

### 2.2 NavHarness：最接近“VLM管理可持续更新的长期导航记忆”

- **数据流**：RGB-D → ORB-SLAM3/占据地图 → 视觉agent读取观察、地图、历史文件 → 工具导航、命名地点、保存照片与任务记录 → 任务结束独立consolidation → 下一任务读取house memory。
- **输入区别**：`exp_workspace/lhnav_es/mcp/stack.py:98`按配置选SLAM或GT pose；不能把GT配置成绩当SLAM定位效果，更不能把RGB-D ORB-SLAM3说成IMU融合。
- **存储**：短期是当前任务上下文/记录、恢复handover；长期是`MEMORY.md`索引、`house.md`、room notes、skills、journal及带pose的照片。`longterm.py:1–26`直接定义文件布局，52–143行实现相关保存。
- **创建/更新/合并/纠错**：agent工具写任务记录和地点，专用`ConsolidateSession`读ledger、handover、旧notes与照片后重写长期notes。`consolidate.py:23–63`检查实际written状态；失败不会假定已有记忆。语义整理依赖模型，不提供概率正确性保证。
- **拓扑限制**：`placegraph.py:74–93`记录标记并推断跨floor连接；115–148行同floor可达关系主要交给占据规划，不是精细走廊拓扑学习；171–196行save/load。
- **长期/变化**：论文研究跨任务和模拟天的经验复用、观察核验与纠错；这不是对IMU bias、长期尺度漂移或真实跨季节重定位的验证。
- **相对CROSS/基线**：CROSS主要解决“在哪里、怎样融合回环”，NavHarness主要解决“记什么、何时读写、如何复用经验”。适合记忆管理侧主基线；依赖外部模型、工具和仿真/SLAM环境，尚未本机运行。

### 2.3 CROSS：最接近“惯性不确定性＋持久拓扑重定位”，但不是VLM中枢

- **数据流**：RGB/深度或几何估计＋前端delta pose/运动协方差 → 多假设pose传播与视觉匹配 → 延迟回环验证/PGO → 持久关键帧与图 → 图路径规划。当前仓库另有RGB＋IMU前端，不应混同论文v2所有实验配置。
- **原始IMU**：`preintegration.py:37–56,85–108`接收`(N,7)`的`t wx wy wz ax ay az`，传播9×9预积分协方差及bias Jacobian；`vggt_imu_frontend.py:155–238`处理IMU缓冲与视觉几何校正。该路径是几何惯性前端，不是生成式VLM motion token。
- **记忆管理**：程序决定临时/持久关键帧、候选检索、假设birth/prune、回环和图优化；`hypothesis.py:76–172`的跟踪生命周期不是另一个可跨会话保存的VLM记忆层。地图save/load在`system.py:599,909`。
- **语义与规划**：`cross/core/mem.py`用检测/分割获得对象观测并关联；不能因此认定VLM负责空间关系推理。`planner.py:196–200`的`_set_goal_by_text`是`pass`；图路径规划不是占位，但自然语言目标闭环不能仅凭docstring算已实现。
- **长期能力**：论文核心是变化鲁棒重定位和长期拓扑记忆，最接近本任务定位端；当前快速扩展仓库与论文成绩/传感模式必须分开。
- **相对自身/基线**：适合作长期几何定位和不确定性传播对照，不适合作“现成VLM主导系统”。运行前仍需核实版本、依赖和对应数据协议。

### 2.4 OmniVLA：多模态行动条件，不是已核实的双层记忆方法

- **数据流**：当前RGB＋语言/goal image/相对goal pose → 视觉编码与pose projector → OpenVLA策略 → waypoint action chunk → 控制。训练代码`train_omnivla_dataset.py:428–444`将`goal_pose`作为projector输入，变量名proprio不能解释为IMU。
- **公开推理边界**：`run_omnivla.py:131–153`使用示例GPS/heading计算目标相对pose，155–168行读取示例图像、构造batch，170–244行预测并转速度。属于实际推理实现，但不是完整在线机器人传感器/长期地图闭环。
- **记忆**：论文§IV-A描述1Hz录图的外部拓扑路线记忆、最近节点和下一goal image；公开核心中尚未核实该外部图的创建、更新、合并与重定位全链。标Unclear，不说模型完全没有任何导航历史。
- **VLM职责/鲁棒性**：联合解释目标模态并产生行动，不是明确读写可更新空间事实的reasoner；未见IMU不确定性与跨日漂移处理。
- **相对CROSS/基线**：CROSS是定位/图记忆，OmniVLA是行动策略。可作多模态goal conditioning局部对照，不宜当完整长期记忆主基线。

### 2.5 FARM：关系查询与持续对象地图，偏离地点中心目标

- **数据流**：posed RGB-D → 分割/几何变换 → DINO/几何关联与对象Gaussian融合 → 异步VLM caption → 保存对象地图；语言query → LLM typed predicates → 几何关系求值/检索 → VLM视觉证据评分。
- **证据**：`orchestrator.py:86–107`使用深度和pose，109–173行关联更新，175–186行caption队列；`query_parser.py:17–50`定义Near/Between/LeftOf等谓词并调用LLM解析。
- **责任**：地图创建、跨帧融合由程序几何/特征模块完成，不是VLM选择地点合并。LLM理解关系要求，数值空间关系主要由executor完成；VLM并非从IMU推断自身运动。
- **存储/长期**：`scene_state_io.py:203,244`有save/load；长期保存对象地图不等于机器人跨会话重定位。无明确短期＋长期导航存储分层。对象Gaussian的协方差表示对象空间extent，不能当IMU/pose不确定性。
- **相对CROSS/基线**：一个是对象关系检索，一个是拓扑定位。FARM适合作“程序几何推理 vs VLM推理”的局部参考，不建议成为地点中心研究的主基线。公开代码可检查，模型和环境运行未验证。

## 3. 排除清单：另外五篇仍逐项覆盖

“未找到已确认核心代码”是截至核查日的检索结论，不证明作者永远没有公开；不使用同名无关仓库替代。

|论文|全文所见输入、VLM与记忆|长期能力/相对CROSS|开源判定与基线|
|---|---|---|---|
|[Mem2Ego v3](https://arxiv.org/html/2502.14254v3)|RGB-D＋已知Pose；frontier/landmark/visitation三类memory；VLM描述与导航决策。未见原始IMU进入VLM；三类功能memory不等于明确短/长期两层。程序维护地图，VLM检索/选择信息；核心合并纠错实现Unclear|长episode探索，不是CROSS式惯性多假设跨会话重定位|精确标题、GitHub/GitLab/Gitee检索及论文未建立官方核心仓库关系；排除。无源码路径，当前不可作为满足规则的可运行基线|
|[MemClaw-RAG](https://doi.org/10.1109/icra57385.2026.11695775)|RGB/多模态＋Livox Mid360及IMU，经FAST-LIO2得到pose；MGR图/向量检索、Mem0、SelfClaw快慢机制、HALP运动。原始IMU进入VLM、具体backbone、双层空间存储与合并纠错实现均Unclear|声称动态导航和记忆复用；不是已核实的带协方差运动token。与CROSS相比强调认知检索/轮腿控制|[公开8页PDF](https://rasevents.org/uploads/documents/pdfviewer/12/8c/222287-0378.pdf)无代码链接；同名MemClaw软件无关。排除，不能给虚构源码|
|[sensVLA v1](https://arxiv.org/html/2609.17021v1)|RGB、指令、20维当前state、10步state history、LiDAR BEV。当前state含三台IMU共18通道，经MLP成为VLM token；history及BEV另进action expert。不能说IMU完全绕过VLM。无长期空间记忆或其更新/合并|轮式装载机动作控制，不是CROSS式重定位。论文架构/history token叙述存在不一致，源码不可验证|未确认官方实质代码；排除。**是IMU进入VLM的重要论文层先例**，即便不入开源表也不能忽略|
|[SpaMEM v3](https://arxiv.org/html/2604.22409v3)|RGB/depth/instance/semantic数据与动态spawn/place/remove任务；short/long是probe模式，不是提出双层导航记忆算法。IMU无；VLM作为评测对象，记忆写入/纠错依被测模型|动态物品空间推理benchmark，不是CROSS竞争定位系统|[HF数据subset](https://huggingface.co/datasets/mill-ct-liao/SpaMEM/tree/main)不能代替核心生成/评测代码；未确认对应核心仓库。`draran/SpaMem`无关。排除主表，可作辅助benchmark候选|
|[Concept-Guided Exploration](https://arxiv.org/html/2608.23650v1)|3D LiDAR＋odometry；CORTEX工作图＋NetworkX长期room/door图、局部frame/GTSAM；概念agents检测、实例化、验证、更新图。无VLM，也无已确认原始IMU→网络路径|地点/房门中心持久图较相关，但属于非VLM认知架构；不等于CROSS的变化鲁棒多假设定位|仅确认RoboComp/CORTEX框架，未建立论文专用核心agents对应；[正式期刊页](https://www.mdpi.com/2076-3417/15/20/11084)数据声明on request。框架不冒充论文实现，排除|

## 4. 身份、作者与时间核对

- CROSS：Jiaming Wang、Jizhuo Chen、Diwen Liu、Atharva Ghotavadekar、Jiaxuan Da、Linh Kästner、Harold Soh；2026-05初稿，核查v2为2026-10-02。
- Embodied-Navigator：Hongyan Feng、Sunlai Chen、Xuanyu Liu、Miao Pan、Yangfan Xie、Yuxiang Cui、Zhongxiang Zhou、Rong Xiong、Wenqi Zhang、Jianwei Yin、Yueting Zhuang、Xuhong Zhang；2026-08-18初稿，v2为08-27。正文方法称TAMP-Nav；项目BibTeX与正文作者不完全一致，以正文为准。旧Navigator仓库迁往Embodied-Omni，不能误说只有网页。
- NavHarness目标论文作者：Xunyi Zhao、Jian Zhou、Sihao Lin、Gengze Zhou、Zerui Li、Xinyu Yan、Jiajun Liu、Anton van den Hengel、Qi Wu；2026-09-28。**不是**`navharness.github.io`的Adaptive Goals，也不是arXiv `2609.39915`。
- OmniVLA：Noriaki Hirose、Catherine Glossop、Dhruv Shah、Sergey Levine；2025-09-23，仓库标ICRA2026；不要将会议年份当首次发表年。
- FARM：Siming He、Leo Huang、Adam Lilja、Fabio Hübel、Jonas Frey、Marco Pavone、S. Shankar Sastry、Jitendra Malik、Claire Tomlin；2026-06-13初稿，v3为07-26。
- Mem2Ego：初稿2025-02-20，核查全文v3为2026-09-16；v2搜索缓存与v3作者名单发生变化，**作者元数据未在本报告完成逐人消歧，标Unclear**，不照抄旧列表当最新版。
- MemClaw-RAG：ICRA2026；[官方program](https://ras.papercept.net/conferences/conferences/ICRA26/program/ICRA26_ContentListWeb_5.html)列Mingyi Li、Shubo Zhang、Chunle Gao、Kaixin Yang、Ying Li；DOI搜索索引列7位作者，与program冲突，公开PDF无作者栏。元数据冲突保留，不拼接成新作者列表。
- sensVLA完整题名带“for Autonomous Wheel Loader”；Gopi Krishna Erabati、Bjarne Johannsen、Angus Stewart、Vardeep Singh Sandhu；2026-09-15。
- SpaMEM完整题名带“in Embodied Environments”；Chih-Ting Liao、Xi Xiao、Chunlei Meng、Zhangquan Chen、Yitong Qiao、Weilin Zhou、Tianyang Wang、Xu Zheng、Xin Cao；2026-04-24初稿，v3为05-29；[ECCV章节](https://doi.org/10.1007/978-3-032-37235-2_25)online为09-15。
- Concept-Guided：Noé José Zapata Cornejo、Gerardo Pérez、Alejandro Torrejón、Pedro Núñez、Pablo Bustos；arXiv为2026-08-24，但已有2025-09-23预印本`10.20944/preprints202509.1887.v1`及Applied Sciences 2025,15(20),11084，`10.3390/app152011084`，不能列为首次2026工作。

## 5. 创新空间：有组合缺口证据，尚无“首次”证据

**在本次核实的五个公开核心实现中，未确认存在“带不确定性的惯性信息直接进入VLM→跨时间地点推理→可更新双层导航记忆→长期重定位”的完整闭环。** 这是有限范围结论，不是全领域不存在。

不能主张的创新：VLM＋IMU（sensVLA、另见[Motion-MLLM](https://arxiv.org/html/2603.17980v2)论文先例）；pose token＋VLM＋历史（Navigator）；VLM＋持久导航记忆（NavHarness）；惯性协方差＋长期拓扑定位（CROSS）；语言关系解析＋空间存储（FARM）。Motion-MLLM有IMU GRU motion tokens，但本轮未确认官方核心代码，不能入开源主表。

值得检验的更窄主张：

1. 将测量传播得到的预积分运动、协方差、bias/时间跨度编码为VLM可用证据；明确区分raw IMU encoder与VIO posterior encoder，不把pose换名为IMU。
2. 让VLM对地点同一性、方向/路径关系提出带证据和置信度的假设；允许“不知道”，通过再观察而非强写地图消歧。
3. 短期保存未决运动/地点假设，长期保存经过重访验证的地点、边、历史路径及版本；支持冲突、撤回、合并和回溯，不能只做append文本摘要。
4. 把VLM建议与几何/概率验证分工写清：VLM负责跨时间推理，后端验证约束、控制错误写入；不承诺VLM直接取代成熟惯性积分。

建议候选基线组合：Navigator（网络侧）＋NavHarness（记忆侧）＋CROSS（定位侧），而不是把某一个包装成完整现成基线。后续最小消融应区分无运动、确定pose、带协方差pose、惯性motion tokens，以及只读/可更新/可纠错双层记忆。长期证据需覆盖测量层噪声与bias、重访、外观变化、错误闭环及跨会话恢复，同时报告重定位/导航与记忆错误；本轮没有启动这些实验。

## 6. 审计边界与留档

采集脚本：`research/scripts/audit_spatial_memory_sources.py`；它仅下载文本、浅克隆稀疏代码并记录SHA，不执行第三方项目。全文HTML/文本、MemClaw PDF、源码和逐文件hash存于Windows批准临时目录`spatial-memory-audit-20261027/`；精简provenance另存本报告同目录的JSON。

尚未完成到可宣称“逐模块完整复现”的部分：部分附录未逐段确认；OmniVLA外部拓扑部署链、FARM全部streaming/谓词链未完整追踪；Navigator anchor疑点未运行测试；五个被排除项不提供不存在的源码位置。主表相应保留Unclear或限制说明。

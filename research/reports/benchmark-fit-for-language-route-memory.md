# 四个具身记忆 benchmark 对当前项目的适配性

日期：2026-10-27。目标：RGB＋IMU证据→VLM＋可更新双层地点记忆→根据当前画面，用自然语言说明路线。此次核查论文任务/指标、官方发布页及部分核心源码；不运行模型/模拟器，不下载数据资产。源码网页为访问时状态，正式实施前需再次固定commit。

## 结论

可以承载部分能力，但没有一个已确认原生覆盖“IMU输入＋长期地点纠错＋自然语言路线规划”的全部目标。**可接入方法≠原生指标足以评判该方法的全部价值。**

建议：LMEE-Bench作场景/多目标路径与记忆问答候选；FindingDory作历史目标和重访顺序的标准化辅助测试；EMem-Bench作动态更新/失败记忆辅助验证；3DMem-Bench概念相关但公开可运行资源未确认，暂不作为首选落地依赖。不因此放弃现有benchmark，也不急于自建大型数据集。

|Benchmark|原生任务与输出|记忆方法能否接入|自然语言路线适配|原始IMU|发布/工程状态|
|---|---|---|---|---|---|
|FindingDory|历史交互→选择目标/有序目标→导航；HL-SR/HL-SPL及LL指标|可以：用我们记忆返回历史目标帧；保留原题和目标判定|需扩展：选对目标不代表中间路线/左右说明正确|未见原生测量；RGB-D、GPS+Compass、历史pose/action不是IMU|官方Habitat代码与HF数据；HSSD/OVMM资产依赖；此轮未运行|
|3DMem-Bench（3DLLM-Mem论文）|跨房间具身动作任务、EQA、caption；1860+865+167=2892测试任务|概念上可以，不要求我们的记忆一定采用其dense 3D模型；实际runner/数据未确认|Spatial/Nav/Layout EQA较接近，但不能假定每题是路线说明|论文RGB-D＋camera pose，无确认原始IMU|项目页Code指向官方占位README；未确认完整公开benchmark包，暂阻塞|
|EmbodiedMemory-Bench/EMem-Bench|历史→继续执行动作；2554 episode、四类任务；SR/ERR|可以：替换memory adapter/规划器，但需尊重其动作/观察权限|部分：适合状态更新，不适合作路线几何主测；房间抽象跳转需特别小心|未见原生IMU；metadata/agent state不是IMU|Embodied-Omni/embodied_memory有runner/环境/评分实现；HF发布；AI2-THOR/ProcTHOR依赖|
|LMEE-Bench|多目标导航＋记忆QA；166测试任务、828目标、406问题；SR/SPL、QA分数/accuracy|可以：换记忆模块与VLM适配，不必为使用benchmark先训练MemoryExplorer|四者中最适合作路线场景候选之一，但原生QA仍以属性/计数/位置/关系/状态为主，路线文字需另评|未见原生IMU；轨迹position/rotation及离散actions不能直接当测量|官方evaluation代码、HF数据可访问；全量HF约22.4GB；HM3D-Sem资产仍是前提|

“未见原生IMU”只针对已检查的论文/代码接口；没有对所有数据文件进行穷尽扫描。真实长时漂移、跨天重定位和语言指路均不能由以上benchmark名称自动推定为有。

## 1. FindingDory

来源：[论文v2](https://arxiv.org/html/2506.15635v2)、[官方Habitat仓库](https://github.com/findingdory-benchmark/findingdory-habitat)、[训练/离线评估仓库](https://github.com/findingdory-benchmark/findingdory-train)。

- §3：体验采集与后续交互分开，oracle先收集历史，模型根据历史完成后来目标。60种模板不是60条样本；论文val为100条历史episode、5876个任务实例。
- §3.2：HSSD，RGB-D＋GPS/Compass，离散0.25m移动和10°转向。pose、历史动作以及“yesterday”任务措辞都不等于真实IMU或真实跨日定位。
- §4.1：高层输出一个/多个历史帧索引，低层执行ImageNav或mapping。§4.2已有HL-SR/HL-SPL，适合在不开发控制器前评测目标选择；不能把HL结果当整条路线执行成功。
- 对我们最有用：Room Visitation、Spatial Relationship、Ordered/Unordered Revisitation。任务仍大量围绕物体/容器；可将目标所在地点作为我们地图中的锚，但不能擅自改原题后仍称官方全量成绩。
- 适配：按历史顺序增量建立记忆→任务给出后检索原图/地点→返回原生目标帧/序列供官方HL打分；另输出从当前画面出发的路线文本，单列扩展评分。
- 限制：原生目标正确不证明中间通路存在；frame-selection基线对“未访问房间”本来就有表达能力上限，不能强行把全部模板都压为历史帧检索。

## 2. 3DMem-Bench：先消除同名混淆

来源：[3DLLM-Mem v2全文](https://arxiv.org/html/2505.22657v2)、[官方代码README](https://raw.githubusercontent.com/3DLLM-Mem/3DLLM-Mem/main/README.md)、[项目页源码及Code链接](https://github.com/3DLLM-Mem/3dllm-mem.github.io/blob/main/index.html)。

**它不是UMass的3D-Mem方法，也不是我们已跑的HM3D A-EQA 26题。** 不得将已有26题成绩称为3DMem-Bench成绩。

- §2：多房间HM3D-Sem场景，添加Objaverse交互物体；采集RGB-D及相机pose、交互反馈/预计算点云。
- EQA覆盖Spatial、长期object navigation、Comparative、Layout、Count；另有caption及多步操作。最相关的是Spatial/Nav/Layout，不必因原baseline用dense 3D就认为我们的轻量地点图不能参评。
- 但文字“Nav”不是已证实的逐步自然语言指路标签；caption也不能代替路线正确性。
- 官方Code链接目前指向只有模板README的仓库；独立第三方重实现不能冒充官方benchmark发布。数据完整性、官方下载/许可、runner与评分包均需进一步确认，不能推荐“马上跑全量”。

## 3. EMem-Bench：更新能力好，物理路线主测不合适

来源：[论文](https://arxiv.org/html/2609.28236v1)、[官方实现README](https://github.com/ZJU-OmniAI/Embodied-Omni/tree/main/embodied_memory)、[HF数据](https://huggingface.co/datasets/lzLiang/EmbodiedMemoryBench)。

- 四类：Passive Observation 1036、Dynamic Tracking 1052、Interaction Failure 263、Experience Generalization 203。总体SR是四类等权均值；ERR衡量特定记忆依赖决策处的错误复发。
- 适合验证：新状态替代旧状态、保存动作失败、跨历史检索与冲突纠正。不应为了跑满四类而把我们项目扩大成抓取/摆放机器人。
- 论文§4.3：部分AI2-THOR单房间组成virtual home，扩展LeaveRoom/EnterRoom/MoveToRoom，房间重入恢复状态；这种房间切换不能当作有物理连续走廊的运动轨迹。ProcTHOR虽有多房间几何，仍需逐例检查实际采集方式。
- 实际源码（固定到先前审计的`78ef297d342d1f44bb15975e36555f8abee18448`）：`embodied_memory/src/emem_bench/evaluation/env.py`的`reset/step`接动作，`_observation_dict`返回图像、visible_objects、agent_state、available_actions、context；`_candidate_objects`/`_refresh_action_space`可使用模拟器metadata构造动作候选。
- 因此“用官方接口动作成功”不能证明仅从RGB定位成功。需要追踪runner实际送给模型的字段，若加上RGB-only过滤，必须记录与原协议的差异。
- 只输出语言不能直接拿官方SR：该分数依赖执行和最终世界状态。可以另做“本来该去哪/避免哪个失效目标”的辅助测验，明确是派生任务，不改称原分数。

## 4. LMEE-Bench：优先候选，但原版并非语言路线benchmark

来源：[论文](https://arxiv.org/html/2601.10744v1)、[项目页](https://wangsen99.github.io/papers/lmee/)、[官方代码](https://github.com/wangsen99/LMEE)、[数据树](https://huggingface.co/datasets/wangsen99/LMEE-Bench/tree/main)。

- 论文§3/§5：基于HM3D-Sem/GOAT目标，多目标导航期间构建记忆，随后回答属性、计数、位置、关系、状态问题；已有探索轨迹、RGB视图及position/rotation。
- 全测试166任务/828目标/406问题；正文部分实验只用58任务/272目标/145问题，不能混为同一个分母。官方README提供full与sub两种路径。
- 公开`evaluation/run_lmee.py`实际执行多视图观察→posed RGB-D更新scene graph/TSDF→snapshots/frontiers→VLM查询→planner移动→目标和QA计分。模型权重加载处为本地模型，需要我们单独API适配；这不是训练前提。
- 该runner把模拟器cam_pose送入几何建图，也调用pathfinder；它不是原生VIO/IMU误差实验，替换VLM后仍不能自动消除GT几何依赖。
- `evaluation/eval_lmee_bench.py`的`evaluate_open_answer`用问题、GT答案、目标图和预测打1–5分，再归一化；不是评价整段路线可达性。按既有约束改用Plus裁判必须标“评分后端适配”，不直接与论文绝对分数混比。
- README仍将data generation scripts列为待发布。因此公开导航/QA评估不等于已经有方便的物理连续IMU数据生成器。
- 建议先保留公开题做记忆QA兼容性测试，再挑开发场景审查是否存在可验证的跨地点路径，以这些路径生成“当前画面→历史目的地”的扩展题。不能只因为多目标导航就假定每条任务都适合语言指路。

## 5. 推荐采用双轨，而不是一个总分包办

### A. 标准能力轨（尽可能不改任务）

- FindingDory：返回历史目标帧/目标顺序，用原生HL指标，检验记忆检索与目标理解。
- LMEE：原生QA，检验探索记忆的语义/位置/关系理解；执行导航未实现前不报Nav SR/SPL。
- EMem：后续动态状态/失败记忆辅助项，不作为当前主门槛。
- 训练需求由baseline决定，不由benchmark强制；我们继续API方法，记录适配。

### B. 项目目标轨（显式扩展）

借用可访问、许可允许的benchmark场景和历史，新增一层“路线说明评测”，而不是从零搭大型benchmark：

1. 历史按时间写入记忆；任务未出现前不提前按答案挑关键帧。
2. 给定当前RGB、用户目的地；输出自然语言路线及内部逐步证据引用。
3. 评测侧保存可接受的多条路径，不只接受唯一字符串；GT图/路径不给系统。
4. 分别评：目标选择、起点/朝向判断、地点顺序/路径连通、地标对应、转向正确、无依据距离/步骤、拒答与澄清、语言可理解性、证据覆盖。
5. 拓扑/方向由独立路径标注和几何核验；语言表达由Plus/人工评分辅助，不能只让LLM看起来“合理”就算路线正确。
6. 若日后用人/固定follower走一遍，只是附加可执行性验证，不以此要求项目先开发机器人控制器。

路线可以正确但不唯一；只有目标帧正确/QA正确，不能算路线正确。缺路径时正确澄清应单列，不能全部拒答刷高成功率。

## 6. IMU应作独立输入扩展，不从动作生造

四者未见可直接使用的原始IMU接口/发布证据。要加入IMU，需要连续物理轨迹、时间、相机/IMU外参和重力约定；不能把0.25m步长/瞬时转向/跨房间跳转二次差分成“真实IMU”。

- 先确认所选场景能重渲染，并从同一条连续轨迹同时生成图像和IMU；或使用真实同步RGB-IMU补充轨。
- 平滑/改轨后必须重渲染，检查碰撞、可见性、任务证据仍成立。仅导出GTpose再加漂移不是原始IMU实验。
- RGB-only、惯性派生运动、VIO posterior、GTpose oracle分组；共享图像/预算，GT只进评测。
- 同时改变输入模态、图像轨迹和输出任务时，是“基于某benchmark的扩展协议”，不能报告为原版排行榜结果。
- 原生benchmark先证明记忆有用；扩展轨再检验IMU是否帮助地点/方向消歧，不预设IMU必然提升所有语义题。

## 执行建议

先核查LMEE和FindingDory各一条episode的实际数据字段/许可/场景资产，冻结少量开发样本；**不启动22.4GB下载、模型部署或批量调用**。若路径/资产受限，先跑FindingDory高层目标和LMEE离线QA，语言路线与IMU完整能力保留未验收。HM3D-Sem当前本机缺完整semantic资产仍是已知阻塞，不因新benchmark名称自动解决。

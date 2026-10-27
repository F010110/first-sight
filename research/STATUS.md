# 科研复现状态

新增四benchmark适配核查：见reports/benchmark-fit-for-language-route-memory.md。LMEE-Bench可作探索记忆/路线场景优先候选，FindingDory可作原生HL目标/重访顺序辅助，EMem-Bench偏动态状态/交互失败记忆；3DMem-Bench属于3DLLM-Mem，非此前26题，官方Code当前仅占位README，未确认完整评测发布。四者均未确认原生原始IMU或自然语言路线完整评分；需分原生能力轨与显式扩展轨，不把目标选择/QA分数当路线正确。未启动下载或运行。

指定10篇论文全文＋官方核心代码联合核查已完成（2026-10-27），见reports/spatial-memory-paper-code-audit.md及provenance JSON。确认5个实质公开仓库并入主表：CROSS、Embodied-Navigator（Embodied-Omni子目录）、NavHarness、OmniVLA、FARM；各自commit固定。另5项因未确认官方核心代码排除：Mem2Ego、MemClaw-RAG、sensVLA、SpaMEM、Concept-Guided；框架或HF数据不冒充论文实现。结论仅限已核实范围：未发现“带不确定性惯性信息直接进入VLM→跨时间地点推理→可更新双层导航记忆→长期重定位”的完整公开闭环；Motion-MLLM与sensVLA仍是IMU→VLM论文层先例，不能称首次。最接近组合为Navigator网络侧＋NavHarness记忆侧＋CROSS定位侧，不是任何单篇现成基线。未运行第三方代码、未下载权重、未启动实验。

最新目标进一步收窄为地点／位移／朝向／定位中心的长期记忆，由VLM承担主要空间推理、可用IMU，不以具体物品为中心。调研见reports/place-centric-vlm-imu-memory-neighbors.md：确认Motion-MLLM的IMU→VLM融合先例、CROSS的跨会话拓扑定位、VLG-Loc的VLM观测→全局定位（三台120°相机）、NavMind的VLM认知地图；各有明显缺项，尚未确认全部目标同一方法覆盖，也未宣称空白。注意CROSS当前项目传感模式／榜单与论文v2不同；未启动任何新实验或部署。

最新目标澄清：先确认“生成式VLM空间推理+几何定位／空间记忆”的已有方法，再决定鲁棒性或方法创新。已核查GraphEQA（Hydra/TSDF位姿依赖+VLM层级规划）、ConceptGraphs（posed RGB-D关联+LVLM描述/LLM关系）、Mobility VLA（COLMAP/PnP支撑拓扑图+长上下文VLM目标选择），并补充无需执行导航的GraphPad实例。详见reports/vlm-spatial-reasoning-geometric-dependency.md。明确该组合已有先例，不以未找到为由声称空白；IMU不是所有方法的必要输入。未启动实验；GraphEQA语义资产限制及Mobility VLA/GraphPad未确认完整官方代码均保留。

空间／情景记忆方向重审：见reports/spatial-memory-and-direct-vlm-comparators.md。Direct的主对手改为图像检索、视频RAG、事件／摘要记忆和自适应视频搜索；3D-Mem保留为IMU漂移下空间建模的独立支线，不再用精确导航交付判定Direct胜负。报告区分全历史Direct与分批穷举，核对ReMEmbR、两篇不同VideoAgent、VideoTree、EgoLife与候选数据；Direct的细节／动态／事后新问题优势均为待验证假设。未启动新实验、未更换数据集；数据下载及多摄可用性未确认。

Direct强VLM先导4次生成／Plus评分已完成，非26题结论：纸桶题3D-Mem+Flash3、Direct+Flash1、Direct+Max5；喝水题对应4、1、1。后一题Direct都回答水槽而非参考冰箱饮水机；不能凭2题认定结构或模型必胜，且重渲染原图非字节一致、缺3D-Mem+Max配对。原始结果reports/direct-vlm-pilot-v1-results.json，输入manifest单独保存。IMU文献进一步核查见reports/vinseval-and-ipnet-critical-review.md：VINSEval是FlightGoggles仿真评估，IPNet是EuRoC/TUM-VI等bias先验方法，两者不是同一工作。

新增用户任务：IMU鲁棒性文献与无3D强VLM对照。核查VINSEval、OpenVINS、VIO-IPNet、TLIO、mi-VINS、ORB-SLAM3及CVPR2022 EMQA等，见reports/imu-robustness-related-work.md；不再把加IMU噪声本身视为新算法。Direct全历史图像问答先导已后台启动准备：前2题GT轨迹截至最后实际VLM查询，360px无标注RGB，Flash与Max各一次、Plus裁判，不给pose/对象表/参考答案。首准备遇外层超时，旧目录保留，独立retry1目录重新生成，尚未宣称推理完成；重渲染非字节同图限制已写协议。见reports/direct-vlm-v1-protocol.md。

V2真实图像VIO smoke三条件已完成：统一原生静止初始化后537/601有效相机时刻，低噪／BMI-like／MPU-like位置RMSE分别0.0561／0.6131／0.2833m；末帧0.0709／0.3899／0.3253m。MPU-like中断后的独立重跑已完成，旧部分文件保留，无后台任务。MPU-like不必比BMI-like差（陀螺白噪声更低，且仅1种子），不能据此排列实物档位。下一步为同图完整3D-Mem回放，当前仍无V2下游得分。

真实图像VIO smoke进展：601图／6010IMU每条件已生成。原配置v1因纯旋转阶段动态初始化退化（低噪参考都发散）被判不可用于下游并保留。统一启用原生启动ZUPT／静止初始化后，低噪参考位置RMSE5.61cm、BMI-like61.31cm，首有效3.2秒、537/601有效时刻，未补GT。MPU-like首次被外层工具120秒时限中断，部分csv/log已保留，后台仅重跑此条件；不是传感器/VIO异常。尚无V2的3D-Mem结果。见reports/image-vio-v2-initialization-audit.md、image-vio-v2-smoke-static-init-v2-results.json。

V2构建更新：research_image_replay后台编译链接成功，入口用法检查通过；连续HM3D图像生成任务尚待完成通知。还没有真实图像VIO成功轨迹或V2下游得分。此前“构建未确认”已由本条更新。

V2启动记录：新增openvins_image_replay.cpp与CMake目标，后台正在构建真实图像回放驱动；首次120秒构建超时，未宣称编译通过。另启动generate_hm3d_image_vio.py实际渲染第1题固定GT路线smoke序列（20Hz图像、200Hz三套IMU），生成器语法检查已通过。尚无VIO轨迹／V2下游得分，不调用VLM。

主线切换V2图像VIO：用户明确要求位姿输入改用VIO或更强定位。保留3D-Mem，下游不换；旧纯惯导先导停止扩展。现有OpenVINS仿真使用理想特征／GT初始化，不作为真实图像主实验。新增无ROS实际图像＋IMU回放适配器openvins_image_replay.cpp，使用原生视觉惯性初始化与feed_measurement_camera，正在构建验证。连续HM3D序列、坐标校验、VIO输出和完整3D-Mem接入尚未完成，无V2得分。方案见reports/image-vio-v2-protocol.md。

最新异常已定位：第2题MPU-like第7步清理将49对象降为13并删除冰箱对象33；planner.max_point仍引用第3步旧快照cluster=[33]，agent_step可视化访问objects[33]抛KeyError。不是休眠／OOM／网络。该运行已生成接近参考的饮水机候选答案，未正式交付；第1题两噪声运行同样生成过文本但因目标导航失败未写正式输出，不能说VLM没作答。第1题BMI-like前13帧RGB-D与GT相同，第2步末对象GT9 vs BMI17、快照5 vs7，提供同图融合退化证据。分析与过程曲线见reports/imu-memory-v1-pilot-findings.md、reports/imu-memory-v1-process/。仍暂停，未修复重跑；2题1种子纯惯导米级误差不外推正常VIO。

最新运行状态：IMU先导已尝试6/9（5个进程正常结束，第6个即第2题MPU-like进程失败），主控按保护规则停止，余3次未启动。该失败末帧纯惯导位置误差约29.4m，尚未诊断具体异常；不将进程失败等同VLM答错，也不把结果视为正常VIO性能。当前无继续运行的先导任务，未自动重跑。全部原始文件保留。研究工作改在research/3dmem-imu-noise分支提交，其他已有仓库改动不混入。

当前已启动IMU噪声先导：独立3dmem-imu-memory-runtime-v1，首3题按ID顺序×GT/BMI-like/MPU-like共9运行，种子0，GPU串行。BMI-like(.014deg/s/√Hz,175ug/√Hz)、MPU-like(.005,400)，附较小假设残余bias，测量级注入后纯惯导积分；对象融合／快照用估计pose，TSDF导航保留GT。此为纯IMU记忆侧诊断，不是VIO或完整噪声导航。3个数值自检已通过；原26题与源码冻结不变。过程保存原始IMU、pose、原生匹配／融合后对象与快照、VLM选择及图像hash。见reports/imu-memory-v1-pilot-plan.md、reports/imu-memory-v1-protocol.json；进度reports/imu-memory-v1-pilot-progress.json。首轮尚未完成，不宣称已获噪声结果。

最新决定（覆盖下方R4优先）：用户排除未开源方法。继续使用冻结3D-Mem，恢复真实传感器噪声实验方向，不等待R4代码、不自行重写R4。补查开源候选：Pred-EQA A-EQA53.3（8B）、56.3（32B），较52.6并非巨大正确性跃升；Prune-Then-Plan严格视觉grounded评分29.2→34.3，需token概率及单独校准，不能同原Match直接混比；SAGE有开源代码、报告60.2，但依赖RL训练专用小VLM，与当前不部署本地小VLM／通用Qwen API约束不兼容，不能宣称不存在更强开源方法。当前未启动新噪声运行。详见reports/stronger-aeqa-baseline-audit.md补充。

最新用户条件决策：查到R4（CVPR2026）正式论文A-EQA HM3D74.00；其单智能体184题对照72.82，明显高于引用的3D-Mem52.6。此前“无明显更强方法”的判断撤回。优先目标转为R4单智能体复现可行性审计，暂不启动噪声。阻塞：尚未找到可确认官方代码／完整执行配置；不以自写近似冒充完整复现。继续遵守Qwen API、不部署本地小VLM。见reports/stronger-aeqa-baseline-audit.md，正式论文PDF已保存。3D-Mem冻结结果全部保留。

最新评分：Flash原始26题回答不变，改用可用的qwen3.7-plus-2026-05-26裁判、官方同提示。25/26项相同（非空24/25）；唯一3→4，Plus归一化59.62 vs Flash58.65。主要错题不因换裁判消失。已检查低分题所选快照及日志，诊断见reports/minival26-plus-scoring-and-errors.md；存在目标视角／实例指认、缺证据仍作答和一例frontier失败，个别宽泛位置题有参考歧义。当前仍无新误差实验。

26题基础运行和Qwen裁判评分已完成：26进程退出0，25题有回答，12题裁判满分；固定26分母归一化Match58.65/100（有答100*(raw-1)/4，缺答0），不是准确率或原论文可比成绩。无答案题因第0步frontier area=0失败。推理成功API136次、记录447178总token；评分用量另计。完整总结reports/minival26-baseline-results.md；人工视觉抽查与SPL尚未完成。保持复现优先，未开始新误差实验。

26题基础运行已完成：26/26进程正常退出，累计3.688小时；这不是答对率。正在用上游mmbench评分提示及qwen3.8-flash评分（最多每个已有回答1请求，无重试），固定26题并保留空答／评分失败。此为同模型族裁判适配，不是论文GPT-4评分复现；人工复核待做。输出reports/minival26-qwen-judge-v1.json。无误差实验。

当前执行：用户要求复现优先、不针对错题额外处理，已冻结26题基础运行并启动后台。与上游逐文件比较仅src/const.py、eval_utils_gpt_aeqa.py、habitat.py、scene_aeqa.py四处适配；主循环／对象融合／快照／提示不改。冻结差异见reports/minival26-runtime-diff.txt，配置／预算见reports/minival26-baseline-v1-manifest.json。每题50步、110请求上限、4096输出token/请求、无SDK重试、3600秒超时；全部26题各运行一次，失败不删、不自动重跑。进度reports/minival26-baseline-v1-progress.json，结果尚未评分。不注入误差；不以完成率代答题分数。

当前优先级（用户明确）：暂停噪声／VIO注入／三摄实验，先复现基础方法。已阅读论文v2 §4.1/7/9.1并检查首题快照：起始0-view_3可见黄盖大桶，最终选择1-view_0为另一侧杂物，回答蓝色桶。需追踪检测→融合→快照→预筛→最终输入，尚不能断言单一根因。Success1/1源码仅表示到达所选快照，不是答题正确。完整审计 reports/minival-pilot-failure-audit.md。

完整3D-Mem API首题试跑退出0，融合、去噪／合并、快照探索到回答链路均运行。题目问纸应放哪个桶，GT黄盖、预测蓝色回收桶；不能视作答对。日志Success1/1仅流程完成，尚无正式问答分数。已取得官方A-EQA评分工具，发现其过滤缺失答案，正式汇总需固定26题分母。详情 reports/minival-first-pilot-result.md。后续关闭端点INFO日志，SDK重试=0并增加usage记账。

完整入口--help导入预检已通过，尚不代表任务运行成功。已启动首题端到端API试跑，保留官方融合／快照／探索，模型qwen3.8-flash；API总请求上限6、每请求最多4096输出token、无自动付费重试，Windows凭据仅通过WSLENV传入进程，不写入文件或日志。入口scripts/run_3dmem_minival_pilot.sh，日志reports/3dmem-minival-pilot-*.log。此阶段不跑全26题、不报告正式分数。

minival复测：wxyz修正后7/7场景和26/26题目起点渲染检查全部通过，不删题。已生成独立完整3D-Mem适配副本runs/3dmem-minival-runtime-v1，上游源码不改；保留原融合／快照／规划，修改raw GLB路径、重建navmesh、EGL及Qwen API后端，默认单题试跑总API上限6次、无自动付费重试。正在执行--help导入预检（零API）；首轮60秒前台超时，已改后台运行。尚无完整任务成绩。适配hash见reports/3dmem-minival-runtime-adaptation.json。

minival验证首轮完成：7/7场景navmesh重建成功，26/26原始起点可导航；两场景仅因有效深度阈值未过而标false。复查发现验证脚本把A-EQA wxyz误按Habitat列表xyzw输入，原报告渲染诊断不可用于删题／判定资产缺陷。已改为numpy-quaternion的wxyz构造（同上游get_pts_angle_aeqa约定），重跑v2-wxyz，独立保存新报告，旧报告保留。尚无任务分数。

## 最新数据决定

用户提供hm3d-minival-glb-v0.2.tar并确认先在现有数据上评测。已安全解压10个GLB，冻结官方184题交集26题／7场景；已启动本地网格生成、原始起点和RGB-D检查，无API上传。raw GLB非basis、无官方navmesh／语义标注，适配细节和完整评测范围见 reports/hm3d-minival-evaluation-protocol.md。旧文“等待HM3D”的阻塞已改为现有资产适配验证，尚未得到完整任务成绩。

## 重要更正（优先于下述旧摘要）

复查发现此前关联脚本匹配后未融合对象／更新特征，也未运行周期去噪／合并及快照检索，所以ARI0.325、对象31→67等数字仅为简化关联诊断，不是完整3D-Mem结果；旧摘要关于“排除稀疏采样假象”等措辞不能当作完整方法结论。下一步必须恢复原生完整链路并报告任务得分。传感器误差改为真实／估计器参数失配及初始状态误差，不以固定轨迹漂移代替。详见 reports/full-evaluation-and-sensor-errors.md。HM3D本人授权及资产仍待确认。

## 当前（2026-10-26）

已完成：环境、GPU、API冒烟；OpenVINS构建与18组噪声试跑；3D-Mem原生映射函数在ReplicaCAD上的位姿误差关联实验（含真实OpenVINS估计位姿注入）。

关键结果（详见 `reports/3dmem-pose-association-results.md`，无API调用）：

- 恒定yaw 1°使3D-Mem对象关联ARI从1.0降至0.73，地图对象28→34；yaw 2°降至0.54，28→45；主效应为过度拆分。
- 48帧密集采样复核，效应仍存在（yaw1 ARI 0.72），排除稀疏采样假象。
- 恒定平移1/3/10cm无影响，属于正确的负对照（全局刚性移动）；只有逐帧漂移造成变化。
- 真实OpenVINS估计位姿注入（39帧，位置均值0.276m／最大0.394m，朝向均值0.411°／最大0.828°）：ARI 0.325，地图对象31→67，20/31参照簇被拆。同帧纯0.5°／1°朝向对照为0.970／0.688。

尚未完成：

- 下游检索或任务分数（“关联退化是否改变最终得分”未知）。
- HM3D原版A-EQA／GOAT：需用户本人签署学术许可，未下载、未代签。
- 三摄对照。
- 完整RGB-VIO：当前OpenVINS使用合成视觉特征，相机—IMU外参设为单位阵。

## 已知限制

1. ReplicaCAD场景，不是HM3D；结果不是官方benchmark分数。
2. OpenVINS视觉输入为合成特征，非渲染RGB；只能说明“该轨迹上的VIO误差注入后的影响”。
3. GT初始化，未测初始化失败／重定位／跟踪丢失恢复。
4. 单场景、单轨迹；无重复种子统计。
5. ARI以GT位姿关联为参照，不是绝对物体ID准确率。

## 运行环境

- `research/envs/findingdory`：Python3.9，Habitat-Sim 0.3.1，torch 2.5.1+cu124。
- `research/envs/3dmem`：Python3.9，Habitat-Sim 0.2.5 headless（无Bullet），torch 2.0.1+cu118，PyTorch3D 0.7.4。
- `research/envs/openvins`：Ceres 2.1（CPU）、Eigen 3.4、SuiteSparse 5.10.1；无ROS构建，`research/runs/openvins-build`。
- GPU：RTX 4060 Laptop 8GB；D3D12 EGL需要 `GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` 与 `--egl-default-device`。
- headless+Bullet版Habitat-Sim在此WSL渲染段错误，已改用无Bullet；ReplicaCAD改用移除可动家具的静态场景实例。

## 历史记录（按时间）

- OpenVINS最初60秒、特征距离5–7m配置在慢速小范围轨迹上发散，末端位置误差约14m；保留为失败记录。
- 40秒、特征距离2–5m配置稳定，位置RMSE 0.30m（该次整体统计）。
- 噪声试跑：在线标定开启时0.5/1/1.25倍噪声平均RMSE为0.404/0.350/0.327m，非单调，seed影响大；固定标定后为0.0118/0.0145/0.0152m。说明结果强依赖标定设置，不能把误差归因于小噪声。详见 `reports/openvins-noise-pilot-summary.md`。
- 构建过程中遇到并记录：Ceres默认依赖nvcc、SuiteSparse 5/7头文件混装、Eigen版本不符；均通过锁版本解决，未跳过检查。

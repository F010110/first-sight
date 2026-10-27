# 地点中心、VLM主导、可用IMU的长期空间记忆：接近工作

## 最新目标

记忆主体是地点、朝向、位移与连接，而非物品身份；VLM应参与跨观测空间整合、地点判断或定位，不只是给SLAM附加语义。IMU可以提供运动证据，不一定要求VLM直接编码原始IMU。长期应区分单段长视频与跨会话持久记忆。目前找到多项分别覆盖目标的工作，尚未确认有完整覆盖全部要求的方法，不能据此宣称首次。

## 1. Motion-MLLM / Feeling the Space，2026预印本

已读v2：https://arxiv.org/html/2603.17980v2

最直接的VLM+IMU空间理解先例：同步6轴IMU用于运动门控选帧，2层双向GRU编码关键帧间运动，经cross-attention与Qwen2.5-VL/VGGT视觉特征融合。不是仅将VIO的最终pose交给外部地图。主评测VSI-Bench、ScanQA、SQA3D、ScanRefer、Scan2Cap；主要IMU由数据集GT位姿样条微分生成并加MEMS噪声，另有TUM-VI六条室内序列120道人工QA的真实IMU验证。作者报告VSI-Bench58.2、真实IMU QA49.0，不能称长期定位成绩或当前全面SOTA。

差距：未展示持久地点图、跨会话重定位、连续定位误差或回环纠正；不少任务仍关注对象。IMU积分位移的可靠性依赖bias、重力和初速度等，不能照搬其“easy integration”描述为无漂移事实。需训练运动编码／融合及骨干，不能通过现成Qwen API直接复现。此次搜索未确认官方代码／权重，按既有约束暂不复现。

## 2. CROSS，2026

已读论文v2：https://arxiv.org/html/2605.02227v2
项目：https://jiaming.im/CROSS/
官方代码入口：https://github.com/jiaming-ai/CROSS

最接近长期地点记忆：稀疏RGB-D关键帧拓扑图、pose分布，VPR提出候选，经相对pose/PnP转换为SE(3)假设，由odometry验证连续运动一致性，延迟接受回环后优化。论文评测OpenLORIS Corridor、Rover Campus跨会话重定位与真实机器人任务。不是单纯记住物品，而是维护“我在哪、这个地点是否重访、旧地图能否复用”。

关键不匹配：VLM兼容，不等于VLM主导定位。核心推理是视觉检索、几何和概率滤波。当前项目页新增IMU、Basalt VIO、单目／双目等传感模式，比论文范围更广；必须固定版本，不能把项目当前93%与论文约40%的不同协议混作提升。项目页已核实存在代码链接，未本机运行或审计所有模式。

## 3. VLG-Loc，2025预印本

已读v2：https://arxiv.org/html/2512.12793v2
官方代码及数据入口（论文给出）：https://github.com/CyberAgentAILab/VLG-Loc

最接近“VLM给定位提供关键证据”：GPT-4.1识别多方向图像中预设地图地标／区域，基于标签footprint地图模拟各pose的可见地标，以一致性作为MCL似然，输出SE(2)位置和朝向；可与激光似然融合。地标可为入口、区域或货架分区，不必是小物品。

真实平台三台D455、光轴相隔120°，底盘含IMU/轮速/LiDAR；但论文视觉定位核心不是原始IMU融合，评测主要为全局pose假设匹配，而非长期时序记忆更新。使用人工预建地图，不能称VLM自主建图；VLM主要承担语义观测关联，概率几何承担定位。是真实多摄实例，却未据本轮阅读确认单摄vs三摄消融，不能说已证明三摄必要。

## 4. NavMind / Video2Mental，2026预印本

已读v1：https://arxiv.org/html/2603.21577v1

VLM从长第一人称视频生成结构化层级认知地图，再产生路线计划，使用Habitat物理验证，较接近“空间表征由VLM产生”而非只读现成图。没有已确认的IMU输入；使用区域→地标→对象的结构，仍有对象／landmark依赖。任务定义提及视频associated poses，但需代码／prompt核实哪些pose实际喂模型，不能称完全无pose。单段长视频不等于跨会话长期持久记忆。正文数据规模、split和若干表值有不一致（例如摘要23700/2300与正文约24k、21330/2650），不直接采用其汇总跑分。未确认可复现官方代码，暂不部署。

## 相邻但不优先

- Mem2Ego：https://arxiv.org/html/2502.14254v2 ，已读：frontier、landmark语义与visited位置记忆投影到ego图让VLM决策。当前pose已知，主要ObjectNav、单episode；GT语义和Habitat shortest-path follower是实验条件，不是长期定位验证。全景由依次旋转90°采集，不是真同步四摄。
- SuperMap：https://superodometry.com/supermap ，项目明确RGB/depth或LiDAR/IMU→SLAM→4D语义图→VLM，但重心是对象持久身份与移动，非当前地点中心目标。此次仅项目／搜索核查，非完整正文审计。
- BSC-Nav：https://www.nature.com/articles/s41467-026-74358-5 ，搜索发现轨迹／认知地图／MLLM的关联方向，尚未全文核实IMU、定位与代码，不纳入已确认完整匹配方法。

## 对新颖性的暂定判断

IMU进入VLM空间推理、长期拓扑重定位、VLM生成认知地图、VLM观测辅助全局定位均分别已有先例。可能值得研究的交集是：以地点为持久状态、VLM综合跨视角证据与惯性运动约束，持续更新地点身份／朝向／连接，并在长期重访时纠错和重新定位。它仍是待核查创新候选，不是已证实空白。仅把VLM和IMU接一起不足以成立。

后续文献优先沿Motion-MLLM（运动进入模型）、CROSS（长期记忆定位）、VLG-Loc（语义定位观测）三条线深入。现阶段不再以3D-Mem物品问答为中心，不启动训练、下载或定位算法替换。

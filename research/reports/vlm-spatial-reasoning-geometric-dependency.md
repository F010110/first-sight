# VLM空间推理是否依赖几何定位：已确认实例

## 结论

存在，不能以“尚未找到”为由宣称VLM+几何／拓扑空间记忆是空白。须区分生成式VLM主导推理、CLIP等视觉语言编码器提供特征、LLM读文本图三个角色，以及几何用于建图还是仅用于执行。需要相机位姿不等于必须使用IMU，也不等于VLM本身输入原始IMU。

## 最明确的实例

### GraphEQA，CoRL2025

正文：https://arxiv.org/html/2412.14480v2
正式论文：https://proceedings.mlr.press/v305/saxena25a.html
代码：https://github.com/SaumyaSaxena/graph_eqa

Fig2、§3.1–3.5明确：RGB-D、语义、相机内外参与位姿进入Hydra和TSDF，构建对象／区域／房间层级metric-semantic图及frontier。VLM读取图、任务相关图片、当前房间／位置和历史，输出答案与Goto_Object_node或Goto_Frontier_node。它是生成式VLM规划／问答与几何空间记忆结合的直接实例，而不是仅用CLIP检索。

几何影响深度融合、节点位置／归属、frontier与对象连接（正文采用2m邻近范围）、当前状态与执行。图依赖几何发生在VLM推理之前，非仅最后导航。实验HM-EQA与OpenEQA，后者主表使用改成多选的协议，不可与本项目开放答案分数直接比较。官方代码需要HM3D语义资产，当前普通GLB不满足原生完整输入，不能直接承诺复现。此次未对全部代码及附录进行pose噪声专项审计；尚未确认其有IMU级鲁棒性实验，不声称完全没有。

### ConceptGraphs，ICRA2024

项目：https://concept-graphs.github.io/
代码：https://github.com/concept-graphs/concept-graphs

方法和README明确输入posed RGB-D；反投影到3D，几何与语义相似度进行多视角对象关联／融合；LVLM（原代码LLaVA）描述对象，LLM整合描述并推断关系，形成3D场景图供查询／规划。几何影响对象身份与边，不只是执行。它符合VLM参与空间建模，但不宜说VLM包办几何建图或所有关系推断。README提供Replica渲染轨迹、对象建图、描述／关系生成完整入口和机器人实现链接，较适合可控建图鲁棒性研究。Qwen API替换LLaVA属于适配版，尚未实施。

### Mobility VLA，2024

正文（本轮细读v1）：https://arxiv.org/html/2407.07775v1

§4.1：COLMAP从tour重建6DoF位姿和稀疏地标，节点为历史帧；依据朝向小于90°和距离2m内建立有向边。§4.2：Gemini1.5Pro读完整tour与多模态问题，选目标帧。§4.3、附录7.1：视觉检索、特征匹配、2D–3D对应和PnP定位当前相机，图上Dijkstra，再用相对位姿计算waypoint。单目尺度对目标选帧不重要，但执行米制动作需要尺度。

这是“强VLM+拓扑图+几何定位”的明确先例，但图由SfM而非VLM建成；几何噪声可破坏边与执行，不一定改变VLM目标选择。核心链路不要求IMU。未找到可确认的完整官方代码，不作为当前复现首选。论文v1叙述与表格成功率有口径差异，本报告不以单一成功率总结。

### GraphPad，2025预印本

正文：https://arxiv.org/html/2506.01174v1

§3明确预录RGB-D和相机位姿；VLM既回答问题又调用API补对象、关系和注释，几何用于反投影／对象关联，房间楼层采用HOV-SG。任务是固定历史EM-EQA，无在线导航，因而说明几何依赖并非只能来自导航需求。未确认官方代码，不纳入复现首选。文中关联公式“超过2”和文字“至少2”存在不一致，不能未经代码核实给出确定关联规则；帧数效率也必须包括构图及后续API开销。

## 相邻但不应混称生成式VLM主导的工作

- HOV-SG（RSS2024）：https://hovsg.github.io/ ；https://github.com/hovsg/HOV-SG 。RGB-D+odometry构造楼层／房间／物体图，CLIP赋语义，LLM分解查询。楼层高度直方图、房间BEV分割、对象／相机归属均依赖几何，但图结构不是生成式VLM推理产生。
- VLMaps（ICRA2023）：https://vlmaps.github.io/ 。视觉语言特征投影到几何地图，LLM调用空间API；是语义特征地图而非现代生成式VLM自主建图。
- Tag Map（CoRL2024）：https://arxiv.org/html/2409.15451 。标签关联到相机位姿与深度统计，以多视锥投票得到3D区域，LLM调用定位和距离API。它说明轻量文本记忆也可能高度依赖几何，但核心是tagger+LLM，非生成式VLM拓扑构建。

## 研究决策

现阶段应先研究已有方法的几何依赖及鲁棒性，而不是从零声称发明该组合。优先ConceptGraphs（对象／关系建图）和GraphEQA（层级图+VLM推理）进行接口与数据可用性审计；Mobility VLA作最贴近拓扑思路的架构先例，不违反未开源方法不复现的约束。

下一步先确定研究的是建图结构、VLM空间答案还是导航执行，三者分开测。固定RGB-D与感知输出，仅变动提供给建图的因果位姿，并将建图pose和执行pose分开干预；有确定几何敏感性后再接IMU→VIO链。需要关注相对漂移、回环前后非刚体不一致、不同步等；统一全局刚体变换不应被当作地图损坏。当前不启动新复现或实验，不认定任何方法已被证明不鲁棒。

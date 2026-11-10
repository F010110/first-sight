# ULVN可用性核验：保持主框架的候选后端提案

日期：2026-11-10。研究核验和未实施提案，不是架构变更。未下载/执行第三方代码或权重，未新增付费实验。

## 一手来源

- ULVN论文：https://arxiv.org/html/2608.06833v2
- 官方项目：https://hren20.github.io/ulvn-website/
- 官方MIT仓库：https://github.com/hren20/ulvn
- RAVEL流程：https://github.com/hren20/ulvn/blob/main/RAVEL/README.md
- BPL/BASS无ROS代码：https://github.com/hren20/ulvn/blob/main/ulvn_core/navigation.py
- BSC-Nav：https://www.nature.com/articles/s41467-026-74358-5
- HM-Nav：https://www.nature.com/articles/s44172-026-00767-5
- MEMORA（不是同名聊天记忆项目）：https://arxiv.org/html/2607.14252v1
- AstraNav-Memory：https://arxiv.org/html/2512.21627v1
- LMEE：https://arxiv.org/html/2601.10744v1 ，https://github.com/wangsen99/LMEE

核验深度：ULVN论文/官方README/RAVEL说明/无ROS定位源码；BSC-Nav正文、HM-Nav摘要；其余检索及摘要级定位，未审计完整实现。URL指向可变main，不冒称已固定复现版本。

## 结论

最小可行借用是MegaLoc专用VPR全局描述子＋检索索引＋SuperPoint/LightGlue局部几何验证，作为当前PlaceMatcher的并行实验后端。不是把完整ULVN强加进空间库，不直接用匹配结果替代Agent的语义区域确认。

现有原图归档、6s独立事实、40s持续Pi空间Session、短期压缩、长期地点/访问/修订事务、来源门禁、问答只读与因果截止均保持。视觉匹配图不等于可通行图，视觉节点不等于语义地点ID，几何成功不等于当前占据同一区域。

## 能借什么、暂缓什么

1. **先测VPR＋局部几何**：比手工全局布局特征＋SIFT更有针对性，但实际效果和本机延迟待测。缓存每个原图hash的全局/局部特征，当前图仅编码一次；返回完整图对ID/方向/匹配点与分布、原始分数、模型及配置版本，分数不是校准概率。
2. **RAVEL图剪枝后测**：最大生成森林和强闭环回插用于视觉图结构。森林只能选择已有边，不会凭空修复完全缺失的跨分量边；也不保证可通行。当前不是靠新增图表就能解决旧ID误归属。
3. **BPL先独立基线**：代码在固定描述子集合/邻接矩阵上维持belief，尚未核实提供可靠在线增节点、首次发现、图修订、缺口重定位与多摄融合方案。预建全813图评过去属于未来信息泄漏；须明确离线参考地图设置或只用截止前历史前缀。
4. **BASS不接**：是导航规划/控制职责，非当前重访记忆任务。

## 论文/代码差异和复现风险

- 论文正文给观测似然exp(-lambda * squared L2)，ulvn_core/navigation.py实际使用exp(-lambda1 * L2)。lambda1由初始化距离分位数和delta计算。
- 论文给w_pred=1-H、w_obs=H；无ROS代码是分段权重，预测约0.3–0.6、观测约0.4–0.7。高概率质量在错误图附近仍可能拖累重新定位，不能称有图就更可靠。
- 论文方法/实现段存在lambda=5/10、闭环回插聚类/1.5tau等描述差异；RAVEL README命令另显式给add_back_threshold=300。实验应固定commit及实际参数，报告差异。
- README存在ULVN数据和ViNT/NoMaD权重URL占位符，不能说完整导航复现资产全部可用；MegaLoc、SuperPoint/LightGlue有官方权重链接/加载路径，候选后端试验不依赖这些导航资产。
- RAVEL依赖Torch/TorchVision、FAISS、Kornia、OpenCV等；无ROSBPL只需NumPy，但描述子和图仍需前端产生。GPU和Windows安装/速度未核验。MIT代码许可证不自动覆盖第三方权重/数据许可。
- 论文71.04%/76.56%是图边precision/recall，95.49%是固定地图节点定位指标，不是本项目重访事件指标，禁止直接横比。

## 有限实验建议（尚未执行）

先不继续小样本提示词调优，也不直接全813付费。

A：冻结的当前视觉候选后端。
B：MegaLoc检索（消融）。
C：MegaLoc＋SuperPoint/LightGlue验证。

先在相同历史图覆盖、相同因果前缀和相同图预算下比较，不能给新方法全历史而给旧方法采样尾图。冻结模型与随机种子/阈值；开发组与后续未参与调参片段分开。参考标签只供评测，不进检索或校准阈值。近时连续图、自匹配和不同摄像方向须单列，不把相邻帧复制当远距重访成功。

指标分三层：
- 检索：真实历史图对Recall@K、误候选/漏候选、跨视角/门内外分组、候选多样性；这是候选能力，不是地点精确率。
- 几何：图对验证precision/recall、不同位置共同可见表面的失败、前端总耗时/显存/缓存/冷启动。
- 系统：固定Agent/提示词/预算的重访事件precision与每次真实返回recall、错误复用/新建、补证轮数、原图数、完整处理延迟与费用。合法事务不等于语义成功。

预先定有限预算和非劣标准、误差区间及失败保留规则，不再以3/3或9/9为追求终点。只有前端改善后才做有限下游Agent验证。BPL另列预建地图/在线前缀两种设置，不能混报。

## 其他方法定位

- BSC-Nav正文明确RGB-D＋agent poses，landmark/route/survey值得参考，但不是当前无位姿RGB重访后端的直接替代。
- HM-Nav有多视图融合、动态语义空间图和失败经验利用，当前可作后续研究线索；未核实完整代码、传感器和在线修订实现。
- MEMORA是具身经历的类型化语义/程序记忆，不应简化成通用物体状态跟踪器。
- AstraNav-Memory的视觉token压缩需要其视觉编码器/模型训练与接口，不可直接塞入当前托管Flash API；不因此删除长期原图。
- LMEE聚焦多目标探索、episodic memory和记忆问答训练/benchmark，可参考评测任务，非现成重访matcher。

附：引用文本中的旧吞吐结论已过时。本项目冻结813实时轮已813全覆盖、0跳过、0投递违规；这只证明该轮运行节拍和覆盖，不认证空间语义。

# 建议6核查与后续路线（2026-10-09）

## 结论

继续 Experience Graph，不重新把“一房间一节点”变成在线建图前提。建议6前半段的可修订观测关联符合现有需求；后半段假定房间级节点是目标，与建议5及当前已批准方向不同，应作为未来可选 Region 层，而非默认替换 VisualNode。

核心不是立即寻找更复杂的聚类算法，而是把观测历史与可撤销的身份假设分开。TemporalTransition、visual correspondence、boundary-crossing evidence 和 traversability 是不同类型的关系，不能混用。

## 文献核查

1. **e-TM — Vision-Based Topological Mapping and Navigation With Self-Organizing Neural Networks**，Hu 等，2021 年在线发表，后续正式卷期为 2022。核查作者机构库摘要，未取得全文。它明确把探索轨迹保存为 episodic memory，再用 playback/consolidation 把事件及关系转入 spatial memory；Fusion ART 泛化多个输入以压缩地图。可借鉴“经历原件 + 可重算空间解释”。摘要不足以确认可撤销合并、历史拆分或无可靠位移下的身份修复，不能宣称已解决这些问题。
   - https://ink.library.smu.edu.sg/sis_research/6049
   - DOI: 10.1109/TNNLS.2021.3084212

2. **DGNav — Dynamic Topology Awareness: Breaking the Granularity Rigidity in Vision-Language Navigation**，2026。已读全文方法部分 III-A/B：输入 RGB-D panorama，深度预测导航候选点，使用欧氏距离阈值合并节点；阈值按候选角度离散度调整，推理范围为 0.25–0.5m。它调整的是导航路标采样密度和注意力权重，不是历史视觉身份的合并/拆分。借鉴不确定性驱动的资源分配，不能直接移植其几何规则。
   - https://arxiv.org/html/2601.21751v1

3. **Topology-Based Visual Active Room Segmentation**，Bao 等，ICRA 2025。已读七页全文：RGB-D、里程计、SLAM 占据栅格；先从栅格射线生成门候选，再用 RGB 检测及深度投影精化；房间探索覆盖集合用于 loop/escape 检查及合并。结论明确承认拓扑表示是静态的、依赖门检测、不适用于缺少几何边界的功能区。借鉴“检测连接结构后，还需验证穿越/所在侧”，不能当纯 RGB 无定位方案。
   - https://freeformrobotics.org/wp-content/uploads/2025/04/ICRA2025_Segmentation.pdf

4. **Prior-SG**，2026。已读全文 V-A/B：RGB-D 输入，Hydra 自由空间图，节点有 3D centroid，检测对象投影到 3D，MRF/graph cuts 推断任务条件的区域语义。它的 MAP 在已有物理图上分区域，不是从纯 RGB 自动恢复可靠身份。可借鉴“事实图与任务解释分离”和显式概率因子，但不采用其 3D backbone 或让语言先验决定物理连接。
   - https://arxiv.org/html/2608.06170v1

5. **Lifelong Topological Visual Navigation**，Wiyatno 等，2022。核查作者详细方法说明：RGB-D 对预测可达性及相对 waypoint，真实场景微调使用里程计；执行成功/失败更新边连接概率，必要时从保存轨迹添加节点。可借鉴可撤销边和按需补图，不等于完全无几何的房间身份纠错。
   - https://montrealrobotics.github.io/ltvn/blog.html
   - https://arxiv.org/abs/2110.08488

6. **RoboHop**，ICRA 2024。核查作者方法页：节点是图像 segments，边来自跨图像 segment association 与单图像内邻接；支持 CLIP/语言查询和上下文辅助检索，不要求全局 3D 图。它很适合 First Sight 的物体/经历检索：保留对象裁剪及跨帧轨迹，不必先给整张图定房间身份。不能把 segment persistence 直接等同于物理地点或安全通路。
   - https://oravus.github.io/RoboHop/
   - https://arxiv.org/abs/2405.05792

7. **Open Scene Graphs for Open-World Object-Goal Navigation**，2025 扩展版。已读全文系统与表示部分：明确仅要求 RGB 而非 ground-truth localization，使用对象、Place、Connector、可选高层 Region 构成 schema；高层依赖 VQA/LLM 的状态估计与更新，低层用 ViNT 控制器。它表明 RGB-only topo-semantic 系统有实际研究基础，但不能用其成功率证明我们的 VLM 能维护可靠身份。借鉴对象/连接结构的类型分离及语义层模块化。
   - https://arxiv.org/html/2508.04678v1

8. **Switchable Constraints for Robust Pose Graph SLAM**，2012，以及 **Modeling Perceptual Aliasing in SLAM via Discrete-Continuous Graphical Models**，2019。前者让错误回环约束可被后端关闭；后者强调感知混淆可以产生一整组互相一致的错误回环。两者仍是几何 SLAM，不能直接拿掉几何因子后声称原保证继续成立；但“身份关联也是变量”和“连续一致不保证正确”直接适用于我们的修复设计。
   - https://nikosuenderhauf.github.io/projects/switchableConstraints
   - https://arxiv.org/abs/1810.11692

## 现有实验对应的修复优先级

### P0：让身份关联真正可修订

- 原始 observation、访问顺序、图像/视频引用不可被身份编辑删改；派生视觉节点、节点间边可重新生成。
- correspondence 增加 proposed/supported/rejected 状态、原始匹配证据、竞争身份、版本和原因，而不是一次 argmax 直接变成事实。
- 节点建立/代表图更新后，重查相关 pending 历史，解决 W18/W28 漏回填。
- 多代表图与历史片段共同验证新成员，检测 visual-1/2 的相似度链漂移。缺少匹配是 unknown，不是 cannot-link；不能用低相似度自动拆分。
- 只有正面的不相容证据或更好的、独立支持的身份解释才撤销关联/拆分；保存别名和全部路径经历。
- 首次经历也可形成 provisional 视觉轨迹，不应必须等再次访问才被图覆盖。待定轨迹仍可检索，不能为降低 pending 比率强行建正式身份。

### P1：替换脆弱的整图关联与验证数据

- VPR 特征只做高召回候选：比较 DINOv2/AnyLoc/SALAD 等，而非宣称更强 descriptor 自动等于区域身份。
- 各方向证据独立保留；doorway 同时看见不同空间时不能简单平均为一个区域描述。
- 用前后短序列、对象/segment tracks 和可选局部几何核验回访。不恢复或信任全局 XYZ。
- 当前仿真三视图是同一光心的 yaw 渲染，没有立体基线；不能把它当作能三角测量的三相机硬件。
- 运动描述继续默认关闭；如果未来旋转/平移分类经过单独验证，可作为证据重启，不把缺测视为静止。

### P2：单独验证边界事件，Region 保持可选

- 检测到门/开口只产生 connector candidate；真正的 crossing 需要跨帧的门框遮挡、所属侧与持续场景结构变化等证据。
- 先评价 crossing 的 precision/recall、站门口不穿越及原地转向的误报，再考虑上层区域关联。
- “没有边界证据”不意味着同一房间，尤其有遮挡/丢帧时，应保持未定。
- Region 作为 observation/VisualNode 上的独立标签/聚合，可根据任务修订，不能污染底层节点或删除房间内部经历。

## 不直接采用建议6的四项损失

仅写 visual + temporal + topology + |V| 不构成可用算法：|V| 惩罚可能把全图压成一个节点，连续性惩罚可能抹掉真实边界，不同历史上下文也可能只是同节点的不同路线。需要定义独立观测似然、开放集 unknown、正面矛盾证据和身份编辑代价，在独立验证集上标定。

## 下一轮实验

1. 在现有图上注入漏关联、重复身份、错误合并及单个错误回环，评价后续证据能否修复而不丢原始记录。
2. 采集新录制：分叉、多条往返路线、外观相似的不同房间、门口停留不穿越、原地旋转、遮挡与缺帧。复现完全相同端点的录制不能充当真实泛化。
3. 指标：false correspondence、duplicate identity、pending coverage、错误修复率/延迟、正确关联被误撤销率、历史物体检索 precision/recall、路径经历保存完整性。暂不以房间纯度、节点越少越好或社区数评价主线。

本文件是研究与实现建议，未据此修改在线算法。文献核查尚不足以断言“无可靠位移的可逆身份重组织”具有研究新颖性，需要继续查新及对照实验。

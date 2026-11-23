# 弱锚点恢复＋原帧密集证据：独立算法试验

不改HSSD灯光、分辨率、相机、路线或原图。此前THOR/ProcTHOR与本批Habitat/HSSD确为不同模拟器/资产；渲染问题留到后续分离对照，不混入当前修复。

## 改动

- `proposeCoherentContextChanges`增加`recover-weak-anchors`：仅当段首两点弱时，寻找当前prefix中最早的正支持相邻pair；必须与新cohort不重叠。强原锚点、0.4/0.1阈值、四次明确跨比较、gap隔离不变；未来帧和缺失比较不能授权切组。
- 新鲜`VisualExperienceMemory.observe()`记录新策略，持久化/重启可重现。旧interpretation未记录策略时按`legacy-first-pair`加载；旧bundle继续追加仍继承旧策略，不静默改变旧历史。Place/Space/Request代理不改。
- `sim/dense_context_evidence.py`使用原native三视图，双向全部query方向的SIFT证据，不再仅拿每2秒观察点。对HSSD原2fps、THOR原每tick图像生成因果上下文候选；不是物理门口检测，不赋予导航身份。缺失/低纹理仅弃权。
- native候选映射到原观察点，仅在确认帧已到达时可用；一个观察点最多一个切分。原观察数量/时间戳/查询分母不变，所有原图片保存，不重采、不伪造平滑帧。

## 回归顺序与门槛

`npm.cmd run test:visual-pipeline`实际62/62通过，新增弱启动恢复、不重叠、prefix不偷看未来、missing/gap禁止切分测试。还必须做真实数据重跑，不能以单测替代。

Python离线78/78通过，包括新增native证据弱起点恢复、确认因果顺序、缺比较/强重叠/低纹理/gap不授权切分测试。

`python sim/run_anchor_recovery_trial.py`已启动，结果独立`run/anchor-recovery-v1/`：**先home-val4、home-val5，再五个现有HSSD有效采集**。模型仍qwen3.8-flash，test.5原主体＋附注prompt/最多2修复不变。所有原测试输入/预测不覆盖，原六例分母保留，第六例输入失败不悄悄补成通过。

旧家居回归在推理之后才读取固定评分合同：val4用用户确认的开放生活区44查询、val5用原28核心查询；要求至少保留44/44、28/28，若下降，不宣称回归通过、不选有利重跑覆盖。原标签仍属发展集，边界/附注/未知/耗时另看，不把核心全对当所有指标通过。

需要纠正简化归因：旧THOR val5首对也只有0.167<0.4，不是“旧家庭开头两帧都很好”。它有17强pair及24 supported历史锚点，另一路锚点变化产生了23局部组；首三个HSSD历史supported均0（强pair分别0/1/7），替代路径未起作用。新修复应在弱历史证据时恢复后续上下文，而不能损伤旧家庭这条有效路径。

当前仅实现并启动验证，不宣称HSSD已正确归组；更多组不自动代表准确，仍需要确认连续开放空间与真实独立房间的边界。原帧虽比2秒观察点更密，但最密仅2fps，不等于算法已经消费24fps视频。

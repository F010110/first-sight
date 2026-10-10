# 地点分组文献定向检索（2026-10-09）

## 不再采用的主线

整图/三视图匹配分数 + 阈值聚类只能作为对照，不再当作活动区域分组方案。换成 DINO/CLIP 后仍只聚类图片，也不满足需求。相似度可用于底层对应候选，不能独自授权地点同一性、地点分离或导航连接。本次只做文献核查，未宣称新算法已经实现。

## 1. COVISMAP：Probabilistic Place Recognition with Covisibility Maps

Stumm、Mei、Lacroix，IROS 2013，4158–4163；DOI 10.1109/IROS.2013.6696952。已下载读六页原文。

- III-A：把跨帧跟踪的地标作为节点，观测作为共视 clique，保存 landmark×observation 稀疏矩阵；不是保存图片之间一个相似分数。
- III-B：从共享地标扩展局部 cliques，动态形成可重叠的 virtual locations。一个地点模型可以包含多张图，地标未必曾在某张单图里全部共同出现。
- IV：显式存在变量与传感器 false positive/negative，Bayesian 生成模型。对每个地点作 Li vs not-Li 判断，避免重复地点表征瓜分归一化概率。
- IV-C：先验不使用运动预测，意在兼容不可预测移动。该识别模型不要求全局 XYZ；但依赖正确地标跟踪、视觉词典和传感器模型标定。
- 适用：比整图节点更符合旋转/多视角地方表征，是可复用的地点模型路线。
- 限制：作者明确称 appearance-based recognition；地标仍用 SIFT/SURF/BoW，不是语义活动区域分割，也不保证无纹理无重叠观察能关联。不能直接当完整产品答案。

原文：https://vigir.missouri.edu/~gdesouza/Research/Conference_CDs/IEEE_IROS_2013/media/files/1959.pdf

## 2. 360ST-Mapping：共视 + 语义 + 局部重绑定

Liu、Huang、Yeung、Liu，IROS 2022。已读八页原文。

- III-B/C/D：跟踪共享 map landmarks，计算共视 IoU；YOLOv4 对象类别/数量形成 80 维观测，weighted Hamming 给出语义差异；Pchange=(1-RCo+POb)/2，阈值 0.5。
- III-F：局部强共视 keyframes 的标签投票修正过分割，少帧/近邻节点合并，回环后迁移关联。不是一次 pairwise 图片聚类。
- 直接对应原地转向问题：完整 360 度输入保持观察范围稳定，再用语义协助避免几何/共视退化。
- 隐含前提不能删掉：III-A 参考帧选择要求平移距离 >1；全局 culling 使用距离；系统依赖 OpenVSLAM 的地标、pose 和 loop closure。
- Table I：完整系统实验室 precision 59.4%，recall 94.4%；教学楼 precision 62.3%，recall 82.2%。实验室去掉对象检测，节点数从 28.8 增至 54（真值 18）。说明语义明显有用，也说明绝不是已经完美解决的算法。
- 不直接采用：我们没有完整 360 全景或可靠平移，三张同光心视图不能无条件等同 360；类别存在差异仍受遮挡影响，也不能证明对象实例身份。

原文：https://saikit.org/static/projects/360STMapping_Huajian/360Mapping.pdf
作者页：https://huajianup.github.io/research/360Mapping/

## 3. RoboHop：最接近 RGB-only、无全局几何的结构证据底座

Garg 等，ICRA 2024，4090–4097。已读原文 HTML III、IV、V。

- III-A：SAM masks，DINO/DINOv2 mask 内 patch features 聚合，CLIP 排除 wall/floor/ceiling 等 stuff。
- 跨图像边：时间跨度 1–3 的 segment 最近邻 + dot-product 阈值；同图像边：mask centroid 的 Delaunay triangulation。
- 邻域信息：两层简化 graph convolution 聚合；不是仅用独立对象外观。不同可见对象可以通过持续 tracks 及同帧邻域接续。
- IV-B 明确有 PanoContext-Living 的 **pure rotation** 实验：把一个全景切成多个视图，首尾显式关联，展示从窗到沙发等对象关系路径。这正面回应我们在原地旋转时不应把每个视图当不同地点的需求，但只是定性计划实验，不是大规模地点组 F1。
- V 限制：重复对象会错配，不能处理环境动态变化；Table I 的 DINO instance top-1 只有 56.43%，不可把 segment 最近邻当已确认实体。
- 关键不照搬项：原文在整幅图无对应时仍强制保留最高分一条边以使图连通；First Sight 必须拒绝这一规则，保持 unknown-gap，不伪造身份/通路。
- 不等于房间分组：RoboHop 输出 segment graph，不输出经过验证的活动区域 partition。只能先用它构建底座，再验证更高层分区。

原文：https://arxiv.org/html/2405.05792v1
代码：https://github.com/oravus/object-rel-nav

## 4. Clio：真正给出区域粒度优化算法

Maggio 等，RA-L 2024，9(10)，8921–8928。已读原文 III、IV、V。

- IV：Agglomerative Information Bottleneck (AIB)，不是图片相似阈值。仅允许图上相邻 primitives 合并，代价为 (p_i+p_j) D_JS[p(task|cluster_i),p(task|cluster_j)]；选择任务信息损失小的合并，达到信息损失预算则停止。
- V-B：**明确把 Place graph 的地点节点聚成 Regions**，可以是 Kitchenette、Workspace 等。这是此前检索中缺少的直接“合理粒度”算法。
- 同时不能隐瞒：V-A 输入 RGB-D 与 pose，Hydra 提供几何可达的 place graph；对象关联还要求 3D IoU。语义来自 CLIP，不需让 LLM 判定身份，但没有免掉几何。
- 我们可借鉴的是上层 AIB 的目标/求解方式；若用对象共视图替换 Hydra graph，是新适配，不是原论文算法已验证的等价实现。图邻接仍需真实证据，不能拿时间边直接顶替。
- 产品约束：任务层压缩不可删除原始经历，不可以忽略任务之外的重要风险对象；物理范围与任务区域标签须分开。

原文：https://arxiv.org/html/2404.13696v1
代码：https://github.com/MIT-SPARK/Clio

## 5. LEXI-SG：RGB-only 不等于 geometry-free

2026-05 预印本，已读 III-C/E/F、IV-D。RGB 流先检测 doorway/corridor 等过渡线索，以 hysteresis 累积确认；随后 MapAnything 产生每房间深度/pose，Sim(3) 全局对齐。SAM2 masks 跨帧传播产生轨迹。

可借鉴语义过渡事件的延迟确认、2D mask tracklets，不能移植其全局几何主线。论文描述把 DINO features 与 text encodings 比较但未明确跨模态对齐组件，不能自行假设普通 DINO 可直接和 CLIP 文本余弦匹配。其 room segmentation precision/recall 有明显 trade-off，开放布局是作者承认的限制。

原文：https://arxiv.org/html/2605.13741v1

## 决策

已有相关算法，不应再把纯相似度聚类当主线；也没有检索到可证实完全满足“纯 RGB、无可信位移、任意视角、可撤销历史修正、自动活动区域分组”的现成成熟单一算法。

优先次序：
1. 复用 RoboHop 的 segment/邻域构图机制，结合已有视频跟踪技术（SAM2 等）形成带具体帧/掩码证据的实例 tracklets；不采用强制连通规则。
2. 用 COVISMAP 的多观测共视地点模型组织视角，保留 overlapping/unknown，而不是先把每一张图硬分进互斥地点。
3. 语义边界事件单独记录；“看见门”不等于穿过门，“未检测到边界”不等于同区域。局部旋转证据、重复路线和对象邻域共同核验。
4. 构图证据可靠之后，对照 Clio AIB 做任务/功能层粒度聚合，不把任务区域直接宣称物理房间。先要求原地转向不误分、小范围设施观察能合、相似不同房间不误合，再评价压缩率。

这些是适配方案，尚未跑通；不能用新模块名字替代实际 mask/track/边界输出。现有静态端点三视图和插值演示视频不足以假装连续视频跟踪成功；缺少中间真实观察时必须补录。

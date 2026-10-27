# HM3D minival现有资产子集评测

用户决定：仅使用已提供的 hm3d-minival-glb-v0.2.tar，在这些数据上完成完整方法与对照，不等待全量数据。

## 冻结范围

10个GLB已安全解压到data/hm3d-minival-glb-v0.2；按场景ID与官方A-EQA184题集合做交集，保留全部26题、7场景，不按分数筛题。题目与答案不改写。问题清单位于data/hm3d-minival-eqa-subset/questions.json；资产及源问题SHA256见reports/hm3d-minival-subset-manifest.json。

命名：**3D-Mem / Qwen API / HM3D minival 26题 / raw GLB＋重建navmesh适配**。不是官方完整split成绩；不将该包当作整个HM3D授权或云端处理许可的证明。首次验证只本地运行。

## 必须验证的适配

- 不重命名raw GLB为basis；明确mesh路径、up/front与位姿变换，先检查官方题目起点及实际渲染。
- 用记录了agent高度／半径的配置重建navmesh，不与官方网格混称。起点不在网格时保留失败，不静默snap后计入同一协议；如必须修正，另列适配和评测分母。
- 无semantic mesh／实例标签：ScanNet200视觉类别仍可用；检查A-EQA流程是否消费语义或object_id，不能伪造标签。实例级关联GT指标不可凭空生成。
- 完整保留对象融合、特征更新、地图去噪／合并、快照组织、检索和问答，不再用简化关联脚本代替完整方法。
- 先完成一个场景完整基准，再跑全部26题；基准与物理传感器误差组使用同一模型和预算。小噪声单因素与组合、多seed，GT定位上界另列。
- 固定观察重放与闭环探索分开报告；官方评分机制适配qwen模型时记录评分者及变化，避免将模型自评当客观真值。
- 保存全26题逐题结果、失败／超时、原始回答及证据，不只展示有变化的问题。无结果题是否计0按协议预先固定。

## 当前执行

已开始7场景本地RGB-D、重建导航网格与26个原始起点的诊断。脚本scripts/validate_hm3d_subset.py；输出reports/hm3d-minival-local-validation.json。尚未跑完整3D-Mem或调用API作答。

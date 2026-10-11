# 片段与方向实验进展（2026-10-11）

本轮为独立实验模块，不替换生产记忆。所有修订保留原观察；时间边不授权导航。

## 结果与范围

- 扩采Oracle：六录制各13片段、9次历史返回。val3两录制各恢复6次，val4/5各恢复7次；当前上层范围审查没有错绑。录制相关、标签AI审核、边界由房间多边形提示后审七帧窗口；未完成全部核心/子区域语义标签，不能称整体准确率。
- 正几何补充：保留原关联，不合并既有不同组。val4核心覆盖17/44→20/44，严重跨区域错绑仍存在；同公式小基准宏分75.8不能掩盖这一失败。
- 外观切换基线：val4-probe8 42提案匹配12真值候选，30假阳性，F1=.444。缓冲区外额外容差3秒，时间为人工1秒/tick，非真实穿越/延迟验收。
- 方向：相机俯仰未纳入首轮模型时全部拒答；修正轴系后理想/噪声/缺失输入各21/8/14个局部支持。大角度跳帧没有重叠，不能靠偏航补出视觉证据。
- 真实15°子动作记录747帧：600转动步中529步支持，138转动事件96个全程支持。146纯移动步没有支持，但算法主动排除了无转动；不能据此证明能辨别同时转动和移动。

## 可复现入口

- `npm.cmd run test:memory`
- `python sim/test_benchmark_capture.py`
- `sim/build_review_kit.py`：生成原图hash、必要同足迹候选及完整时间序列浏览页。
- `sim/extract_segment_evidence.py` + `src/sim/expanded-oracle-eval.ts`：固定稀疏锚点及Oracle片段历史提案。
- `sim/export_heading_experiment.py` + `sim/heading_track_evidence.py`：仿真方向消融；不导出位置/房间到算法。

原始数值在 `run/sim/place-evaluation-review-v1/`、`run/sim/place-angle-val4-v1/`、`run/sim/place-angle-val4-smallsteps-v1/`。待办以根目录 `TODO.md` 为准。真实手机方向可靠性、轴系校准、全链路对照及真实数据仍待验证。

# 学校2秒观察 → 本地门控 → 旧地点召回 → VLM分类：实跑

## 固定输入和运行模式

沿用`run/tartanground-school-fixed2s-v1`全部90组三摄：177.5秒、约210米。原图全部保留。不是19组或8组子集，不是8小时，不重新渲染。

家庭试验参考`sim/home_window_vlm_trial.py`，继承“因果短窗口、逐观察判定、窗口可跨地点、有限历史原图、末尾显式flush”。其visual-capped分支依赖已有分组快照，不直接当本地门控。此次门控与模型判断独立。

`sim/prepare_spatial_gate.py`：RGB布局/直方图与上次选中关键帧比较，距离>=0.008选中；首帧选中；30秒heartbeat兜底。没有读取位姿、标签或模型分组；前向因果处理。最多4组/窗口，最早观察等待10秒封窗，末尾flush。不使用IMU积分位移，也不把低视觉变化说成精确静止。

门控是新粗视觉基线，不含完整曝光/模糊/遮挡质量判断和转头补视角策略；阈值未在独立验证集调优。输入中短时跳过不代表场景无变化，门控事件召回率尚未标注。保留原始未选图片供复核，禁止把跳过观察继承上次身份后算已分类。

门控计划`run/tartanground-school-gated2s-v1`：选中62组，跳过28组，17窗口；对照无门控固定4组合批约23窗口。只能比较计划窗口数，未付费跑全量90组对照，不能称效果不降。14个相互重叠的几何代理重访对中9对两端均被选中；其余不能凭此单独判定丢失地点。

v2每窗口调用历史RGB sidecar，严格早于当前窗口；最多1近期+2视觉候选、3历史原观察，VLM逐个当前观察输出身份/new/unknown，SQLite原子入库。离线串行因果回放，不是busy-aware实时8分钟吞吐测试；源时间与实耗时分开。

## 首轮失败（保留）

`run/tartanground-school-gated-real-v1`：第一窗3观察成功；第二窗4观察时，模型额外给历史参考帧80输出assignment，修复一次后仍额外输出。严格校验拒绝，第二窗4观察pending，不误写进数据库。共3次请求，输入17434/输出1651token。这个费用不能从实验总量隐藏。

## 独立v2协议修正

新`src/agent/spatial-v2-vlm.ts`，不改冻结v1：明确CURRENT_TARGET白名单和精确数量、REFERENCE_ONLY禁止分类；历史标签不再携带容易被当作目标的observationId；末尾再次列出当前ID；协议修复包含实际收到的ID集合，仍最多一次。不能通过过滤多余输出掩盖错误。

mock回归验证：首次输出历史assignment被拒绝，第二次合法才返回；连续两次非法必须抛错。门控测试覆盖静态跳过、heartbeat、突变、路径可读和结果目录禁止覆盖。空间记忆/冻结回归另行运行。

重跑新目录`run/tartanground-school-gated-real-v2`，同样固定计划，最多17窗/62观察/34 provider请求（含修复）；配置boundedSampleRun是用户授权的小样本运行，不是金额硬上限或扩大tokenCalibrationOnly限制。没有确认端点价格，费用只报token，不套20元假设。

## 结果审计

完成后执行：
```text
python sim/evaluate_gated_spatial_run.py run/tartanground-school-fixed2s-v1 run/tartanground-school-gated2s-v1 run/tartanground-school-gated-real-v2 NEW-report.json
```
报告含全部90组门控决策、62组选中观察的实际assignment、未分类跳过帧、pending、地点摘要、几何代理对、成功与失败两轮usage。模型摘要只是预测不是独立房间GT，不能据此报房间准确率。要复核相似区域误合并、室内外切换、球场重访及走廊分段；几何距离不是物理房间边界。

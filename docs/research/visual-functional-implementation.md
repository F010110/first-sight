# 功能初版接入、验证与剩余验收

## 清单与实际范围

以 `docs/research/visual-memory-functional-checklist.md` 的F01–F13为软件清单；V01–V04为实际可靠性验收。此次补齐可执行的初版接口与数据链路，不声称已解决所有算法错误，也不替换生产记忆/RequestAgent。

新接口包含原记忆能力、纯三方向VO、自动几何开口/弱开放区轨迹、原生帧切换处理、连续时间片段、共享边界锚点、历史候选、在线追加、手工确认/新区域/撤回、独立区域/子区域修订和原子保存。物体检索仍返回有时间和来源的原观察，历史对象不当当前在场。

开口模型是古典线框候选，不是可靠语义门检测器；窗/家具可能混淆。开放区模型是空间边缘及外观变化，不是已识别功能区域。它们已不再是“没有自动证据生产器”，但质量仍未验收。没有使用模拟坐标、动作或roomId做推断。

## 重跑

```powershell
npm.cmd run build
python sim/run_visual_memory_pipeline.py run/sim/region-val4-multiview run/sim/NEW-result-directory
node dist/sim/visual-complete-evaluation.js run/sim/region-val4-multiview run/sim/NEW-result-directory docs/experiments/region-val4-multiview-oracle-boundaries-v1.json docs/experiments/NEW-score.json
npm.cmd run test:visual-pipeline
```

输出目录必须新建。`--calibration <json>` 支持frames/left/right各自fx/fy/cx/cy/width/height，输入应为已矫正针孔图像；不传时明确采用仿真方形90°内参，不能用于宣称手机可靠性。没有旧地点包/缓存时，程序在新输出目录提取视觉证据并生成基线，不修改录制目录。跨区域不默认需要门，开放区弱候选独立输出。

当前时间轴为仿真1000ms/tick；真实设备时间同步、畸变处理/标定仍需验收。图像重模块在外部Python进程运行，原生产RequestAgent未改；CLI批处理耗时不是手机在线响应时间。

## 实际结果

当前运行目录：`run/sim/visual-functional-v2-val4/`、`run/sim/visual-functional-v2-val5/`。当前分数报告：`docs/experiments/visual-functional-val4-v4.json`、`visual-functional-val5-v4.json`。

本轮29个代码、输入与报告hash冻结于 `docs/experiments/visual-functional-run-manifest-v1.json`，原图hash通过其中引用的数据manifest保存。旧版本结果保留，不覆盖失败历史。

|维度|val4|val5|
|---|---:|---:|
|直行移动发现|137/146 = 93.8%|44/97 = 45.4%|
|转动误报移动|0/24，全部未知|0/23，全部未知|
|新增自动确认切换|0/6|0/5|
|新增边界F1|0|0|
|原视觉身份关联观察|22/57 = 38.6%|30/40 = 75.0%|
|原必要同位置恢复|0/2|15/19|
|原查找代理|0/2|8/8|
|原小基准严重跨区域错误|2|0|
|Oracle同匹配器历史支持提案|0|2|
|实际静止误报/已验证物理区域覆盖|未测|未测|

原baseline bundle完全保持一致，不把原分数当新增提升。自动模型各产生1条接近候选，没有完整穿越确认链；没有通过区域识别验收。已审查先前自动候选的原图序列，不能靠机械图像分数证明它们为真实跨越。

在线评测由空记忆逐观察重建，仅使用已到达端点证据；不是直接读取最终节点状态假冒在线。报告包含前缀关系变化、缓存更新时间及VO/边界提取耗时。实际样本没有对象标注，实际对象查询分数为null；有标注的接口在测试中验证，不以组内查找代理冒充真实对象检索。

冷启动验证：`run/sim/visual-cold-start-smoke-v1/` 只有13帧三方向图与4个endTick，不含动作/坐标/roomId/旧包/缓存；`visual-cold-start-result-v2/` 保存生成的视觉证据与记忆。

## 尚未通过

可靠门框/开放区域穿越、真实静止与动态负例、手机标定与时序、盲标、实际修复时延、新环境验证。全链路能执行不等于算法已经可用；目前应继续保持候选、人工纠正及原版本回退保护。

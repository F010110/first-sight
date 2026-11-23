# 后续证据回溯修复试验

修复前算法已冻结提交`ab0b41a`（本地，未推送）。本轮修复模块独立实验，不替换默认归类、不修改原图/观察/原归属日志。

## 无标签修复过程

`retrospective-group-repair.ts`在每个实际前缀检查：后形成的目标组有正向视觉重合的入口队列；向前最多8个观察寻找前一组的连续尾部。至少两张尾部图片本身相互匹配，并且都与目标入口/后续锚点匹配，支持比原组两锚点至少强0.2，才提出迁移。视觉支持使用已有双向多方向SIFT/RANSAC缓存，阈值0.4沿用当前协议；不是把单图全局相似度当区域真值。

目标不仅检查入口两个视图，还检查目标组末尾两个视图，避免透门看到公共表面就误修。缺比较、源/目标队列不稳定、旧组仍强支持、候选不连续则拒答。纯函数应用提案，原分组保留，重复/过期提案失败不改原状态。提案确认时间为**实际可用前缀时刻**，旧锚点时间另列，避免把晚得到的信息假装早已知道。

`retrospective-repair-trial.ts`仅接收原prefix输出与缓存视觉证据，逐前缀过滤端点，不能读未来。`score_retrospective_repairs.py`另读人工标签评估，标签不反馈到修复模块。

## 真实成功案例

val4第53、54个观察（159/162 tick）被延续到第47观察开始的旧组，人工标签为kitchen-dining，旧组其他已审内容为living-sofa。后续第55、56观察形成更一致上下文，模块在168 tick确认迁移53/54到第55观察开始的组。原前视图0159/0168与旧组0141已查看，并与已有逐图审查标签核对；仍是AI开发审查，不是独立真人盲审。

一次正确修复事件，涉及两张图；从错误归类到修复分别9/6个模拟秒（1000ms/tick），不是手机真实时延。此事件消除8个跨区域错合并对，没有引入新的已审错合并对。

|val4最终分组|修复前|修复后v2|
|---|---:|---:|
|混合组|2|1|
|跨区域错合并对|13/703，1.85%|5/703，0.71%|
|同区域聚合率|24.7%|26.3%|
|未归类率|0%|0%|

首次归类输出保持不变；旧组识别17/40、新组建立1/4不因事后修复被改成好分数。仍有一个混合组，所以正式结果仍不符合。

## 保留的失败与适用范围

v1只看目标入口队列，会把living的第7/8观察迁移进第9观察开始、含bedroom的组。v1一正确、一错误，最终错合并13→15，不合格。v2检查目标入口和尾部后挡住该误修，仅留下上述正确事件。此修改使用val4开发诊断；不能外推到留出集。

val5逐前缀执行v2，没有提出修复；缺全量区域标签，不能宣称val5修复质量通过。

现在只支持相邻上下文的连续尾部迁移，不支持任意散落图像、任意拆合或无证据的全局优化。每个前缀重新计算提案，证据/组状态变化可导致撤回；它是候选修订，不是不可撤销的自动绑定。还需独立错误样本与误修负例，不能用1/1案例报告可靠精度。

## 重跑与产物

```powershell
npm.cmd run test:retrospective-repair
node dist/sim/retrospective-repair-trial.js run/sim/region-val4-multiview run/sim/temporal-current-val4-v3.json run/sim/NEW-repair.json
python sim/score_retrospective_repairs.py run/sim/temporal-current-val4-v3.json run/sim/NEW-repair.json docs/experiments/region-val4-core-labels-v1.json docs/experiments/NEW-review.json
```

主报告：`docs/experiments/retrospective-repair-review-val4-v2.json`、`retrospective-repair-val4-formal-v2.json`。v1失败报告保留。单测覆盖可修尾部、缺证据/竞争拒答、未来数据、原子失败、后续目标矛盾，4项通过。

# VLM全局自动聚合实跑v1（2026-10-12）

按用户要求，不使用之前视觉组亲和度/阈值/层次合并规则。输入可选回溯修复v2的全部18个局部组；每组按first/middle/last最多选3观察，共36个三视图，组成18张960px宽拼图。单次Qwen API请求让模型独立给全局区域划分，允许未知和单组区域，不能拆原组。

输入没有区域标签、真实区域数、评分、模拟坐标/动作或视觉匹配分数；提示词要求辨别具体实例、观察者范围及组内污染，而不只是房间类型。请求`qwen3-vl-plus`，返回同名，temperature=0，一次调用约44.8秒；无自动重试，不挑多次最佳回答。返回JSON检查全组恰好一次分配、证据引用属于输入；引用有效不代表解释事实真实。

## 真实结果

|固定44查询|原18组|VLM全局聚合|
|---|---:|---:|
|正确|27/44，61.4%|28/44，63.6%|
|重复建组失败|11|0|
|混组查询失败|6|16|
|未知|0|0|
|同区域聚合率|26.3%|100%|
|跨区域错合并对|5/703，0.71%|63/703，8.96%|

VLM自动输出4区域，但这不是正确的四标签划分：

1. G01/G02/G16/G17/G18：厨房7张＋客厅9张，共16核心图混合；另3张排除图。
2. G03/G14/G15：卧室12张，另7张排除图。
3. G04/G13：仅3张边界/排除图，不能认证为独立区域。
4. G05–G12：浴室16张，浴室碎片全部聚合。

旧区域26/40正确，新区域2/4正确。卧室与浴室已审内容恢复良好；厨房/客厅被模型理解为同一开放生活空间，与固定功能区域标签不符。提示虽提醒开放功能区可不同，并未阻止合并。不能通过改标签把这一失败消掉，也不能声称它完全不理解布局。

模型没有任何未知输出，且解释出现将三视图称为“full 360° view”的不准确表述；输入不是完整360全景。对全部解释未独立事实核验，所以理由文本不能作为已认证结构证据。代表抽样也可能漏组内污染；不能宣称18组全图均经模型检查。

## 软件与保留产物

- `sim/vlm_group_aggregation_trial.py`：冻结图像hash/代表清单/提示词后调用，模型回答完成后才加载评分标签；无标签聚合与评分分离。
- `docs/experiments/vlm-global-aggregation-val4-input-v1.json`：冻结输入、提示、模型请求与选择规则。
- `docs/experiments/vlm-global-aggregation-val4-response-v1.json`：真实API原始响应，含usage/模型信息。
- `docs/experiments/vlm-global-aggregation-val4-report-v1.json`：完整回答、区域分配、44查询及指标。
- `run/sim/vlm-global-aggregation-val4-v1/`：实际模型拼图和原回答；大图片不随版本提交。

```powershell
python sim/test_vlm_group_aggregation_trial.py
python sim/vlm_group_aggregation_trial.py run/sim/retrospective-repair-val4-v2.json run/sim/region-val4-multiview docs/experiments/fixed-region-queries-val4-v1.json run/sim/NEW-vlm-run
```

使用已有QWEN_API_KEY/QWEN_BASE_URL，不在产物记录密钥。2项回答协议单测通过，非模型可靠性验收。开发AI标签、13边界/未审图排除、一次运行不能外推到独立环境或实际头盔。

结论：VLM确实有能力聚合视觉碎片，但未正确遵守既定区域粒度。本轮默认算法与生产链路不变，尚不建议自动替换。后续可在独立冻结协议中明确功能边界与组内部部分归属，再测隔门/相似房间负例；不能在同一开发集反复挑最好提示当可靠性结果。

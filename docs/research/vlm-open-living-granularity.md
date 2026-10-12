# 开放生活区粒度与qwen3.8-flash实跑（2026-10-12）

用户明确认可厨房与客厅可同属一个开放生活空间。因此另建粗粒度协议：kitchen-dining/living-sofa映射为open-living-area，卧室/浴室不变；44查询不变，13边界/未审图仍排除。新旧场景随明确标签定义变为3新/41旧。原细粒度标签与失败结果不修改。这是看过结果后的用户粒度选择，不能当独立留出验证。

新冻结清单：`docs/experiments/fixed-region-queries-open-living-val4-v1.json`。两模型都没有得到细/粗标签或预设区域数；对已保存输出分别重评分。

## 同44查询最终结果

|真实模型|原功能细粒度|开放生活区粗粒度|粗粒度未知|粗粒度错合并对|
|---|---:|---:|---:|---:|
|此前qwen3-vl-plus|28/44，63.6%|44/44，100%|0|0/640|
|本轮qwen3.8-flash|16/44，36.4%|32/44，72.7%|12/44|0/640|

100%是此前plus的一次输出在修改粒度后的核心开发样本结果，不是flash成绩、不意味着随机位置成功概率或硬件可靠性。plus另有一个区域全为排除图，不在44查询中认证。

## qwen3.8-flash实际执行

明确API model=`qwen3.8-flash`，返回模型同名；原18组、相同36三视图代表/18拼图及相同提示，temperature=0，一次请求无重试。约117.9秒。输出3个区域、2个未定组，没有沿用plus答案或原视觉聚合。

- 开放生活区16核心图正确聚合。
- 浴室16核心图正确聚合。
- 卧室12核心图全部未定：模型认为G03/G15部分代表看起来来自起居区，因此拒绝将整个组绑定到一个区域。相关疑似跨区域代表是观察9/46，在旧标签包为边界/排除图；模型接收图像但不知排除标签，不能用评分答案替它移除这些图。是否是实际跨区域或隔门观察，需独立原图/连续过程复核。
- 粗粒度旧区域30/41正确、新区域2/3正确；未知保留分母，不把已回答32/32正确当总体100%。同区域聚合240/306=78.4%，其余未定卧室对没有被统计成同组。

脚本默认模型已改为用户指定`qwen3.8-flash`，只影响独立聚合试验；未擅自改生产Agent模型。旧plus原始运行保留，不能改写名称。

产物：`vlm-global-aggregation-val4-flash-{input,response,report}-v1.json`与`vlm-open-living-rescore-val4-v1.json`在`docs/experiments/`，含原始API响应和完整逐查询结果。大图保留在`run/sim/vlm-global-aggregation-val4-flash-v1/`。

```powershell
python sim/test_score_open_living_region.py
python sim/score_open_living_region.py run/sim/retrospective-repair-val4-v2.json docs/experiments/fixed-region-queries-val4-v1.json docs/experiments/fixed-region-queries-open-living-val4-v1.json docs/experiments/NEW-coarse-report.json docs/experiments/vlm-global-aggregation-val4-report-v1.json docs/experiments/vlm-global-aggregation-val4-flash-report-v1.json
```

默认算法未启用VLM聚合，待定组仍不能自动进入长期区域身份。下一步重点是组内边界处理/部分归属，而不是强迫flash回答卧室组。

# 无预分组：逐观察全场聚合与2点分块对照

用户要求检验家庭/HSSD完全不做视觉或时间预分组是否有效，并量化预算。`python sim/single_observation_vlm_trial.py`已后台启动，独立`run/single-observation-vlm-<timestamp>/`。

## 定义和公平性

无预分组arm：每个原观察（左/前/右三视图）单独一个单元，全部单元一次交VLM按具体空间身份聚合。**不是整段一个不可拆主体组，也不是逐图单独请求后无法比较历史。** 保留同一冻结test.5提示/协议，用singleton组兼容接口，区别仅在组约束大小。

控制arm：同批原观察每2点按时间分块，同样一次全场聚合。家庭57/40观察、HSSD40/38/40/40/23观察，每arm所有原查询图均展示，原图片hash逐一核对，图像不缩放/增强。两个arm模型qwen3.8-flash、temperature0、timeout240、SDK重试0、最多2协议修复。单个场景两个arm不同输入不是统计可靠性的重复，不选择有利答案覆盖以前time-2。

家庭原数据没有timestampMs时显式采用原1000ms/tick，不能偷偷合成其他cadence。HSSD使用原timestamps。图像检测1–2fps与VLM原查询约0.5Hz分开说明，不能声称模型看到了全部视频帧。

## 覆盖与预算

2家庭＋5有效HSSD=7场景、14正常请求、最多42次含协议修复；第6HSSD原采集失败显式保留，无推理。家庭默认算法/旧成功预测/审核网站不改。

API每次response的usage累计prompt/completion/total tokens，修复调用包含在内，网络无response计失败但计费未知；统计耗时、atlas字节、原图数量/单元数。不把单元翻倍当成本翻倍，也不未经核价给货币估计。该原图全展示实验不同于旧分组仅首中末代表，不能据此排除“代表压缩可省预算”的价值。

## 评测

家庭：在推理后读取原开放生活区val4固定44查询/val5固定28查询，报告旧新地点识别/重复新区域/未知；另列开发core身份一对一对齐和既有AI boundary建议。两类评分定义不同，分别报告，不做替换。原prefix用于冻结query inventory，但新推理为全场事后；不拿它冒充arrival实时识别。

HSSD：推理后读取原AI标签，core具体身份一对一对齐、boundary召回/精确、真正unknown分别列。仅参考一致率，不是真实准确率，开放空间多解争议仍需审查。未知不从可评core分母删除，boundary/labelunknown排除数显示，边界无样本NA，工程失败保留。

## 当前验证

Python94/94通过，新增singleton定义、计入协议修复预算测试。真实模型队列刚启动，尚无结果，不宣称直接看单元更好或分组没有作用。可显式`--resume <directory>`继续已有输入、有效报告复用、失败尝试独立保留。
